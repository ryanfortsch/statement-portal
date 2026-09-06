/**
 * The cleaning vendor's own schedule, and whether it agrees with ours.
 *
 * A-1 Maintenance & Cleaning -- the same company Helm knows everywhere
 * else as CAPE ANN ELITE, which is the name it does business under
 * (confirmed by Dotti, 2026-08-24) -- dispatches through Jobber, which
 * texts an appointment reminder to the 24/7 Quo line ~2 days before every
 * visit. The bank feed bills "CAPE ANN ELITE", cleaner_phones lists Rosa
 * and Nina under that vendor, and the Jobber texts are branded "A-1": one
 * outfit, three spellings. Operator surfaces say Cape Ann Elite because
 * that is what the team calls them; VENDOR_ID stays 'a1_maintenance'
 * because it names the Jobber SENDER this parser keys on, and 52 stored
 * rows already carry it.
 * Those texts have been landing in `quo_events` unread for weeks: the
 * sender isn't in `cleaner_phones`, so the Quo ingest files them as
 * unattributable chatter.
 *
 * They are worth reading, because they are the vendor's OWN commitment --
 * the only independent witness to whether both sides of a turnover agree.
 * Our schedule says when the house frees up; theirs says when a cleaner is
 * actually coming. A disagreement is exactly the thing nobody notices until
 * a cleaner walks into an occupied house.
 *
 * Everything here is deterministic: a fixed reminder format, a regex, and
 * street-number-anchored property matching. No AI, because a scheduling
 * cross-check that guesses is worse than none.
 *
 * The horizon rule matters. The vendor only announces ~2 days out, so a
 * checkout further out than the furthest reminder is NOT unscheduled, it's
 * just not announced yet. Only days at or before the announced horizon can
 * be judged; past it, `reconcileDay` returns 'unannounced' and the UI stays
 * quiet.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScheduleRow } from '@/lib/checkout-schedule';
import { selectAllPaged } from '@/lib/paged-select';
import { recordSyncResult } from '@/lib/sync-status';

/** Jobber's relay number for A-1's dispatch. Overridable for a vendor
 *  change without a deploy. */
function vendorPhone(): string {
  return process.env.VENDOR_DISPATCH_PHONE || '+15592351822';
}

/** The last ten digits of the dispatch number: the one form both the
 *  server-side filter and the in-memory check key on, so a "+1" prefix
 *  present on one side and absent on the other can never split them. */
function vendorPhoneSuffix(): string {
  return vendorPhone().replace(/\D/g, '').slice(-10);
}

/** True when a Quo `from` is the Jobber relay. The webhook uses this to
 *  parse a reminder the moment it lands instead of waiting for the
 *  afternoon sweep: Jobber texts at 09:30 ET and the cron runs at 16:00,
 *  so the day-after-tomorrow column sat stale for the hours between. */
export function isVendorReminderSender(from: string | null | undefined): boolean {
  const digits = String(from ?? '').replace(/\D/g, '');
  return digits.length >= 10 && digits.endsWith(vendorPhoneSuffix());
}

// The verdicts, the per-day reconciliation and the two constants live in
// vendor-reconcile.ts (import-free, so npm test covers them). Re-exported
// here so callers keep one import for the whole vendor story.
import { VENDOR_ID } from '@/lib/vendor-reconcile';
export { VENDOR_ID, VENDOR_LABEL, reconcileDay, verdictLabel, summarize } from '@/lib/vendor-reconcile';
export type { VendorVerdict, VendorDayReport, VendorAppointmentRow } from '@/lib/vendor-reconcile';
import type { VendorAppointmentRow } from '@/lib/vendor-reconcile';

/**
 * "Aug 25, 2026 11:30AM at 84 Thatcher Road / Gloucester, Massachusetts"
 * Whitespace is irregular in the real texts (double spaces around the time
 * and before the zip, and the zip itself is often mistyped: 1930, 019300,
 * 1966), so nothing after the street is trusted -- the address is taken up
 * to the first "/" and matched on street number + name only.
 */
const REMINDER_RE =
  /([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s+at\s+([^/\n]+?)\s*\//;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export type VendorAppointment = {
  property_id: string;
  service_date: string;
  service_time: string;
  raw_address: string;
};

/** Address tokens, normalized so the vendor's shorthand lines up with our
 *  property rows: "53R" is the street number 53, and "Down." is the
 *  downstairs sub-unit (A-1 writes "53R Down. Rocky Neck Avenue" for
 *  53_rocky_neck_2 and "53R Rocky Neck Avenue" for the main house --
 *  collapsing those two swaps a whole turnover onto the wrong unit). */
function addressTokens(s: string): string[] {
  const flat = (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(\d+)r\b/g, '$1')
    .replace(/\bdown\b/g, 'downstairs')
    .trim();
  return flat ? flat.split(' ') : [];
}

type PropertyLite = { id: string; name: string | null; address: string | null };

/** Street number must agree; among survivors the most token overlap wins,
 *  ties broken toward the MORE specific property (the sub-unit carries the
 *  extra "downstairs" token). Below two matching tokens we return null
 *  rather than guess -- an unmatched reminder is reported, never silently
 *  bound to the wrong house. */
export function matchPropertyByAddress(address: string, properties: PropertyLite[]): string | null {
  const addrTokens = new Set(addressTokens(address));
  const streetNumber = [...addrTokens].find((t) => /^\d+$/.test(t));
  let best: string | null = null;
  let bestScore = 0;
  let bestSpecificity = 0;
  for (const p of properties) {
    const pTokens = new Set([...addressTokens(p.name ?? ''), ...addressTokens(p.address ?? '')]);
    if (streetNumber && !pTokens.has(streetNumber)) continue;
    let score = 0;
    for (const t of addrTokens) if (pTokens.has(t)) score += 1;
    if (score > bestScore || (score === bestScore && score > 0 && pTokens.size > bestSpecificity)) {
      best = p.id;
      bestScore = score;
      bestSpecificity = pTokens.size;
    }
  }
  return bestScore >= 2 ? best : null;
}

/** Parse one reminder body. Returns null for anything that isn't one. */
export function parseReminder(
  body: string,
  properties: PropertyLite[],
): VendorAppointment | null {
  const m = REMINDER_RE.exec(body || '');
  if (!m) return null;
  const [, mon, day, year, hh, mm, ampm, rawAddress] = m;
  const monthIdx = MONTHS.indexOf(mon.toLowerCase());
  if (monthIdx < 0) return null;
  let hour = Number(hh) % 12;
  if (ampm.toUpperCase() === 'PM') hour += 12;
  const propertyId = matchPropertyByAddress(rawAddress, properties);
  if (!propertyId) return null;
  return {
    property_id: propertyId,
    service_date: `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`,
    service_time: `${String(hour).padStart(2, '0')}:${mm}`,
    raw_address: rawAddress.trim(),
  };
}

export type IngestResult = {
  scanned: number;
  parsed: number;
  upserted: number;
  unmatched: string[];
  errors: string[];
};

/**
 * Read recent vendor reminders out of `quo_events` and upsert them.
 * Latest reminder for a (property, day) wins -- the vendor re-sends when a
 * visit is rescheduled, and the newest text is the current plan.
 *
 * Three callers, one parser: the afternoon cleaner-schedule cron (the
 * sweep), the Quo webhook the moment a reminder lands (see quo-ingest.ts),
 * and the Pull button on /turnovers/cleanings. Every run records itself
 * on sync_status as 'vendor-appointments' -- when, how many texts it read,
 * and any address it could not place -- so the page can say when the
 * schedule was last read instead of leaving the reader to trust it.
 */
export async function ingestVendorAppointments(
  supabase: SupabaseClient,
  opts?: { days?: number },
): Promise<IngestResult> {
  const result = await ingestVendorAppointmentsInner(supabase, opts);
  await recordSyncResult('vendor-appointments', {
    processed: result.scanned,
    failed: result.errors.length,
    firstError: result.errors[0],
    result: {
      scanned: result.scanned,
      parsed: result.parsed,
      upserted: result.upserted,
      unmatched: result.unmatched,
      days: opts?.days ?? 30,
    },
  });
  return result;
}

async function ingestVendorAppointmentsInner(
  supabase: SupabaseClient,
  opts?: { days?: number },
): Promise<IngestResult> {
  const result: IngestResult = { scanned: 0, parsed: 0, upserted: 0, unmatched: [], errors: [] };
  const since = new Date(Date.now() - (opts?.days ?? 30) * 86_400_000).toISOString();

  const { data: propRows, error: propErr } = await supabase
    .from('properties')
    .select('id, name, address')
    .eq('is_active', true);
  if (propErr) {
    result.errors.push(`properties: ${propErr.message}`);
    return result;
  }
  const properties = (propRows ?? []) as PropertyLite[];

  const phone = vendorPhoneSuffix();

  // Filter to the vendor's number ON THE SERVER, and page the read.
  //
  // The first version selected every inbound message of the last 30 days
  // and picked the vendor's out in memory. PostgREST silently caps a bare
  // select at 1000 rows, and with the read ordered oldest-first the rows
  // it dropped were the NEWEST. On 2026-09-05 inbound volume crossed 1000
  // per 30 days (998 through the Sep 4 batch) and the eleven reminders for
  // Sep 7 and 8 never landed, while every sweep reported success. Jobber's
  // ~100 texts a month now come back in one short page whatever the rest
  // of the line is doing, and the paged read is there for the day that
  // stops being true.
  type EventRow = { payload: unknown; received_at: string };
  let events: EventRow[];
  try {
    events = await selectAllPaged<EventRow>(
      (from, to) =>
        supabase
          .from('quo_events')
          .select('payload, received_at')
          .eq('event_type', 'message.received')
          .gte('received_at', since)
          .like('payload->data->object->>from', `%${phone}`)
          .order('received_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'vendor reminders' },
    );
  } catch (err) {
    result.errors.push(`quo_events: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  // Newest wins per (property, day): events are ascending, so a later
  // reminder simply overwrites the earlier entry in this map.
  const byKey = new Map<string, VendorAppointment & { announced_at: string | null; message_id: string | null }>();

  for (const ev of events) {
    const obj = (ev.payload as { data?: { object?: Record<string, unknown> } })?.data?.object;
    if (!obj) continue;
    // The server filter is a suffix match on the raw string; re-check on
    // digits so a formatting quirk can never let a stranger's text in.
    const from = String(obj.from ?? '').replace(/\D/g, '');
    if (!from.endsWith(phone)) continue;
    result.scanned += 1;
    const body = String(obj.body ?? '');
    const appt = parseReminder(body, properties);
    if (!appt) {
      const raw = REMINDER_RE.exec(body)?.[7]?.trim();
      if (raw && !result.unmatched.includes(raw)) result.unmatched.push(raw);
      continue;
    }
    result.parsed += 1;
    byKey.set(`${appt.property_id}|${appt.service_date}`, {
      ...appt,
      announced_at: typeof obj.createdAt === 'string' ? obj.createdAt : ev.received_at,
      message_id: typeof obj.id === 'string' ? obj.id : null,
    });
  }

  if (byKey.size === 0) return result;
  const rows = [...byKey.values()].map((a) => ({
    vendor: VENDOR_ID,
    property_id: a.property_id,
    service_date: a.service_date,
    service_time: a.service_time,
    raw_address: a.raw_address,
    source_message_id: a.message_id,
    announced_at: a.announced_at,
    updated_at: new Date().toISOString(),
  }));
  const { error: upErr, data: up } = await supabase
    .from('vendor_appointments')
    .upsert(rows, { onConflict: 'vendor,property_id,service_date' })
    .select('id');
  if (upErr) result.errors.push(`upsert: ${upErr.message}`);
  else result.upserted = (up ?? []).length;
  return result;
}

// ─── loaders ─────────────────────────────────────────────────────────

export async function loadVendorAppointments(
  supabase: SupabaseClient,
  startDate: string,
  endDate: string,
): Promise<{ rows: VendorAppointmentRow[]; horizon: string | null }> {
  const { data } = await supabase
    .from('vendor_appointments')
    .select('property_id, service_date, service_time')
    .eq('vendor', VENDOR_ID)
    .gte('service_date', startDate)
    .lte('service_date', endDate);
  const rows = (data ?? []) as VendorAppointmentRow[];
  // The horizon is the furthest day the vendor has announced ANYWHERE, not
  // just inside this window, so a narrow window can't fake an early cutoff.
  const { data: maxRow } = await supabase
    .from('vendor_appointments')
    .select('service_date')
    .eq('vendor', VENDOR_ID)
    .order('service_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  return { rows, horizon: (maxRow as { service_date: string } | null)?.service_date ?? null };
}

/**
 * propertyId -> committed cleaning time, for ONE day.
 *
 * Deliberately not `loadVendorAppointments`: that runs a second,
 * unbounded MAX(service_date) probe to establish the announcement
 * horizon, which only the reconciliation needs. Callers that just want
 * "is a cleaner booked at this house that day" (the Field packet pages,
 * which re-render on a 20s AutoRefresh) should not pay for it.
 *
 * Returns an empty map on any failure: a vendor outage must never take
 * down a working inspector's packet.
 */
export async function loadVendorTimesForDay(
  supabase: SupabaseClient,
  date: string,
): Promise<Map<string, string>> {
  try {
    const { data } = await supabase
      .from('vendor_appointments')
      .select('property_id, service_time')
      .eq('vendor', VENDOR_ID)
      .eq('service_date', date);
    return new Map(
      ((data ?? []) as Array<{ property_id: string; service_time: string }>).map((r) => [
        r.property_id,
        r.service_time,
      ]),
    );
  } catch {
    return new Map();
  }
}

export type { ScheduleRow };
