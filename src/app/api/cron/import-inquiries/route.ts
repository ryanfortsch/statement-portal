import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import { parseInquiryEmail, splitAddressLine, inferMarketFromCity } from '@/lib/inquiry-parser';
import type { Owner } from '@/lib/projections-types';
import { deriveLegacyFromOwners } from '@/lib/projections-types';

/**
 * GET /api/cron/import-inquiries
 *
 * Scans configured Gmail mailboxes for new inbound inquiry-form emails
 * (the "Schedule a call" form on risingtidestr.com and similar
 * structured-body submissions), parses them, and creates a draft
 * projection per match so the prospect lands in Helm without Dotti
 * copying fields out of an email by hand.
 *
 * Dedup is Gmail-label-based: each processed message gets a
 * `helm/imported` label applied via Gmail's labels API, and the search
 * query excludes any message already carrying that label. Replays
 * (cron retrying after a partial failure) are safe because Gmail's
 * label modify is idempotent.
 *
 * Mailbox config reuses the same env-var pattern as sync-prospect-mail
 * + sync-gmail-replies. To monitor a new mailbox, drop a refresh
 * token into the matching env var.
 *
 * Cron schedule lives in vercel.json. Endpoint is also callable
 * manually for testing.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

type Mailbox = {
  name: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
};

const MAILBOXES: Mailbox[] = [
  {
    name: 'Allie',
    refreshToken: process.env.GMAIL_REFRESH_TOKEN || process.env.GMAIL_REFRESH_TOKEN_ALLIE || '',
    clientId: process.env.GMAIL_CLIENT_ID || '',
    clientSecret: process.env.GMAIL_CLIENT_SECRET || '',
  },
  {
    name: 'Dotti',
    refreshToken: process.env.GMAIL_REFRESH_TOKEN_DOTTI || '',
    clientId: process.env.GMAIL_CLIENT_ID_DOTTI || process.env.GMAIL_CLIENT_ID || '',
    clientSecret: process.env.GMAIL_CLIENT_SECRET_DOTTI || process.env.GMAIL_CLIENT_SECRET || '',
  },
  {
    name: 'Ryan',
    refreshToken: process.env.GMAIL_REFRESH_TOKEN_RYAN || '',
    clientId: process.env.GMAIL_CLIENT_ID_RYAN || process.env.GMAIL_CLIENT_ID || '',
    clientSecret: process.env.GMAIL_CLIENT_SECRET_RYAN || process.env.GMAIL_CLIENT_SECRET || '',
  },
].filter((m) => m.refreshToken && m.clientId && m.clientSecret);

const HELM_LABEL_NAME = 'helm/imported';
// Search query: looks at the last week of inbox for messages whose body
// carries the structured-form signature (firstName + address + phone),
// excludes anything we've already labeled, and avoids spam/trash. Gmail's
// search is body-content aware so the field names match real text in
// the message.
const SEARCH_Q = '("firstName" OR "first name" OR "_replyto") "address" "phone" newer_than:14d -label:helm/imported in:inbox';

let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (_sb) return _sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  _sb = createClient(url, key);
  return _sb;
}

async function getAccessToken(mb: Mailbox): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: mb.clientId,
      client_secret: mb.clientSecret,
      refresh_token: mb.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Refresh token for ${mb.name} failed: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

/**
 * Ensure the `helm/imported` label exists on this mailbox; create it on
 * first run. Returns the label's Gmail id, which we need to apply it to
 * processed messages.
 */
async function ensureHelmLabel(accessToken: string): Promise<string> {
  const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) throw new Error(`labels.list failed: ${await listRes.text()}`);
  const listData = (await listRes.json()) as { labels?: Array<{ id: string; name: string }> };
  const found = (listData.labels ?? []).find((l) => l.name === HELM_LABEL_NAME);
  if (found) return found.id;

  const createRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: HELM_LABEL_NAME,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    }),
  });
  if (!createRes.ok) throw new Error(`labels.create failed: ${await createRes.text()}`);
  const createData = (await createRes.json()) as { id: string };
  return createData.id;
}

type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
};

/**
 * Walk a Gmail message payload and return the first text body found.
 * Prefers text/plain over text/html; falls back to html with a strip
 * when text isn't present. Returns empty string for unparseable
 * structures (those messages get skipped by parseInquiryEmail).
 */
function extractBody(payload: GmailPart | undefined): string {
  if (!payload) return '';
  const queue: GmailPart[] = [payload];
  let htmlFallback = '';
  while (queue.length) {
    const part = queue.shift()!;
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return decodeB64Url(part.body.data);
    }
    if (part.mimeType === 'text/html' && part.body?.data && !htmlFallback) {
      htmlFallback = decodeB64Url(part.body.data);
    }
    if (part.parts?.length) queue.push(...part.parts);
  }
  return htmlFallback;
}

function decodeB64Url(s: string): string {
  // Gmail returns URL-safe base64 without padding.
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const normal = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  try {
    return Buffer.from(normal, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

async function applyLabel(accessToken: string, messageId: string, labelId: string): Promise<void> {
  await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ addLabelIds: [labelId] }),
  });
}

function newOnboardingToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

type ImportResult = {
  message_id: string;
  status: 'created' | 'skipped' | 'failed';
  reason?: string;
  projection_id?: string;
};

/** Process one Gmail message: fetch body, parse, create, label. */
async function processMessage(
  accessToken: string,
  messageId: string,
  labelId: string,
  mailboxName: string,
  sb: SupabaseClient,
): Promise<ImportResult> {
  try {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!msgRes.ok) return { message_id: messageId, status: 'skipped', reason: 'fetch failed' };
    const msg = (await msgRes.json()) as { payload?: GmailPart };
    const body = extractBody(msg.payload);
    if (!body) return { message_id: messageId, status: 'skipped', reason: 'no body' };

    const parsed = parseInquiryEmail(body);
    if (!parsed) return { message_id: messageId, status: 'skipped', reason: 'unparseable' };

    // Idempotency: if a projection already references this message id,
    // just label and move on. Catches the case where Gmail's label add
    // failed on a prior run but the projection got created. Lookup via
    // jsonb path on import_source (single column carries the whole
    // audit trail — see migration 20260609).
    const { data: existing } = await sb
      .from('projections')
      .select('id')
      .filter('import_source->>gmail_message_id', 'eq', messageId)
      .maybeSingle();
    if (existing) {
      await applyLabel(accessToken, messageId, labelId);
      return { message_id: messageId, status: 'skipped', reason: 'already imported', projection_id: (existing as { id: string }).id };
    }

    const addr = splitAddressLine(parsed.address);
    const city = addr.city || '';
    const market = inferMarketFromCity(city);
    const propertyCity = city ? `${city}${addr.state ? `, ${addr.state}` : ''}` : `${market}, MA`;

    const owners: Owner[] = [{
      first_name: parsed.firstName,
      last_name: parsed.lastName,
      email: parsed.email,
      phone: parsed.phone,
      full_legal: null,
    }];
    const derived = deriveLegacyFromOwners(owners);

    const now = new Date();
    const presentationMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const payload = {
      owners,
      ...derived,
      property_address: addr.street || parsed.address,
      property_city: propertyCity,
      property_type: 'House',
      market,
      bedrooms: 2,                 // sensible default; analyst edits before sending
      home_value: 0,               // forces analyst to fill before generating deck
      neighborhood: null,
      interior_grade: null,

      mgmt_fee_pct: 0.25,
      base_cleaning: 200,
      addl_cleaning_per_br: 50,
      turnovers_per_year: 30,
      year2_growth_pct: 0.10,

      start_month: now.getMonth() + 1,
      apply_ramp: false,
      presentation_month: presentationMonth,

      // Default contract terms (analyst can change). Matches the new-prospect
      // form defaults so an imported prospect feels like a hand-keyed one.
      initial_deposit: 2000,
      min_account_balance: 2000,
      min_availability_days: 270,
      sale_notification_days: 90,
      reputation_fee: 5000,

      status: 'draft' as const,
      onboarding_token: newOnboardingToken(),

      created_by_email: `auto-import@helm (${mailboxName})`,
      created_by_name: 'Auto-import',

      // Audit trail + idempotency key. The next cron run looks up by
      // import_source->>gmail_message_id to avoid re-creating; Gmail's
      // label add on success is the primary dedup.
      import_source: {
        source: 'gmail_inquiry',
        gmail_message_id: messageId,
        mailbox: mailboxName,
        kind: parsed.kind || 'inquiry',
        requested_slot: parsed.requestedSlot,
        notes: parsed.notes,
        imported_at: new Date().toISOString(),
      },
    };

    const { data: inserted, error: insertErr } = await sb
      .from('projections')
      .insert(payload)
      .select('id')
      .single();

    if (insertErr || !inserted) {
      return { message_id: messageId, status: 'failed', reason: insertErr?.message || 'insert returned no row' };
    }

    await applyLabel(accessToken, messageId, labelId);

    return { message_id: messageId, status: 'created', projection_id: (inserted as { id: string }).id };
  } catch (err) {
    return { message_id: messageId, status: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET(request: NextRequest) {
  // Cron auth — matches the pattern used by the other crons in this
  // codebase (marketing-sync, channels-sync, etc.). Vercel sends
  // `Authorization: Bearer <CRON_SECRET>` on scheduled runs when
  // CRON_SECRET is set in env. The previous check used
  // `x-vercel-cron: 1`, which Vercel doesn't reliably send — that's
  // why every 15-min tick was 401'ing silently.
  //
  // If CRON_SECRET is unset, the route's open (early dev) — both
  // Vercel cron and any ad-hoc caller hit it. Once set, only requests
  // with the matching bearer get through, plus `?secret=` for manual
  // testing without crafting a header.
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization') || '';
  const queryParam = request.nextUrl.searchParams.get('secret');
  if (cronSecret) {
    const headerOk = authHeader === `Bearer ${cronSecret}`;
    const queryOk = queryParam === cronSecret;
    if (!headerOk && !queryOk) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  if (MAILBOXES.length === 0) {
    return NextResponse.json({
      ok: true,
      note: 'no mailboxes configured (set GMAIL_REFRESH_TOKEN_* env vars)',
      processed: 0,
    });
  }

  const sb = getSupabase();
  const perMailbox: Array<{ mailbox: string; processed: number; results: ImportResult[]; error?: string }> = [];

  for (const mb of MAILBOXES) {
    try {
      const accessToken = await getAccessToken(mb);
      const labelId = await ensureHelmLabel(accessToken);

      const searchUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(SEARCH_Q)}&maxResults=25`;
      const searchRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!searchRes.ok) throw new Error(`messages.list failed: ${await searchRes.text()}`);
      const searchData = (await searchRes.json()) as { messages?: Array<{ id: string }> };
      const messages = searchData.messages ?? [];

      const results: ImportResult[] = [];
      for (const m of messages) {
        const r = await processMessage(accessToken, m.id, labelId, mb.name, sb);
        results.push(r);
      }
      perMailbox.push({ mailbox: mb.name, processed: results.length, results });
    } catch (err) {
      perMailbox.push({
        mailbox: mb.name,
        processed: 0,
        results: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const created = perMailbox.reduce(
    (n, mb) => n + mb.results.filter((r) => r.status === 'created').length,
    0,
  );
  return NextResponse.json({ ok: true, created, perMailbox });
}
