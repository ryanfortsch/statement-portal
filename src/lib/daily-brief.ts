/**
 * Daily Brief — Dotti's morning rundown across Helm + email.
 *
 * One async loader pulls the day's signals from Supabase (work slips,
 * tasks, data gaps, inbound CRM touches awaiting reply, today's
 * turnovers) and Stay Concierge (pending message approvals). The
 * /today page and the daily-brief cron both consume the same shape.
 *
 * Volumes are small: 12 properties, dozens of active items at most. A
 * handful of unindexed selects is fine.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import {
  isStayConciergeConfigured,
  listApprovals,
  type Approval,
} from '@/lib/stay-concierge';
import type { TaskRow, WorkSlipRow } from '@/lib/work-types';
import {
  ACTIVE_TASK_STATUSES,
  ACTIVE_WORK_SLIP_STATUSES,
} from '@/lib/work-types';
import { triageEmails } from '@/lib/ai/triage-emails';
import { draftReply } from '@/lib/ai/draft-reply';

let _serviceSupabase: SupabaseClient | null = null;
function serviceSupabase(): SupabaseClient {
  if (_serviceSupabase) return _serviceSupabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('Supabase service role not configured for email triage');
  _serviceSupabase = createClient(url, key);
  return _serviceSupabase;
}

export type BriefStay = {
  propertyId: string;
  propertyName: string;
  guestName: string | null;
  channel: string | null;
  checkIn: string;
  checkOut: string;
};

export type BriefInboundTouch = {
  contactId: string;
  contactName: string | null;
  channel: string;
  summary: string;
  touchedAt: string;
  daysWaiting: number;
};

export type BriefDataGap = {
  id: string;
  propertyId: string | null;
  propertyName: string | null;
  month: string | null;
  gapType: string;
  description: string | null;
  severity: string | null;
};

export type BriefInspection = {
  id: string;
  propertyId: string;
  propertyName: string;
  completedAt: string | null;
  startedAt: string | null;
};

export type BriefEmail = {
  id: string;
  threadId: string;
  fromName: string | null;
  fromEmail: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject: string;
  snippet: string;
  receivedAt: string;
  ageHours: number;
  triage: 'needs_reply' | 'fyi' | 'notification';
  triageSummary: string;
  draftId: string | null;
};

export type BriefProspect = {
  id: string;
  prospectName: string;
  propertyAddress: string;
  propertyCity: string | null;
  status: 'draft' | 'sent';
  sentAt: string | null;
  closeLikelihoodPct: number | null;
  daysSinceSent: number | null;
};

export type DailyBrief = {
  date: string;
  checkoutsToday: BriefStay[];
  checkinsToday: BriefStay[];
  inspectionsCompletedToday: BriefInspection[];
  highPrioritySlips: WorkSlipRow[];
  ownerActionSlips: WorkSlipRow[];
  dueTasks: TaskRow[];
  inboundWaiting: BriefInboundTouch[];
  unreadEmails: BriefEmail[];
  unresolvedDataGaps: BriefDataGap[];
  pendingApprovals: Approval[];
  activeProspects: BriefProspect[];
  stayConciergeConfigured: boolean;
  lastGmailSyncAt: string | null;
  gmailConfigured: boolean;
  totals: {
    activeSlips: number;
    activeTasks: number;
    waitingReplies: number;
    unread: number;
    needsReply: number;
    fyi: number;
    notifications: number;
    dataGaps: number;
    approvals: number;
    inspectionsToday: number;
    activeProspects: number;
  };
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso.slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${toIso.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function gmailConfigured(): boolean {
  return Boolean(
    process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN,
  );
}

async function getGmailAccessToken(): Promise<string | null> {
  if (!gmailConfigured()) return null;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? null;
}

type GmailHeader = { name: string; value: string };

function parseFrom(header: string | null): { name: string | null; email: string | null } {
  if (!header) return { name: null, email: null };
  const match = header.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (match) {
    const name = match[1].replace(/^"|"$/g, '').trim() || null;
    return { name, email: match[2].trim().toLowerCase() };
  }
  const bare = header.trim();
  if (bare.includes('@')) return { name: null, email: bare.toLowerCase() };
  return { name: bare || null, email: null };
}

type FetchedEmail = Omit<BriefEmail, 'triage' | 'triageSummary'> & { isUnread: boolean };

// Fetch the current unread inbox from Gmail (metadata only). Used by
// the cron to decide which messages need (re)classification.
async function fetchUnreadInbox(): Promise<FetchedEmail[]> {
  const token = await getGmailAccessToken();
  if (!token) return [];

  // Deterministic noise filter at the query level so we never spend
  // an LLM call on known automated forwards. The AI still catches
  // anything else we missed.
  const excludeSenders = [
    // Quo (formerly OpenPhone) sends SMS forwards from quo@quo.com.
    'quo@quo.com',
    'no-reply@quo.com',
    'noreply@quo.com',
    'no-reply@openphone.com',
    'noreply@openphone.com',
    'notifications@vercel.com',
    'notify@vercel.com',
    'no-reply@vercel.com',
    'noreply@github.com',
    'notifications@github.com',
  ]
    .map(s => `-from:${s}`)
    .join(' ');
  // Two passes over the Primary inbox:
  //   - unread (14d): the actionable set, as before
  //   - recently-read (2d): catches mail Ryan/Allie open on their phone
  //     before the hourly cron, which otherwise would never be classified
  const baseFilter = `in:inbox -category:promotions -category:social -category:updates ${excludeSenders}`;
  const listStubs = async (query: string, max: number): Promise<Array<{ id: string; threadId: string }>> => {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent(query)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!r.ok) return [];
    const d = (await r.json()) as { messages?: Array<{ id: string; threadId: string }> };
    return d.messages ?? [];
  };
  const [unreadStubs, readStubs] = await Promise.all([
    listStubs(`is:unread ${baseFilter} newer_than:14d`, 20),
    listStubs(`-is:unread ${baseFilter} newer_than:2d`, 25),
  ]);
  const seenIds = new Set<string>();
  const stubs = [...unreadStubs, ...readStubs].filter(s => {
    if (seenIds.has(s.id)) return false;
    seenIds.add(s.id);
    return true;
  });
  if (!stubs.length) return [];

  const detailed = await Promise.all(
    stubs.map(async stub => {
      const detailRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${stub.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!detailRes.ok) return null;
      const data = (await detailRes.json()) as {
        id: string;
        threadId: string;
        internalDate?: string;
        snippet?: string;
        labelIds?: string[];
        payload?: { headers?: GmailHeader[] };
      };
      const headers = data.payload?.headers ?? [];
      const get = (n: string) => headers.find(h => h.name.toLowerCase() === n.toLowerCase())?.value ?? null;
      const { name, email } = parseFrom(get('from'));
      const splitRecipients = (raw: string | null): string[] => {
        if (!raw) return [];
        return raw
          .split(',')
          .map(part => parseFrom(part).email)
          .filter((e): e is string => Boolean(e));
      };
      const toEmails = splitRecipients(get('to'));
      const ccEmails = splitRecipients(get('cc'));
      const receivedMs = Number(data.internalDate ?? '0');
      const receivedAt = new Date(receivedMs || Date.now()).toISOString();
      const ageHours = Math.max(0, Math.round((Date.now() - (receivedMs || Date.now())) / 3_600_000));
      return {
        id: data.id,
        threadId: data.threadId,
        fromName: name,
        fromEmail: email,
        toEmails,
        ccEmails,
        subject: get('subject') ?? '(no subject)',
        snippet: (data.snippet ?? '').slice(0, 200),
        receivedAt,
        ageHours,
        isUnread: (data.labelIds ?? []).includes('UNREAD'),
      } as FetchedEmail;
    }),
  );
  const emails = detailed.filter((e): e is FetchedEmail => e !== null);
  emails.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));

  // Three reply-detection passes, each a different surface area:
  //   1. Same Gmail thread has a Rising Tide sent message after the inbound
  //   2. Any Gmail sent message after the inbound addressed to this sender (fresh-compose)
  //   3. Any outbound contact_touches row (Quo SMS, phone, manual log) to a
  //      contact whose emails array includes this sender, after the inbound
  // If any of these hit, the email is considered already-handled and drops
  // before it ever reaches triage classification or /today.
  const recentSentTo = await loadRecentSentRecipients(token);
  const recentTouchTo = await loadRecentOutboundTouchByEmail();

  const filtered = await Promise.all(
    emails.map(async e => {
      const inboundMs = new Date(e.receivedAt).getTime();
      if (e.fromEmail) {
        const lower = e.fromEmail.toLowerCase();
        const lastSent = recentSentTo.get(lower);
        if (lastSent && lastSent > inboundMs) return null;
        const lastTouch = recentTouchTo.get(lower);
        if (lastTouch && lastTouch > inboundMs) return null;
      }
      const inThread = await hasOutboundReplyAfter(token, e.threadId, e.receivedAt);
      return inThread ? null : e;
    }),
  );
  return filtered.filter((e): e is FetchedEmail => e !== null);
}

// Cross-channel reply detection: Dotti often handles a Bethany or owner
// thread via Quo SMS / phone / a manual contact-log note instead of
// email. Pull the most recent outbound touch per contact, map back
// through contacts.emails to the sender address. Anyone whose phone /
// email isn't in contacts won't be covered here — those land in the
// brief and Dotti can mark them handled inline via /today.
async function loadRecentOutboundTouchByEmail(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const { data: touches } = await supabase
      .from('contact_touches')
      .select('contact_id, touched_at')
      .eq('direction', 'outbound')
      .gte('touched_at', since);
    if (!touches?.length) return out;
    const latestByContact = new Map<string, number>();
    for (const row of touches as Array<{ contact_id: string; touched_at: string }>) {
      const ms = new Date(row.touched_at).getTime();
      const prev = latestByContact.get(row.contact_id);
      if (!prev || ms > prev) latestByContact.set(row.contact_id, ms);
    }
    const contactIds = Array.from(latestByContact.keys());
    if (!contactIds.length) return out;

    // contacts.emails path
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, emails')
      .in('id', contactIds);
    for (const c of (contacts ?? []) as Array<{ id: string; emails: string[] | null }>) {
      const ms = latestByContact.get(c.id);
      if (!ms) continue;
      for (const email of c.emails ?? []) {
        const lower = email.toLowerCase();
        const prev = out.get(lower);
        if (!prev || ms > prev) out.set(lower, ms);
      }
    }

  } catch {
    // best-effort; brief still renders without it
  }
  return out;
}

// One query → recipient_email → latest sent timestamp, used for
// cross-thread reply detection.
async function loadRecentSentRecipients(token: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&q=${encodeURIComponent('in:sent newer_than:14d')}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!listRes.ok) return out;
    const listData = (await listRes.json()) as { messages?: Array<{ id: string }> };
    const stubs = listData.messages ?? [];
    if (!stubs.length) return out;

    await Promise.all(
      stubs.map(async stub => {
        const detailRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${stub.id}?format=metadata&metadataHeaders=To&metadataHeaders=Cc`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!detailRes.ok) return;
        const data = (await detailRes.json()) as {
          internalDate?: string;
          payload?: { headers?: GmailHeader[] };
        };
        const ms = Number(data.internalDate ?? '0');
        if (!ms) return;
        const headers = data.payload?.headers ?? [];
        for (const h of headers) {
          if (h.name.toLowerCase() !== 'to' && h.name.toLowerCase() !== 'cc') continue;
          // Header value may be "Foo <a@x.com>, Bar <b@y.com>".
          for (const part of h.value.split(',')) {
            const { email } = parseFrom(part);
            if (!email) continue;
            const prev = out.get(email);
            if (!prev || ms > prev) out.set(email, ms);
          }
        }
      }),
    );
  } catch {
    // best-effort; thread check still runs as backstop
  }
  return out;
}

type GmailThreadMessage = {
  id: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: { headers?: GmailHeader[] };
};

// Treat any Rising Tide staff email as "us" — Allie or Ryan replying
// counts the same as Dotti replying.
const TEAM_DOMAIN_RE = /@risingtidestr\.com$/i;

async function hasOutboundReplyAfter(
  token: string,
  threadId: string,
  inboundReceivedAt: string,
): Promise<boolean> {
  try {
    // metadata + From header is more reliable than minimal — minimal
    // sometimes drops labelIds, and some clients send replies without
    // the SENT label set. Falling back to a domain check on From
    // catches both cases.
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=metadata&metadataHeaders=From`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { messages?: GmailThreadMessage[] };
    const inboundMs = new Date(inboundReceivedAt).getTime();
    for (const m of data.messages ?? []) {
      const ms = Number(m.internalDate ?? '0');
      if (ms <= inboundMs) continue;
      if (m.labelIds?.includes('SENT')) return true;
      const fromHeader = m.payload?.headers?.find(h => h.name.toLowerCase() === 'from')?.value ?? null;
      const { email } = parseFrom(fromHeader);
      if (email && TEAM_DOMAIN_RE.test(email)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ── Reply drafting ─────────────────────────────────────────────────

type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
};

function decodeB64Url(s: string): string {
  try {
    return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

// Walk the MIME tree for the first text/plain part; fall back to a
// crude tag-strip of the first text/html part.
function extractPlainText(part: GmailPart | undefined): string {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return decodeB64Url(part.body.data);
  for (const child of part.parts ?? []) {
    const found = extractPlainText(child);
    if (found) return found;
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    return decodeB64Url(part.body.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return '';
}

async function fetchEmailBody(
  token: string,
  messageId: string,
): Promise<{ body: string; messageIdHeader: string | null } | null> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    payload?: GmailPart & { headers?: GmailHeader[] };
  };
  const body = extractPlainText(data.payload).slice(0, 6000);
  const messageIdHeader =
    data.payload?.headers?.find(h => h.name.toLowerCase() === 'message-id')?.value ?? null;
  return { body, messageIdHeader };
}

function base64UrlEncode(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeMimeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`;
}

// Build an RFC 2822 reply and POST it to Gmail as a draft on the
// original thread. Returns the new draft id, or null on failure.
async function createReplyDraft(
  token: string,
  args: {
    threadId: string;
    to: string;
    subject: string;
    inReplyTo: string | null;
    body: string;
  },
): Promise<string | null> {
  const subject = args.subject.toLowerCase().startsWith('re:') ? args.subject : `Re: ${args.subject}`;
  const headers = [
    `To: ${args.to}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  if (args.inReplyTo) {
    headers.push(`In-Reply-To: ${args.inReplyTo}`);
    headers.push(`References: ${args.inReplyTo}`);
  }
  const mime = `${headers.join('\r\n')}\r\n\r\n${args.body}`;
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { raw: base64UrlEncode(mime), threadId: args.threadId } }),
  });
  if (!res.ok) {
    console.error('[createReplyDraft]', res.status, await res.text());
    return null;
  }
  const data = (await res.json()) as { id?: string };
  return data.id ?? null;
}

export async function deleteDraft(draftId: string): Promise<void> {
  try {
    const token = await getGmailAccessToken();
    if (!token) return;
    await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${draftId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    console.error('[deleteDraft]', err);
  }
}

type EmailTriageRow = {
  gmail_message_id: string;
  thread_id: string;
  from_name: string | null;
  from_email: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string;
  snippet: string;
  received_at: string;
  triage: 'needs_reply' | 'fyi' | 'notification';
  triage_summary: string;
  is_unread: boolean;
  draft_id?: string | null;
  draft_created_at?: string | null;
};


export type SyncEmailsSummary = {
  fetched: number;
  classifiedNew: number;
  alreadyCached: number;
  markedRead: number;
  draftsCreated: number;
};

// Cron-side. Pulls the current unread inbox, classifies any messages
// we haven't seen before with a single batched Haiku call, and folds
// the result into the email_triage cache. /today reads from the cache
// and never calls Gmail or the LLM itself.
export async function syncUnreadEmails(): Promise<SyncEmailsSummary> {
  if (!gmailConfigured()) {
    return { fetched: 0, classifiedNew: 0, alreadyCached: 0, markedRead: 0, draftsCreated: 0 };
  }
  const sb = serviceSupabase();
  const fetched = await fetchUnreadInbox();
  const ids = fetched.map(e => e.id);

  // Look up which ids we've already classified.
  const { data: existingRows } = await sb
    .from('email_triage')
    .select('gmail_message_id')
    .in('gmail_message_id', ids.length ? ids : ['__none__']);
  const existing = new Set(((existingRows ?? []) as Array<{ gmail_message_id: string }>).map(r => r.gmail_message_id));

  const toClassify = fetched.filter(e => !existing.has(e.id));
  const triaged = toClassify.length
    ? await triageEmails(
        toClassify.map(e => ({
          id: e.id,
          fromName: e.fromName,
          fromEmail: e.fromEmail,
          toEmails: e.toEmails,
          ccEmails: e.ccEmails,
          subject: e.subject,
          snippet: e.snippet,
        })),
      )
    : [];
  const triageById = new Map(triaged.map(t => [t.id, t]));

  const nowIso = new Date().toISOString();
  const newEmails = fetched.filter(e => !existing.has(e.id));

  // Queue a Gmail draft reply for every newly-classified needs_reply
  // email. Pull the full body, draft in Dotti's voice, create the
  // draft on the original thread. Only a handful of emails per sync,
  // so the extra Gmail + LLM calls are cheap. Best-effort: a failed
  // draft just leaves draft_id null and /today still shows the email.
  const token = await getGmailAccessToken();
  const draftByMessageId = new Map<string, string>();
  let draftsCreated = 0;
  if (token) {
    const needReply = newEmails.filter(e => triageById.get(e.id)?.category === 'needs_reply');
    await Promise.all(
      needReply.map(async e => {
        try {
          const full = await fetchEmailBody(token, e.id);
          if (!full) return;
          const reply = await draftReply({
            fromName: e.fromName,
            fromEmail: e.fromEmail,
            subject: e.subject,
            body: full.body || e.snippet,
          });
          if (!reply) return;
          const draftId = await createReplyDraft(token, {
            threadId: e.threadId,
            to: e.fromEmail ?? '',
            subject: e.subject,
            inReplyTo: full.messageIdHeader,
            body: reply.body,
          });
          if (draftId) {
            draftByMessageId.set(e.id, draftId);
            draftsCreated++;
          }
        } catch (err) {
          console.error('[syncUnreadEmails] draft failed', e.id, err);
        }
      }),
    );
  }

  // INSERT-only for new emails so we never overwrite existing
  // triage data with empty defaults. AI's classification stands —
  // the prompt now does the role-aware judgment rather than a
  // To-line hard rule (Dotti rarely receives email directly, so the
  // old rule downgraded everything).
  const newRows: EmailTriageRow[] = newEmails.map(e => {
    const t = triageById.get(e.id);
    const draftId = draftByMessageId.get(e.id) ?? null;
    return {
      gmail_message_id: e.id,
      thread_id: e.threadId,
      from_name: e.fromName,
      from_email: e.fromEmail,
      to_emails: e.toEmails,
      cc_emails: e.ccEmails,
      subject: e.subject,
      snippet: e.snippet,
      received_at: e.receivedAt,
      triage: t?.category ?? 'fyi',
      triage_summary: t?.summary ?? '',
      is_unread: e.isUnread,
      draft_id: draftId,
      draft_created_at: draftId ? nowIso : null,
    };
  });
  if (newRows.length) {
    await sb.from('email_triage').insert(newRows);
  }

  // Issue emails → maintenance work slips. A guest/owner reporting a
  // property problem auto-opens a slip on the matched property (idempotent
  // on the gmail id). Only fires when a Helm property is confidently
  // matched. Best-effort: never blocks the triage sync.
  try {
    const issueEmails = newEmails.filter(e => triageById.get(e.id)?.isIssue);
    if (issueEmails.length) {
      const matchProps = await loadIssueSlipProperties(sb);
      for (const e of issueEmails) {
        const t = triageById.get(e.id);
        const prop = matchPropertyHint(t?.propertyHint, matchProps);
        if (!prop) continue;
        try {
          await createIssueSlipFromEmail(sb, prop, e, t?.summary ?? e.subject);
        } catch (err) {
          console.error('[syncUnreadEmails] issue slip failed', e.id, err);
        }
      }
    }
  } catch (err) {
    console.error('[syncUnreadEmails] issue slip pass failed', err);
  }

  // For already-cached emails: sync the read flag to current state (we now
  // fetch read mail too, so don't blindly force unread) + bump last_seen_at.
  // Triage classification stays untouched.
  const unreadById = new Map(fetched.map(e => [e.id, e.isUnread]));
  const refreshIds = fetched.filter(e => existing.has(e.id)).map(e => e.id);
  const refreshUnread = refreshIds.filter(id => unreadById.get(id));
  const refreshRead = refreshIds.filter(id => !unreadById.get(id));
  if (refreshUnread.length) {
    await sb
      .from('email_triage')
      .update({ is_unread: true, last_seen_at: nowIso })
      .in('gmail_message_id', refreshUnread);
  }
  if (refreshRead.length) {
    await sb
      .from('email_triage')
      .update({ is_unread: false, last_seen_at: nowIso })
      .in('gmail_message_id', refreshRead);
  }

  // Anything previously marked unread but NOT in the current inbox
  // has been read or archived in Gmail. Flip its flag so /today drops
  // it. Re-arriving unread (rare) will be re-flagged on the next sync.
  const stillUnreadIds = new Set(ids);
  const { data: previouslyUnread } = await sb
    .from('email_triage')
    .select('gmail_message_id')
    .eq('is_unread', true);
  const toMarkRead = ((previouslyUnread ?? []) as Array<{ gmail_message_id: string }>)
    .map(r => r.gmail_message_id)
    .filter(id => !stillUnreadIds.has(id));
  if (toMarkRead.length) {
    await sb
      .from('email_triage')
      .update({ is_unread: false, last_seen_at: nowIso })
      .in('gmail_message_id', toMarkRead);
  }

  return {
    fetched: fetched.length,
    classifiedNew: triaged.length,
    alreadyCached: fetched.length - triaged.length,
    markedRead: toMarkRead.length,
    draftsCreated,
  };
}

// Page-side. Pure read from the cache; one Supabase round-trip.
async function loadUnreadEmailsFromCache(): Promise<BriefEmail[]> {
  // Show unread mail AND any needs_reply (read or not) so a needs-reply
  // email doesn't vanish the moment it's opened on a phone — it stays until
  // it's replied (reply-detection drops it next sync) or cleared. 30d floor.
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data } = await supabase
    .from('email_triage')
    .select('gmail_message_id, thread_id, from_name, from_email, subject, snippet, received_at, triage, triage_summary, draft_id')
    .or('is_unread.eq.true,triage.eq.needs_reply')
    .neq('triage', 'notification')
    .gte('received_at', since30)
    .order('received_at', { ascending: false })
    .limit(40);
  type RowPick = Pick<
    EmailTriageRow,
    'gmail_message_id' | 'thread_id' | 'from_name' | 'from_email' | 'subject' | 'snippet' | 'received_at' | 'triage' | 'triage_summary' | 'draft_id'
  >;
  return ((data ?? []) as RowPick[]).map(r => ({
    id: r.gmail_message_id,
    threadId: r.thread_id,
    fromName: r.from_name,
    fromEmail: r.from_email,
    toEmails: [],
    ccEmails: [],
    subject: r.subject,
    snippet: r.snippet,
    receivedAt: r.received_at,
    ageHours: Math.max(0, Math.round((Date.now() - new Date(r.received_at).getTime()) / 3_600_000)),
    triage: r.triage,
    triageSummary: r.triage_summary,
    draftId: r.draft_id ?? null,
  }));
}

async function loadEmailTriageTotals(): Promise<{ needsReply: number; fyi: number; notifications: number; unread: number }> {
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data } = await supabase
    .from('email_triage')
    .select('triage, is_unread')
    .gte('received_at', since30);
  type RowPick = { triage: 'needs_reply' | 'fyi' | 'notification'; is_unread: boolean };
  const rows = (data ?? []) as RowPick[];
  return {
    // needs_reply persists whether or not it's been read; fyi/notification
    // stay unread-only (a read note isn't "waiting").
    needsReply: rows.filter(r => r.triage === 'needs_reply').length,
    fyi: rows.filter(r => r.triage === 'fyi' && r.is_unread).length,
    notifications: rows.filter(r => r.triage === 'notification' && r.is_unread).length,
    unread: rows.filter(r => r.is_unread).length,
  };
}

// ── Issue emails → work slips ───────────────────────────────────────

type MatchProperty = { id: string; name: string; address: string | null; title: string | null };

async function loadIssueSlipProperties(sb: SupabaseClient): Promise<MatchProperty[]> {
  const { data } = await sb.from('properties').select('id, name, address, title');
  return (data ?? []) as MatchProperty[];
}

function normalizeHint(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Match the LLM's property hint against a Helm property by name, street
// address, or listing title. Returns null unless one matches confidently.
function matchPropertyHint(hint: string | null | undefined, props: MatchProperty[]): MatchProperty | null {
  if (!hint) return null;
  const h = normalizeHint(hint);
  if (h.length < 3) return null;
  for (const p of props) {
    const candidates = [p.name, p.address, p.title]
      .filter((c): c is string => Boolean(c))
      .map(normalizeHint)
      .filter(c => c.length >= 3);
    for (const c of candidates) {
      if (h.includes(c) || c.includes(h)) return p;
    }
  }
  return null;
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n).trim()}…` : s;
}

async function createIssueSlipFromEmail(
  sb: SupabaseClient,
  prop: MatchProperty,
  email: { id: string; fromName: string | null; fromEmail: string | null; subject: string; snippet: string },
  summary: string,
): Promise<void> {
  const sender = email.fromName || email.fromEmail || 'someone';
  await sb
    .from('work_slips')
    .insert({
      property_id: prop.id,
      title: `${prop.name}: ${truncate(summary || email.subject, 60)}`,
      description: [
        `Reported via email from ${sender}.`,
        '',
        `Subject: ${email.subject}`,
        email.snippet ? `\n${email.snippet}` : '',
        '',
        'Auto-created from a triaged issue email. Recategorize, assign, or close as needed.',
      ].join('\n'),
      action_summary: truncate(summary || email.subject, 120),
      category: 'maintenance',
      priority: 'normal',
      status: 'open',
      from_gmail_message_id: email.id,
      created_by_email: 'triage@helm.system',
    })
    .then((r) => {
      if (r.error && !['23505', '42703', '42P01'].includes(r.error.code)) throw r.error;
    });
}

export async function loadDailyBrief(): Promise<DailyBrief> {
  const todayIso = today();

  type ContactPick = { id: string; first_name: string | null; last_name: string | null; name: string | null };
  type InboundTouchPick = {
    id: string;
    contact_id: string;
    channel: string;
    summary: string;
    touched_at: string;
    direction: 'inbound' | 'outbound';
  };
  type ReservationPick = {
    property_id: string;
    guest_name: string | null;
    channel: string | null;
    check_in: string;
    check_out: string;
  };
  type PropertyPick = { id: string; name: string };
  type StatementJoin = { property_id: string; property_name: string | null; month: string | null };
  type DataGapPick = {
    id: string;
    gap_type: string;
    description: string | null;
    severity: string | null;
    resolved: boolean | null;
    property_statement_id: string | null;
    // Supabase infers FK joins as arrays even when 1:1; we read the
    // first row in case the type lands either way.
    property_statements: StatementJoin | StatementJoin[] | null;
  };

  type InspectionPick = { id: string; property_id: string; started_at: string | null; completed_at: string | null };
  type ProspectPick = {
    id: string;
    prospect_name: string;
    property_address: string;
    property_city: string | null;
    status: 'draft' | 'sent';
    sent_at: string | null;
    close_likelihood_pct: number | null;
    created_at: string;
  };
  type SyncStatusPick = { source: string; last_synced_at: string | null };

  // 30-day cutoff for "recently sent" prospects still awaiting response.
  const prospectCutoffIso = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [
    { data: properties },
    { data: slips },
    { data: tasks },
    { data: checkouts },
    { data: checkins },
    { data: touches },
    { data: contacts },
    { data: gaps },
    { data: inspectionsToday },
    { data: prospects },
    { data: syncRows },
    unreadEmails,
    emailTotals,
  ] = await Promise.all([
    supabase.from('properties').select('id, name').eq('is_active', true),
    supabase
      .from('work_slips')
      .select('*')
      .in('status', ACTIVE_WORK_SLIP_STATUSES)
      .or(`snoozed_until.is.null,snoozed_until.lte.${todayIso}`)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('tasks')
      .select('*')
      .in('status', ACTIVE_TASK_STATUSES)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('guesty_reservations')
      .select('property_id, guest_name, channel, check_in, check_out')
      .eq('check_out', todayIso),
    supabase
      .from('guesty_reservations')
      .select('property_id, guest_name, channel, check_in, check_out')
      .eq('check_in', todayIso),
    // Last 14 days of inbound + outbound touches; we resolve "still
    // waiting" by checking if any outbound touch exists for the same
    // contact after the inbound timestamp.
    supabase
      .from('contact_touches')
      .select('id, contact_id, channel, summary, touched_at, direction')
      .gte('touched_at', new Date(Date.now() - 14 * 86_400_000).toISOString())
      .order('touched_at', { ascending: false }),
    supabase.from('contacts').select('id, first_name, last_name, name'),
    // Pull recent unresolved gaps with statement context joined in.
    supabase
      .from('data_gaps')
      .select(
        'id, gap_type, description, severity, resolved, property_statement_id, property_statements(property_id, property_name, month)',
      )
      .eq('resolved', false)
      .order('id', { ascending: false })
      .limit(50),
    supabase
      .from('inspections')
      .select('id, property_id, started_at, completed_at')
      .gte('completed_at', `${todayIso}T00:00:00`)
      .lte('completed_at', `${todayIso}T23:59:59.999`)
      .order('completed_at', { ascending: false }),
    // Drafts (need-to-send) + recently-sent (awaiting response). Older
    // sent prospects are still in the funnel but don't surface in the
    // morning brief.
    supabase
      .from('projections')
      .select('id, prospect_name, property_address, property_city, status, sent_at, close_likelihood_pct, created_at')
      .or(`status.eq.draft,and(status.eq.sent,sent_at.gte.${prospectCutoffIso})`)
      .order('created_at', { ascending: false }),
    supabase.from('sync_status').select('source, last_synced_at'),
    loadUnreadEmailsFromCache().catch(() => [] as BriefEmail[]),
    loadEmailTriageTotals().catch(() => ({ needsReply: 0, fyi: 0, notifications: 0, unread: 0 })),
  ]);

  const propertyById = new Map<string, string>();
  for (const p of (properties ?? []) as PropertyPick[]) {
    propertyById.set(p.id, p.name);
  }

  const contactById = new Map<string, ContactPick>();
  for (const c of (contacts ?? []) as ContactPick[]) {
    contactById.set(c.id, c);
  }

  const toStay = (r: ReservationPick): BriefStay => ({
    propertyId: r.property_id,
    propertyName: propertyById.get(r.property_id) ?? r.property_id,
    guestName: r.guest_name,
    channel: r.channel,
    checkIn: r.check_in,
    checkOut: r.check_out,
  });

  const allSlips = (slips ?? []) as WorkSlipRow[];
  const highPrioritySlips = allSlips.filter(s => s.priority === 'high');
  const ownerActionSlips = allSlips.filter(
    s => s.owner_action_required && (s.owner_status ?? 'not_sent') !== 'approved',
  );

  const allTasks = (tasks ?? []) as TaskRow[];
  const dueTasks = allTasks.filter(t => {
    if (t.priority === 'high') return true;
    if (!t.due_date) return false;
    return t.due_date <= todayIso;
  });

  // Reply-needed: most-recent inbound per contact with no outbound
  // touch newer than that inbound.
  const allTouches = (touches ?? []) as InboundTouchPick[];
  const latestInboundByContact = new Map<string, InboundTouchPick>();
  const latestOutboundByContact = new Map<string, string>();
  for (const t of allTouches) {
    if (t.direction === 'inbound') {
      const existing = latestInboundByContact.get(t.contact_id);
      if (!existing || t.touched_at > existing.touched_at) {
        latestInboundByContact.set(t.contact_id, t);
      }
    } else {
      const existing = latestOutboundByContact.get(t.contact_id);
      if (!existing || t.touched_at > existing) {
        latestOutboundByContact.set(t.contact_id, t.touched_at);
      }
    }
  }
  const inboundWaiting: BriefInboundTouch[] = [];
  for (const [contactId, inbound] of latestInboundByContact) {
    const lastOut = latestOutboundByContact.get(contactId);
    if (lastOut && lastOut >= inbound.touched_at) continue;
    const contact = contactById.get(contactId);
    const name = contact
      ? contact.name ||
        [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim() ||
        null
      : null;
    inboundWaiting.push({
      contactId,
      contactName: name,
      channel: inbound.channel,
      summary: inbound.summary,
      touchedAt: inbound.touched_at,
      daysWaiting: daysBetween(inbound.touched_at, new Date().toISOString()),
    });
  }
  inboundWaiting.sort((a, b) => (a.touchedAt < b.touchedAt ? 1 : -1));

  const unresolvedDataGaps: BriefDataGap[] = ((gaps ?? []) as unknown as DataGapPick[]).map(g => {
    const stmt: StatementJoin | null = Array.isArray(g.property_statements)
      ? g.property_statements[0] ?? null
      : g.property_statements;
    return {
      id: g.id,
      propertyId: stmt?.property_id ?? null,
      propertyName:
        stmt?.property_name ??
        (stmt?.property_id ? propertyById.get(stmt.property_id) ?? null : null),
      month: stmt?.month ?? null,
      gapType: g.gap_type,
      description: g.description,
      severity: g.severity,
    };
  });

  let pendingApprovals: Approval[] = [];
  const scConfigured = isStayConciergeConfigured();
  if (scConfigured) {
    try {
      const res = await listApprovals();
      if (res.ok) pendingApprovals = res.data.approvals;
    } catch {
      // Stay Concierge is best-effort; the brief still renders without it.
    }
  }

  const inspectionsCompletedToday: BriefInspection[] = ((inspectionsToday ?? []) as InspectionPick[]).map(i => ({
    id: i.id,
    propertyId: i.property_id,
    propertyName: propertyById.get(i.property_id) ?? i.property_id,
    completedAt: i.completed_at,
    startedAt: i.started_at,
  }));

  const activeProspects: BriefProspect[] = ((prospects ?? []) as ProspectPick[]).map(p => {
    const daysSinceSent = p.sent_at
      ? daysBetween(p.sent_at, new Date().toISOString())
      : null;
    return {
      id: p.id,
      prospectName: p.prospect_name,
      propertyAddress: p.property_address,
      propertyCity: p.property_city,
      status: p.status,
      sentAt: p.sent_at,
      closeLikelihoodPct: p.close_likelihood_pct,
      daysSinceSent,
    };
  });
  // Drafts first (most actionable), then most-recently-sent.
  activeProspects.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'draft' ? -1 : 1;
    const aKey = a.sentAt ?? '';
    const bKey = b.sentAt ?? '';
    return aKey < bKey ? 1 : -1;
  });

  const syncBySource = new Map<string, string | null>();
  for (const r of (syncRows ?? []) as SyncStatusPick[]) {
    syncBySource.set(r.source, r.last_synced_at);
  }
  const lastGmailSyncAt = syncBySource.get('gmail-replies') ?? null;

  // Triage tallies come from the cache (loadEmailTriageTotals counts
  // every unread row, including notifications). The page-visible list
  // already excluded notifications at SELECT time.
  const visibleUnreadEmails = unreadEmails;

  return {
    date: todayIso,
    checkoutsToday: ((checkouts ?? []) as ReservationPick[]).map(toStay),
    checkinsToday: ((checkins ?? []) as ReservationPick[]).map(toStay),
    inspectionsCompletedToday,
    highPrioritySlips,
    ownerActionSlips,
    dueTasks,
    inboundWaiting,
    unreadEmails: visibleUnreadEmails,
    unresolvedDataGaps,
    pendingApprovals,
    activeProspects,
    stayConciergeConfigured: scConfigured,
    lastGmailSyncAt,
    gmailConfigured: gmailConfigured(),
    totals: {
      activeSlips: allSlips.length,
      activeTasks: allTasks.length,
      waitingReplies: inboundWaiting.length,
      unread: emailTotals.unread,
      needsReply: emailTotals.needsReply,
      fyi: emailTotals.fyi,
      notifications: emailTotals.notifications,
      dataGaps: unresolvedDataGaps.length,
      approvals: pendingApprovals.length,
      inspectionsToday: inspectionsCompletedToday.length,
      activeProspects: activeProspects.length,
    },
  };
}

export function briefHeadline(brief: DailyBrief): string {
  const draftProspects = brief.activeProspects.filter(p => p.status === 'draft').length;
  const bits: string[] = [];
  if (brief.totals.needsReply) bits.push(`${brief.totals.needsReply} email${brief.totals.needsReply === 1 ? '' : 's'} need${brief.totals.needsReply === 1 ? 's' : ''} a reply`);
  if (brief.checkinsToday.length) bits.push(`${brief.checkinsToday.length} check-in${brief.checkinsToday.length === 1 ? '' : 's'}`);
  if (brief.totals.approvals) bits.push(`${brief.totals.approvals} draft${brief.totals.approvals === 1 ? '' : 's'} to review`);
  if (brief.checkoutsToday.length) bits.push(`${brief.checkoutsToday.length} checkout${brief.checkoutsToday.length === 1 ? '' : 's'}`);
  if (draftProspects) bits.push(`${draftProspects} prospect draft${draftProspects === 1 ? '' : 's'}`);
  if (!bits.length) return 'Clear deck. Have a great day.';
  return bits.join(', ');
}

export function helmBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_HELM_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'https://statements.risingtidestr.com'
  );
}
