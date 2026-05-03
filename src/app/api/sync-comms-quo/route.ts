import { NextRequest, NextResponse } from 'next/server';
import { supabase, isConfigured } from '@/lib/supabase';

/**
 * Sync texts and (later) calls from Quo (OpenPhone) into public.comms.
 *
 * Strategy:
 *   1. Build a phone -> owner_id map from public.owners.phones.
 *   2. List conversations on our Quo phone number, paginated.
 *   3. For each conversation whose participants include an owner phone,
 *      list the messages and upsert them into public.comms.
 *   4. Stop walking conversations once we hit one whose lastActivityAt is
 *      older than the `since` cutoff (Quo returns conversations sorted by
 *      lastActivityAt desc).
 *
 * Auth: requires QUO_API_KEY in env. Phone numbers are matched in E.164
 * format (e.g., "+19782658548"). Conversations with no matching owner are
 * skipped silently — those messages stay in Quo, not Helm.
 *
 * Idempotent: comms.unique(source, external_id) means re-running just
 * upserts. Safe to call from a button or a cron.
 *
 * Query params:
 *   ?days=30        Lookback window in days (default 30, max 365).
 *   ?phoneNumberId  Override the Quo phone number to sync (default: first
 *                   one we find on the account).
 */

const QUO_BASE = 'https://api.openphone.com/v1';

type QuoConversation = {
  id: string;
  participants: string[];
  phoneNumberId: string;
  lastActivityAt: string;
};

type QuoMessage = {
  id: string;
  to: string[];
  from: string;
  text: string;
  phoneNumberId: string;
  direction: 'incoming' | 'outgoing';
  status: string;
  createdAt: string;
  updatedAt: string;
};

type QuoListResponse<T> = {
  data: T[];
  totalItems: number;
  nextPageToken: string | null;
};

async function quoFetch<T>(path: string, key: string): Promise<T> {
  const res = await fetch(`${QUO_BASE}${path}`, {
    headers: { Authorization: key },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Quo API ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function getDefaultPhoneNumberId(key: string): Promise<string> {
  const res = await quoFetch<{ data: { id: string }[] }>('/phone-numbers', key);
  if (!res.data?.[0]?.id) throw new Error('No phone numbers on Quo account');
  return res.data[0].id;
}

export async function POST(req: NextRequest) {
  const key = process.env.QUO_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'QUO_API_KEY not configured' }, { status: 500 });
  }
  if (!isConfigured) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const url = new URL(req.url);
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days') || 30)));
  const phoneNumberIdOverride = url.searchParams.get('phoneNumberId');

  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const sinceISO = new Date(sinceMs).toISOString();

  // 1. Phone -> owner_id map.
  const { data: owners, error: ownersErr } = await supabase
    .from('owners')
    .select('id, name_last, phones');
  if (ownersErr) {
    return NextResponse.json({ error: `owners read failed: ${ownersErr.message}` }, { status: 500 });
  }
  const phoneToOwner = new Map<string, string>();
  for (const o of owners ?? []) {
    for (const p of (o.phones as string[]) ?? []) {
      phoneToOwner.set(p, o.id as string);
    }
  }
  if (phoneToOwner.size === 0) {
    return NextResponse.json({
      error: 'No owners.phones populated yet — nothing to match Quo conversations against',
    }, { status: 400 });
  }

  // 2. Determine which Quo phone number to sync.
  const phoneNumberId = phoneNumberIdOverride || (await getDefaultPhoneNumberId(key));

  // 3. Walk conversations until we cross the `since` cutoff.
  const stats = {
    days,
    sinceISO,
    phoneNumberId,
    conversations_scanned: 0,
    conversations_matched: 0,
    messages_fetched: 0,
    messages_upserted: 0,
    owners_with_activity: new Set<string>(),
    matched_phones: new Set<string>(),
  };

  let token: string | null = null;
  let stop = false;
  let safety = 0;

  while (!stop && safety < 20) {
    safety++;
    const path: string =
      `/conversations?phoneNumberId=${encodeURIComponent(phoneNumberId)}&maxResults=50` +
      (token ? `&pageToken=${encodeURIComponent(token)}` : '');
    const page: QuoListResponse<QuoConversation> = await quoFetch<QuoListResponse<QuoConversation>>(path, key);

    for (const conv of page.data) {
      stats.conversations_scanned++;
      // Conversations come sorted by lastActivityAt desc — first one older
      // than cutoff means everything after is also too old.
      if (Date.parse(conv.lastActivityAt) < sinceMs) {
        stop = true;
        break;
      }

      // Find the first matching participant. (For 1:1 SMS there's exactly
      // one; group SMS rare here.)
      const matchedPhone = conv.participants.find((p) => phoneToOwner.has(p));
      if (!matchedPhone) continue;

      const ownerId = phoneToOwner.get(matchedPhone)!;
      stats.conversations_matched++;
      stats.matched_phones.add(matchedPhone);

      // 4. Pull messages for this conversation. Quo's /messages endpoint
      // wants the participant phone, not the conversation id.
      let mToken: string | null = null;
      let mSafety = 0;
      while (mSafety < 10) {
        mSafety++;
        const mPath: string =
          `/messages?phoneNumberId=${encodeURIComponent(phoneNumberId)}` +
          `&participants=${encodeURIComponent(matchedPhone)}&maxResults=50` +
          (mToken ? `&pageToken=${encodeURIComponent(mToken)}` : '');
        const mPage: QuoListResponse<QuoMessage> = await quoFetch<QuoListResponse<QuoMessage>>(mPath, key);

        const rows = [];
        for (const m of mPage.data) {
          stats.messages_fetched++;
          if (Date.parse(m.createdAt) < sinceMs) continue;
          const text = m.text || '';
          rows.push({
            owner_id: ownerId,
            property_id: null,
            source: 'quo',
            direction: m.direction === 'incoming' ? 'inbound' : 'outbound',
            sent_at: m.createdAt,
            subject: null,
            preview: text.slice(0, 240),
            body: text,
            participants: m.direction === 'incoming' ? [m.from] : m.to,
            external_id: m.id,
            external_thread_id: conv.id,
            external_url: null,
            meta: { status: m.status, userId: (m as { userId?: string }).userId ?? null },
          });
        }

        if (rows.length > 0) {
          const { error: upErr } = await supabase
            .from('comms')
            .upsert(rows, { onConflict: 'source,external_id', ignoreDuplicates: false });
          if (upErr) {
            return NextResponse.json({
              error: `comms upsert failed: ${upErr.message}`,
              partial_stats: serializeStats(stats),
            }, { status: 500 });
          }
          stats.messages_upserted += rows.length;
          stats.owners_with_activity.add(ownerId);
        }

        if (!mPage.nextPageToken) break;
        mToken = mPage.nextPageToken;
      }
    }

    if (stop || !page.nextPageToken) break;
    token = page.nextPageToken;
  }

  return NextResponse.json({ ok: true, ...serializeStats(stats) });
}

function serializeStats(s: {
  days: number;
  sinceISO: string;
  phoneNumberId: string;
  conversations_scanned: number;
  conversations_matched: number;
  messages_fetched: number;
  messages_upserted: number;
  owners_with_activity: Set<string>;
  matched_phones: Set<string>;
}) {
  return {
    days: s.days,
    since: s.sinceISO,
    phone_number_id: s.phoneNumberId,
    conversations_scanned: s.conversations_scanned,
    conversations_matched: s.conversations_matched,
    messages_fetched: s.messages_fetched,
    messages_upserted: s.messages_upserted,
    owners_with_activity: s.owners_with_activity.size,
    matched_phones: Array.from(s.matched_phones),
  };
}
