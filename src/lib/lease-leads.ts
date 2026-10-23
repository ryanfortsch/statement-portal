/**
 * Winter lease leads, the IO half (rules: lease-leads-core.ts). Every run:
 *
 *   1. read Zillow's renter mail from each configured Gmail mailbox (Zillow
 *      writes to ryan@, which lands in the operator's inbox), keyed by the
 *      RFC Message-ID so a mail seen through two mailboxes files once;
 *   2. file each mail under its renter and listing (lease_leads);
 *   3. for every lead with mail newer than its last vetting, have the model
 *      read the renter's own words into facts, then decide the verdict in
 *      code (decideVerdict). Only 'serious' reaches the home feed;
 *   4. send the screening message (screeningMessage, one fixed text) once to
 *      each lead that needs answers, through Zillow's relay address, from the
 *      mailbox the lead was addressed to (shouldSendScreening);
 *   5. text the operator once when a lead turns serious (seriousLeadText),
 *      from the 24/7 line. ?dry=1 on the cron reports what would go out and
 *      sends nothing.
 */

import 'server-only';
import { generateObject } from 'ai';
import { z } from 'zod';
import { supabaseAdmin, isServiceConfigured } from './supabase-admin';
import { helmBaseUrl } from './daily-brief';
import { parseRecipientList } from './meetings-core';
import { normalizePhone, quoFromNumber, sendMessage } from './quo';
import {
  decideVerdict,
  EMPTY_FACTS,
  isRenterMail,
  leadKey,
  listingFor,
  parseZillowMail,
  LEASE_ALERT_MAX_ATTEMPTS,
  rawReply,
  scamSigns,
  screeningMessage,
  seriousLeadText,
  shouldSendScreening,
  type LeadFacts,
  type LeaseListing,
  type ScreeningLead,
} from './lease-leads-core';

const MODEL = 'anthropic/claude-sonnet-4.5';
const SEARCH_Q = 'from:zillow.com newer_than:30d';

type Mailbox = { name: string; refreshToken: string; clientId: string; clientSecret: string };

/** Every configured mailbox; Zillow mail reaches whichever one ryan@ delivers to. */
function mailboxes(): Mailbox[] {
  const sharedId = process.env.GMAIL_CLIENT_ID || '';
  const sharedSecret = process.env.GMAIL_CLIENT_SECRET || '';
  const pick = (name: string, suffix: string | null): Mailbox => ({
    name,
    refreshToken: (suffix ? process.env[`GMAIL_REFRESH_TOKEN_${suffix}`] : process.env.GMAIL_REFRESH_TOKEN) || '',
    clientId: (suffix && process.env[`GMAIL_CLIENT_ID_${suffix}`]) || sharedId,
    clientSecret: (suffix && process.env[`GMAIL_CLIENT_SECRET_${suffix}`]) || sharedSecret,
  });
  const seen = new Set<string>();
  return [pick('Dotti', 'DOTTI'), pick('Ryan', 'RYAN'), pick('shared', null), pick('Allie', 'ALLIE')].filter((m) => {
    if (!m.refreshToken || !m.clientId || !m.clientSecret || seen.has(m.refreshToken)) return false;
    seen.add(m.refreshToken);
    return true;
  });
}

async function accessToken(mb: Mailbox): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: mb.clientId, client_secret: mb.clientSecret, refresh_token: mb.refreshToken, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${mb.name}'s Gmail token: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };
type GmailMessage = { id: string; threadId: string; internalDate: string; payload?: GmailPart & { headers?: Array<{ name: string; value: string }> } };

function decode(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

/** Plain text when the mail has it, else the HTML flattened to the "| cell |" shape the parser reads. */
function bodyText(part: GmailPart | undefined): string {
  if (!part) return '';
  const plain = findPart(part, 'text/plain');
  if (plain?.body?.data) return decode(plain.body.data);
  const html = findPart(part, 'text/html');
  if (!html?.body?.data) return '';
  return decode(html.body.data)
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2[]($1)')
    .replace(/<\/(td|th)>/gi, ' |')
    .replace(/<(td|th)[^>]*>/gi, '| ')
    .replace(/<br\s*\/?>|<\/(p|div|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ');
}

function findPart(p: GmailPart, mime: string): GmailPart | null {
  if (p.mimeType === mime && p.body?.data) return p;
  for (const c of p.parts ?? []) {
    const f = findPart(c, mime);
    if (f) return f;
  }
  return null;
}

type FiledMail = { messageKey: string; threadId: string; receivedAt: string; subject: string; from: string; to: string; body: string };

async function readMailbox(token: string, mb: Mailbox): Promise<FiledMail[]> {
  const auth = { Authorization: `Bearer ${token}` };
  const list = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(SEARCH_Q)}&maxResults=100`, { headers: auth, signal: AbortSignal.timeout(15_000) });
  if (!list.ok) throw new Error(`${mb.name}'s Gmail list: ${list.status}`);
  const ids = ((await list.json()) as { messages?: Array<{ id: string }> }).messages ?? [];
  const out: FiledMail[] = [];
  for (const { id } of ids) {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: auth, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) continue;
    const m = (await res.json()) as GmailMessage;
    const header = (n: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === n)?.value ?? '';
    const subject = header('subject');
    const from = header('from');
    if (!isRenterMail(from, subject)) continue;
    out.push({
      messageKey: header('message-id') || `gmail:${mb.name}:${m.id}`,
      threadId: m.threadId,
      receivedAt: new Date(Number(m.internalDate)).toISOString(),
      subject,
      from,
      to: header('to'),
      body: bodyText(m.payload),
    });
  }
  return out;
}

/** Which address a token opens, the verified addresses it may send as (its
 *  own plus any Gmail "Send mail as" alias), and whether it may send at all
 *  (gmail.compose, gmail.send or full mail). */
type Sender = { name: string; token: string; address: string | null; sendAs: string[]; canSend: boolean };

async function describeSender(mb: Mailbox, token: string): Promise<Sender> {
  let address: string | null = null;
  let canSend = false;
  try {
    const prof = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    if (prof.ok) address = ((await prof.json()) as { emailAddress?: string }).emailAddress?.toLowerCase() ?? null;
    const info = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(10_000) });
    if (info.ok) {
      const scope = ((await info.json()) as { scope?: string }).scope ?? '';
      canSend = /auth\/gmail\.(compose|send|modify)\b|https:\/\/mail\.google\.com\//.test(scope);
    }
  } catch {
    /* an unreadable token simply cannot send */
  }
  const sendAs = new Set<string>(address ? [address] : []);
  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      const list = ((await res.json()) as { sendAs?: Array<{ sendAsEmail?: string; verificationStatus?: string; isPrimary?: boolean }> }).sendAs ?? [];
      for (const a of list) if (a.sendAsEmail && (a.isPrimary || a.verificationStatus === 'accepted')) sendAs.add(a.sendAsEmail.toLowerCase());
    }
  } catch {
    /* no alias list: the token sends as itself only */
  }
  return { name: mb.name, token, address, sendAs: [...sendAs], canSend };
}

/** The bare address out of a To header: "Ryan <ryan@x.com>" -> "ryan@x.com". */
function bareAddress(header: string | null | undefined): string | null {
  const m = (header ?? '').match(/[\w.+-]+@[\w.-]+\.\w+/);
  return m ? m[0].toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// The model reads; it never decides.

const FactsSchema = z.object({
  moveIn: z.string().nullable().describe('YYYY-MM-DD the renter wants to move in, or the 1st of the month they named; null if unsaid'),
  moveOut: z.string().nullable().describe('YYYY-MM-DD the renter would leave, or the last day of the month they named; null if unsaid'),
  wantsMonthToMonth: z.boolean(),
  wantsYearLease: z.boolean(),
  exitReason: z.string().nullable().describe('Why their stay ends: a work contract end, a home closing, a renovation finishing. Null if unsaid'),
  monthlyIncome: z.number().nullable().describe('Household income per month in dollars from any source, if they stated a figure'),
  work: z.string().nullable().describe('Their job, contract or assignment, in a few words, if stated'),
  occupants: z.number().nullable().describe('How many people would live there, as a number only'),
  pets: z.enum(['none', 'pet', 'assistance_animal', 'unknown']),
  wantsViewing: z.boolean(),
  scamLike: z.boolean().describe('True only for clear scam signs: asks to move off Zillow or pay outside it, a generic template not about this home, or claims to be abroad and unable to see it'),
  scamWhy: z.string().nullable(),
  summary: z.string().describe('One plain sentence of what they asked or said, without any protected trait'),
});

const SYSTEM = `You read messages from people asking to rent a furnished home for the winter (a fixed-term lease, January to April) and record only what they actually wrote.

Fair housing law applies. Never record, infer or mention: race, color, national origin, ancestry, religion, sex, gender identity, sexual orientation, age, marital status, familial status or whether children are in the household, disability or health, veteran or military status, genetic information, or source of income (a housing voucher, benefits or a stipend is income like any other: record the dollar amount only). "occupants" is a head count and nothing more. An assistance or service animal is not a pet.

Record facts the renter stated. Do not guess dates, income or reasons they did not give. A scam is about the message (off-platform payment, a template that does not mention this home, cannot see the home because abroad), never about who the person is.`;

async function readFacts(listing: LeaseListing | null, messages: Array<{ at: string; kind: string; text: string }>): Promise<{ facts: LeadFacts; summary: string }> {
  const listingLine = listing
    ? `${listing.label}: ${listing.monthly_rent} a month, lease ${listing.lease_start} to ${listing.lease_end}.`
    : 'A winter lease, January to April.';
  const prompt = `The listing: ${listingLine}\n\nThe renter's messages, oldest first:\n${messages.map((m) => `[${m.at.slice(0, 10)} ${m.kind}] ${m.text}`).join('\n\n')}`;
  const { object } = await generateObject({ model: MODEL, schema: FactsSchema, system: SYSTEM, prompt, maxOutputTokens: 600 });
  const { summary, ...facts } = object;
  return { facts: { ...EMPTY_FACTS, ...facts }, summary };
}

export type LeaseLeadRun = {
  mailboxes: string[];
  read: number;
  filed: number;
  vetted: number;
  senders: Array<{ name: string; address: string | null; sendAs: string[]; canSend: boolean }>;
  screening: { sent: string[]; wouldSend: string[]; skippedNoSender: string[] };
  alerts: { sent: string[]; wouldSend: string[] };
  errors: string[];
};

export async function runLeaseLeads(opts: { dry?: boolean; now?: Date } = {}): Promise<LeaseLeadRun> {
  const run: LeaseLeadRun = { mailboxes: [], read: 0, filed: 0, vetted: 0, senders: [], screening: { sent: [], wouldSend: [], skippedNoSender: [] }, alerts: { sent: [], wouldSend: [] }, errors: [] };
  const now = opts.now ?? new Date();
  if (!isServiceConfigured) return run;

  const { data: listingRows } = await supabaseAdmin.from('lease_listings').select('zillow_address, property_id, label, monthly_rent, lease_start, lease_end, screening_autosend').eq('active', true);
  const listings = ((listingRows ?? []) as Array<LeaseListing & { screening_autosend: boolean }>).map((l) => ({ ...l, monthly_rent: Number(l.monthly_rent) }));
  const senders: Sender[] = [];

  // 1-2. Read and file.
  const seen = new Set<string>();
  for (const mb of mailboxes()) {
    let mails: FiledMail[] = [];
    try {
      const token = await accessToken(mb);
      senders.push(await describeSender(mb, token));
      mails = await readMailbox(token, mb);
      run.mailboxes.push(mb.name);
    } catch (err) {
      run.errors.push(err instanceof Error ? err.message : String(err));
      continue;
    }
    for (const mail of mails) {
      if (seen.has(mail.messageKey)) continue;
      seen.add(mail.messageKey);
      run.read += 1;
      const p = parseZillowMail(mail.subject, mail.body);
      const relay = /@convo\.zillow\.com/i.test(mail.from) ? mail.from.match(/[\w.+-]+@convo\.zillow\.com/i)?.[0]?.toLowerCase() ?? null : null;
      const key = leadKey(p, relay);
      // Where to answer and as whom: fill-empty, so the first mail sets them.
      const reach = { relay_address: relay, received_to: bareAddress(mail.to), first_subject: mail.subject, first_rfc_message_id: mail.messageKey.startsWith('<') ? mail.messageKey : null };
      const { data: dup } = await supabaseAdmin.from('lease_lead_messages').select('message_key').eq('message_key', mail.messageKey).maybeSingle();
      if (dup) {
        for (const [col, val] of Object.entries(reach)) if (val) await supabaseAdmin.from('lease_leads').update({ [col]: val }).eq('lead_key', key).is(col, null);
        continue;
      }
      const listing = listingFor(p.zillowAddress, listings);
      const { data: lead, error: upErr } = await supabaseAdmin
        .from('lease_leads')
        .upsert(
          { lead_key: key, zillow_address: p.zillowAddress, property_id: listing?.property_id ?? null, renter_name: p.renterName, first_seen_at: mail.receivedAt, last_message_at: mail.receivedAt, ...reach },
          { onConflict: 'lead_key', ignoreDuplicates: true },
        )
        .select('id')
        .maybeSingle();
      if (upErr) {
        run.errors.push(`file ${key}: ${upErr.message}`);
        continue;
      }
      const leadId = (lead as { id: string } | null)?.id ?? ((await supabaseAdmin.from('lease_leads').select('id').eq('lead_key', key).maybeSingle()).data as { id: string } | null)?.id;
      if (!leadId) continue;
      await supabaseAdmin.from('lease_lead_messages').insert({
        message_key: mail.messageKey,
        lead_id: leadId,
        kind: p.kind,
        received_at: mail.receivedAt,
        subject: mail.subject,
        body_text: p.message ?? (p.kind === 'application' ? mail.subject : null),
        gmail_thread_id: mail.threadId,
      });
      for (const [col, val] of Object.entries(reach)) if (val) await supabaseAdmin.from('lease_leads').update({ [col]: val }).eq('id', leadId).is(col, null);
      // Links and the application flag only ever fill in; last_message_at only moves forward.
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (p.replyUrl) patch.reply_url = p.replyUrl;
      if (p.applicationUrl) patch.application_url = p.applicationUrl;
      if (p.kind === 'application') patch.has_application = true;
      await supabaseAdmin.from('lease_leads').update(patch).eq('id', leadId);
      await supabaseAdmin.from('lease_leads').update({ last_message_at: mail.receivedAt }).eq('id', leadId).lt('last_message_at', mail.receivedAt);
      run.filed += 1;
    }
  }

  // 3. Vet every lead with mail newer than its last vetting.
  const { data: open } = await supabaseAdmin
    .from('lease_leads')
    .select('id, zillow_address, has_application, last_message_at, vetted_through')
    .is('dismissed_at', null)
    .order('last_message_at', { ascending: true })
    .limit(50);
  for (const l of (open ?? []) as Array<{ id: string; zillow_address: string | null; has_application: boolean; last_message_at: string; vetted_through: string | null }>) {
    if (l.vetted_through && l.vetted_through >= l.last_message_at) continue;
    try {
      const { data: msgs } = await supabaseAdmin.from('lease_lead_messages').select('kind, received_at, body_text').eq('lead_id', l.id).order('received_at', { ascending: true });
      const messages = ((msgs ?? []) as Array<{ kind: string; received_at: string; body_text: string | null }>).filter((m) => m.body_text).map((m) => ({ at: m.received_at, kind: m.kind, text: m.body_text as string }));
      const listing = listingFor(l.zillow_address, listings);
      const signs = messages.flatMap((m) => scamSigns(m.text));
      // A template scam is decided before any model reads it.
      const read = signs.length > 0 || messages.length === 0 ? { facts: EMPTY_FACTS, summary: messages[0]?.text.slice(0, 200) ?? '' } : await readFacts(listing, messages);
      const v = decideVerdict(read.facts, listing, { hasApplication: l.has_application, scamSigns: signs });
      await supabaseAdmin
        .from('lease_leads')
        .update({
          verdict: v.verdict,
          verdict_reasons: [...v.reasons, ...v.missing.map((m) => `missing: ${m}`)],
          facts: read.facts,
          summary: read.summary,
          vetted_at: new Date().toISOString(),
          vetted_through: l.last_message_at,
          updated_at: new Date().toISOString(),
        })
        .eq('id', l.id);
      run.vetted += 1;
    } catch (err) {
      run.errors.push(`vet ${l.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 4. The screening message, once per lead that needs answers.
  run.senders = senders.map(({ name, address, sendAs, canSend }) => ({ name, address, sendAs, canSend }));
  const { data: candidates } = await supabaseAdmin
    .from('lease_leads')
    .select('id, renter_name, zillow_address, verdict, relay_address, received_to, first_subject, first_rfc_message_id, first_seen_at, screening_sent_at, screening_attempts, dismissed_at, has_application')
    .eq('verdict', 'needs_answers')
    .is('screening_sent_at', null)
    .is('dismissed_at', null)
    .limit(25);
  for (const c of (candidates ?? []) as Array<ScreeningLead & { id: string; renter_name: string | null; zillow_address: string | null; received_to: string | null; first_subject: string | null; first_rfc_message_id: string | null }>) {
    const listing = listingFor(c.zillow_address, listings);
    if (!listing || !shouldSendScreening(c, listing, now)) continue;
    // Zillow passes a reply on only from the address it wrote to: the
    // mailbox that is that address, else one with it as a verified alias.
    const to = c.received_to;
    const sender = to ? senders.find((s) => s.canSend && s.address === to) ?? senders.find((s) => s.canSend && s.sendAs.includes(to)) : undefined;
    if (!sender || !to) {
      run.screening.skippedNoSender.push(c.id);
      if (!opts.dry) await supabaseAdmin.from('lease_leads').update({ screening_error: `No Helm mailbox can send as ${c.received_to ?? 'the address Zillow wrote to'}` }).eq('id', c.id);
      continue;
    }
    if (opts.dry) {
      run.screening.wouldSend.push(c.id);
      continue;
    }
    const msg = screeningMessage(c.renter_name, listing, c.first_subject);
    const raw = rawReply({ from: to, to: c.relay_address as string, subject: msg.subject, body: msg.body, inReplyTo: c.first_rfc_message_id });
    // Claim the lead before sending, so two overlapping runs cannot both send.
    const { data: claimed } = await supabaseAdmin
      .from('lease_leads')
      .update({ screening_attempts: c.screening_attempts + 1, updated_at: new Date().toISOString() })
      .eq('id', c.id)
      .eq('screening_attempts', c.screening_attempts)
      .is('screening_sent_at', null)
      .select('id');
    if (!claimed || claimed.length === 0) continue;
    try {
      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${sender.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Gmail send ${res.status}: ${(await res.text()).slice(0, 200)}`);
      await supabaseAdmin.from('lease_leads').update({ screening_sent_at: new Date().toISOString(), screening_from: `${to} via ${sender.name}`, screening_error: null }).eq('id', c.id);
      run.screening.sent.push(c.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await supabaseAdmin.from('lease_leads').update({ screening_error: message }).eq('id', c.id);
      run.errors.push(`screening ${c.id}: ${message}`);
    }
  }
  // 5. Text the operator once per serious lead, from the 24/7 line.
  const recipients = parseRecipientList(process.env.LEASE_ALERT_PHONES || process.env.DOTTI_PHONE);
  const { data: serious } = await supabaseAdmin
    .from('lease_leads')
    .select('id, renter_name, zillow_address, has_application, facts, alert_attempts')
    .eq('verdict', 'serious')
    .is('dismissed_at', null)
    .is('alerted_at', null)
    .lt('alert_attempts', LEASE_ALERT_MAX_ATTEMPTS)
    .limit(10);
  for (const lead of (serious ?? []) as Array<{ id: string; renter_name: string | null; zillow_address: string | null; has_application: boolean; facts: LeadFacts; alert_attempts: number }>) {
    const listing = listingFor(lead.zillow_address, listings);
    const body = seriousLeadText({ renter_name: lead.renter_name, label: listing?.label ?? null, has_application: lead.has_application, facts: { ...EMPTY_FACTS, ...(lead.facts ?? {}) } }, `${helmBaseUrl()}/properties/leases`);
    if (opts.dry) {
      run.alerts.wouldSend.push(lead.id);
      continue;
    }
    if (recipients.length === 0) {
      await supabaseAdmin.from('lease_leads').update({ alert_error: 'no recipient: set DOTTI_PHONE or LEASE_ALERT_PHONES' }).eq('id', lead.id);
      continue;
    }
    const { data: claimed } = await supabaseAdmin
      .from('lease_leads')
      .update({ alert_attempts: lead.alert_attempts + 1 })
      .eq('id', lead.id)
      .eq('alert_attempts', lead.alert_attempts)
      .is('alerted_at', null)
      .select('id');
    if (!claimed || claimed.length === 0) continue;
    const ids: string[] = [];
    const errs: string[] = [];
    for (const to of recipients) {
      try {
        const sent = await sendMessage({ from: quoFromNumber('ops'), to: `+1${normalizePhone(to)}`, content: body });
        ids.push(sent.id);
      } catch (err) {
        errs.push(err instanceof Error ? err.message : String(err));
      }
    }
    await supabaseAdmin
      .from('lease_leads')
      .update(ids.length > 0 ? { alerted_at: new Date().toISOString(), alert_message_id: ids[0], alert_error: errs.length ? errs.join(' | ') : null } : { alert_error: errs.join(' | ') || 'send failed' })
      .eq('id', lead.id);
    if (ids.length > 0) run.alerts.sent.push(lead.id);
    else run.errors.push(`alert ${lead.id}: ${errs.join(' | ')}`);
  }
  return run;
}

export type LeaseLeadRow = {
  id: string;
  renter_name: string | null;
  zillow_address: string | null;
  property_id: string | null;
  reply_url: string | null;
  application_url: string | null;
  has_application: boolean;
  first_seen_at: string;
  last_message_at: string;
  verdict: string;
  verdict_reasons: string[];
  facts: LeadFacts;
  summary: string | null;
  dismissed_at: string | null;
  screening_sent_at: string | null;
  screening_error: string | null;
  label: string | null;
  monthly_rent: number | null;
};

/** Every lead with its listing's label and rent, newest mail first. */
export async function loadLeaseLeads(opts: { includeDismissed?: boolean } = {}): Promise<LeaseLeadRow[]> {
  if (!isServiceConfigured) return [];
  let q = supabaseAdmin
    .from('lease_leads')
    .select('id, renter_name, zillow_address, property_id, reply_url, application_url, has_application, first_seen_at, last_message_at, verdict, verdict_reasons, facts, summary, dismissed_at, screening_sent_at, screening_error')
    .order('last_message_at', { ascending: false })
    .limit(200);
  if (!opts.includeDismissed) q = q.is('dismissed_at', null);
  const [{ data }, { data: listingRows }] = await Promise.all([q, supabaseAdmin.from('lease_listings').select('zillow_address, label, monthly_rent')]);
  const byAddress = new Map(((listingRows ?? []) as Array<{ zillow_address: string; label: string; monthly_rent: number }>).map((l) => [l.zillow_address, l]));
  return ((data ?? []) as Array<Omit<LeaseLeadRow, 'label' | 'monthly_rent'>>).map((r) => {
    const l = r.zillow_address ? byAddress.get(r.zillow_address) : undefined;
    return { ...r, facts: { ...EMPTY_FACTS, ...(r.facts ?? {}) }, label: l?.label ?? null, monthly_rent: l ? Number(l.monthly_rent) : null };
  });
}
