/**
 * Winter lease leads, the IO half (rules: lease-leads-core.ts). Every run:
 *
 *   1. read Zillow's renter mail from each configured Gmail mailbox (Zillow
 *      writes to ryan@, which lands in the operator's inbox), keyed by the
 *      RFC Message-ID so a mail seen through two mailboxes files once;
 *   2. file each mail under its renter and listing (lease_leads);
 *   3. for every lead with mail newer than its last vetting, have the model
 *      read the renter's own words into facts, then decide the verdict in
 *      code (decideVerdict). Only 'serious' reaches the home feed.
 *
 * Read-only on Gmail. Nothing is sent to a renter from here.
 */

import 'server-only';
import { generateObject } from 'ai';
import { z } from 'zod';
import { supabaseAdmin, isServiceConfigured } from './supabase-admin';
import {
  decideVerdict,
  EMPTY_FACTS,
  isRenterMail,
  leadKey,
  listingFor,
  parseZillowMail,
  scamSigns,
  type LeadFacts,
  type LeaseListing,
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

type FiledMail = { messageKey: string; threadId: string; receivedAt: string; subject: string; from: string; body: string };

async function readMailbox(mb: Mailbox): Promise<FiledMail[]> {
  const token = await accessToken(mb);
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
      body: bodyText(m.payload),
    });
  }
  return out;
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

export type LeaseLeadRun = { mailboxes: string[]; read: number; filed: number; vetted: number; errors: string[] };

export async function runLeaseLeads(): Promise<LeaseLeadRun> {
  const run: LeaseLeadRun = { mailboxes: [], read: 0, filed: 0, vetted: 0, errors: [] };
  if (!isServiceConfigured) return run;

  const { data: listingRows } = await supabaseAdmin.from('lease_listings').select('zillow_address, property_id, label, monthly_rent, lease_start, lease_end').eq('active', true);
  const listings = ((listingRows ?? []) as LeaseListing[]).map((l) => ({ ...l, monthly_rent: Number(l.monthly_rent) }));

  // 1-2. Read and file.
  const seen = new Set<string>();
  for (const mb of mailboxes()) {
    let mails: FiledMail[] = [];
    try {
      mails = await readMailbox(mb);
      run.mailboxes.push(mb.name);
    } catch (err) {
      run.errors.push(err instanceof Error ? err.message : String(err));
      continue;
    }
    for (const mail of mails) {
      if (seen.has(mail.messageKey)) continue;
      seen.add(mail.messageKey);
      run.read += 1;
      const { data: dup } = await supabaseAdmin.from('lease_lead_messages').select('message_key').eq('message_key', mail.messageKey).maybeSingle();
      if (dup) continue;
      const p = parseZillowMail(mail.subject, mail.body);
      const relay = /@convo\.zillow\.com/i.test(mail.from) ? mail.from.match(/[\w.+-]+@convo\.zillow\.com/i)?.[0] ?? null : null;
      const key = leadKey(p, relay);
      const listing = listingFor(p.zillowAddress, listings);
      const { data: lead, error: upErr } = await supabaseAdmin
        .from('lease_leads')
        .upsert(
          { lead_key: key, zillow_address: p.zillowAddress, property_id: listing?.property_id ?? null, renter_name: p.renterName, first_seen_at: mail.receivedAt, last_message_at: mail.receivedAt },
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
  label: string | null;
  monthly_rent: number | null;
};

/** Every lead with its listing's label and rent, newest mail first. */
export async function loadLeaseLeads(opts: { includeDismissed?: boolean } = {}): Promise<LeaseLeadRow[]> {
  if (!isServiceConfigured) return [];
  let q = supabaseAdmin
    .from('lease_leads')
    .select('id, renter_name, zillow_address, property_id, reply_url, application_url, has_application, first_seen_at, last_message_at, verdict, verdict_reasons, facts, summary, dismissed_at')
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
