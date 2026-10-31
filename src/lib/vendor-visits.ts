/**
 * Vendor visit holds, detection (2026-10-18). Called by the Quo ingest for
 * every inbound text, on every line.
 *
 * A text from a trade vendor (trade_vendors.phone or after_hours_phone) that
 * names a visit day files ONE row in vendor_visit_proposals, and that row is
 * the only thing this module ever writes. The calendar hold and the slip
 * stamps happen in vendor-visit-approve.ts, on the operator's approve, and
 * nowhere else: vendor-visit-guard.test.ts reads this file to keep it so.
 *
 * Kept light on purpose (no AI, no Field or calendar imports), because it
 * runs inside the webhook.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePhone, phonesMatch, type QuoLine } from './quo-lines.ts';
import { etDateOf, readOfferWindows, readVisitDate, type OfferWindow } from './vendor-visit-dates.ts';
import { matchVisitProperty, type RosterEntry } from './vendor-visit-core.ts';

export type InboundVendorText = {
  messageId: string;
  from: string;
  body: string;
  /** The message's own time (ISO). */
  at: string;
  line: QuoLine | null;
};

type TradeVendorLite = {
  id: string;
  name: string;
  category: string;
  phone: string | null;
  after_hours_phone: string | null;
  property_ids: string[] | null;
};

/** How far back our offer to the vendor is looked for, and how long a
 *  pending or approved visit makes a dateless "see you then" redundant. */
export const OFFER_LOOKBACK_DAYS = 21;

/** A dateless or unclear text older than this is history, not a question. */
const STALE_QUESTION_MS = 3 * 86_400_000;

/** Missing table or column: the migration has not landed. No proposal. */
const NOT_MIGRATED = new Set(['42P01', '42703', 'PGRST205']);

export type ProposeResult = { id: string; status: 'pending' | 'superseded' } | null;

/** The vendor this number belongs to, if it is one. Archived vendors are
 *  not dispatched, so their texts make no cards. */
export async function findTradeVendorByPhone(db: SupabaseClient, phone: string): Promise<TradeVendorLite | null> {
  if (!normalizePhone(phone)) return null;
  const { data, error } = await db
    .from('trade_vendors')
    .select('id, name, category, phone, after_hours_phone, property_ids')
    .is('archived_at', null);
  if (error) {
    if (NOT_MIGRATED.has(error.code ?? '')) return null;
    throw new Error(`trade_vendors: ${error.message}`);
  }
  return ((data ?? []) as TradeVendorLite[]).find((v) => phonesMatch(v.phone, phone) || phonesMatch(v.after_hours_phone, phone)) ?? null;
}

type Offer = { body: string; at: string; windows: OfferWindow[]; propertyId: string | null };

/**
 * Our latest outbound text to this number in the lookback that names a day
 * or a home: the offer the vendor is answering. Read from quo_events (every
 * delivered message is there), so it works whichever line we texted from
 * and whether the text went out from Helm or from the Quo app.
 */
async function findOffer(db: SupabaseClient, phone: string, at: string, roster: readonly RosterEntry[]): Promise<Offer | null> {
  const digits = normalizePhone(phone);
  if (digits.length < 10) return null;
  const since = new Date(Date.parse(at) - OFFER_LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data, error } = await db
    .from('quo_events')
    .select('payload, received_at')
    .eq('event_type', 'message.delivered')
    .gte('received_at', since)
    .lte('received_at', at)
    .like('payload->data->object->>to', `%${digits}%`)
    .order('received_at', { ascending: false })
    .limit(10);
  if (error) return null;
  for (const row of (data ?? []) as Array<{ payload: { data?: { object?: { body?: string | null; text?: string | null; createdAt?: string } } }; received_at: string }>) {
    const obj = row.payload?.data?.object;
    const body = (obj?.body ?? obj?.text ?? '').trim();
    if (!body) continue;
    const sentAt = obj?.createdAt ?? row.received_at;
    const windows = readOfferWindows(body, etDateOf(sentAt));
    const property = matchVisitProperty(body, roster);
    if (windows.length > 0 || property) return { body, at: sentAt, windows, propertyId: property?.id ?? null };
  }
  return null;
}

/** The live roster: every active home, so a home added in Helm matches the
 *  day it exists. An unreadable roster matches nothing (the card asks). */
async function loadRoster(db: SupabaseClient): Promise<RosterEntry[]> {
  const { data, error } = await db.from('properties').select('id, name, listing_match').eq('is_active', true).limit(500);
  if (error || !data) return [];
  return data as RosterEntry[];
}

/**
 * File a proposal for a trade vendor's text, or do nothing.
 *
 * Returns null when the sender is not a trade vendor, the text is not about
 * a visit day, or the event is a replay. Never throws for a missing table.
 * Writes only vendor_visit_proposals.
 */
export async function proposeVendorVisit(db: SupabaseClient, msg: InboundVendorText, now: Date = new Date()): Promise<ProposeResult> {
  if (!msg.from || !msg.body?.trim() || !msg.messageId || !msg.at) return null;
  const vendor = await findTradeVendorByPhone(db, msg.from);
  if (!vendor) return null;

  const today = etDateOf(msg.at);
  const roster = await loadRoster(db);
  const offer = await findOffer(db, msg.from, msg.at, roster);
  const windows = (offer?.windows ?? []).filter((w) => w.end >= today);
  const read = readVisitDate(msg.body, { today, windows, hasOffer: !!offer });
  if (read.kind === 'none') return null;
  // A replay or a history backfill (an unknown number promoted to a contact
  // replays every old event) must not raise cards for visits already past,
  // nor questions about week-old texts.
  if (read.kind === 'date' && read.end < etDateOf(now)) return null;
  if (read.kind === 'ask' && now.getTime() - Date.parse(msg.at) > STALE_QUESTION_MS) return null;

  const since = new Date(Date.parse(msg.at) - OFFER_LOOKBACK_DAYS * 86_400_000).toISOString();
  if (read.kind === 'ask' && read.dateless) {
    // "See you then" after a visit is already on a card or approved adds
    // nothing, and must never replace a dated card with a question.
    const { data, error } = await db
      .from('vendor_visit_proposals')
      .select('id')
      .eq('trade_vendor_id', vendor.id)
      .in('status', ['pending', 'approving', 'approved'])
      .gte('message_at', since)
      .limit(1);
    if (error) {
      if (NOT_MIGRATED.has(error.code ?? '')) return null;
      throw new Error(`vendor_visit_proposals: ${error.message}`);
    }
    if ((data ?? []).length > 0) return null;
  }

  // The home: the vendor's own words, then our offer, then the vendor's one
  // home. Never a guess beyond that: the card asks.
  const named = matchVisitProperty(msg.body, roster);
  const vendorHomes = (vendor.property_ids ?? []).filter(Boolean);
  const property =
    named ? { id: named.id, basis: 'named' }
    : offer?.propertyId ? { id: offer.propertyId, basis: 'offer' }
    : vendorHomes.length === 1 ? { id: vendorHomes[0], basis: 'vendor_home' }
    : null;

  // Another acknowledgement of the same offer is not another visit. In
  // particular, a completed visit must not reappear after a late "yup".
  // A new offer or an explicit new date still makes a new proposal.
  if (offer && /^(?:yes|yep|yup|sounds good|see you then|confirmed|works for me)[.!\s]*$/i.test(msg.body.trim())) {
    let existing = db.from('vendor_visit_proposals').select('id')
      .eq('trade_vendor_id', vendor.id).eq('offer_at', offer.at)
      .in('status', ['pending', 'approving', 'approved', 'handled'])
      .lte('message_at', msg.at).limit(1);
    existing = property ? existing.eq('property_id', property.id) : existing.is('property_id', null);
    const settled = await existing;
    if (settled.error) {
      if (NOT_MIGRATED.has(settled.error.code ?? '')) return null;
      throw new Error(`vendor_visit_proposals: ${settled.error.message}`);
    }
    if (settled.data?.length) return null;
  }

  // A newer card from this vendor for this home already exists (an old
  // event replayed after it): file this one already superseded, so the
  // newer card stays the one on the queue. Forward-only on the message time.
  const sameHome = property ? `property_id.is.null,property_id.eq.${property.id}` : null;
  let newer = db
    .from('vendor_visit_proposals')
    .select('id')
    .eq('trade_vendor_id', vendor.id)
    .eq('status', 'pending')
    .gt('message_at', msg.at)
    .limit(1);
  if (sameHome) newer = newer.or(sameHome);
  const { data: newerRows, error: newerErr } = await newer;
  if (newerErr) {
    if (NOT_MIGRATED.has(newerErr.code ?? '')) return null;
    throw new Error(`vendor_visit_proposals: ${newerErr.message}`);
  }
  const status: 'pending' | 'superseded' = (newerRows ?? []).length > 0 ? 'superseded' : 'pending';

  const row = {
    trade_vendor_id: vendor.id,
    vendor_name: vendor.name,
    from_phone: msg.from,
    quo_line: msg.line,
    quo_message_id: msg.messageId,
    message_body: msg.body,
    message_at: msg.at,
    property_id: property?.id ?? null,
    property_basis: property?.basis ?? null,
    visit_date: read.kind === 'date' ? read.start : null,
    visit_end_date: read.kind === 'date' ? read.end : null,
    start_time: read.time.start,
    end_time: read.time.end,
    time_label: read.time.label,
    date_basis: read.kind === 'date' ? read.basis : null,
    ask_reason: read.kind === 'ask' ? read.reason : null,
    date_candidates: read.kind === 'ask' ? read.candidates : [],
    offer_text: offer?.body ?? null,
    offer_at: offer?.at ?? null,
    status,
  };
  const { data: inserted, error } = await db
    .from('vendor_visit_proposals')
    .upsert(row, { onConflict: 'quo_message_id', ignoreDuplicates: true })
    .select('id');
  if (error) {
    if (NOT_MIGRATED.has(error.code ?? '')) return null;
    throw new Error(`vendor_visit_proposals insert: ${error.message}`);
  }
  const id = (inserted as Array<{ id: string }> | null)?.[0]?.id;
  if (!id) return null; // a replay: the row was filed the first time

  if (status === 'pending') {
    // This text replaces the vendor's older pending card for the same home.
    let older = db
      .from('vendor_visit_proposals')
      .update({ status: 'superseded', decided_at: new Date().toISOString(), decided_by: 'helm@helm.system' })
      .eq('trade_vendor_id', vendor.id)
      .eq('status', 'pending')
      .lt('message_at', msg.at)
      .neq('id', id);
    if (sameHome) older = older.or(sameHome);
    const { error: supErr } = await older;
    if (supErr) throw new Error(`vendor_visit_proposals supersede: ${supErr.message}`);
  }
  return { id, status };
}
