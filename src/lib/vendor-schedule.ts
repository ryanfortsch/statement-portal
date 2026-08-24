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
import type { ScheduleDay, ScheduleRow } from '@/lib/checkout-schedule';

/** Jobber's relay number for A-1's dispatch. Overridable for a vendor
 *  change without a deploy. */
function vendorPhone(): string {
  return process.env.VENDOR_DISPATCH_PHONE || '+15592351822';
}

/** Stored key: names the Jobber sender the parser keys on, not the brand. */
export const VENDOR_ID = 'a1_maintenance';
/** What the operator sees. Cape Ann Elite is the DBA the whole rest of Helm
 *  uses (bank charges, cleaner_phones.vendor), so the chip matches it. */
export const VENDOR_LABEL = 'Cape Ann Elite';

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
 */
export async function ingestVendorAppointments(
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

  const { data: events, error } = await supabase
    .from('quo_events')
    .select('payload, received_at')
    .eq('event_type', 'message.received')
    .gte('received_at', since)
    .order('received_at', { ascending: true });
  if (error) {
    result.errors.push(`quo_events: ${error.message}`);
    return result;
  }

  const phone = vendorPhone().replace(/\D/g, '').slice(-10);
  // Newest wins per (property, day): events are ascending, so a later
  // reminder simply overwrites the earlier entry in this map.
  const byKey = new Map<string, VendorAppointment & { announced_at: string | null; message_id: string | null }>();

  for (const ev of (events ?? []) as Array<{ payload: unknown; received_at: string }>) {
    const obj = (ev.payload as { data?: { object?: Record<string, unknown> } })?.data?.object;
    if (!obj) continue;
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

// ─── reconciliation ───────────────────────────────────────────────────

export type VendorVerdict =
  /** Vendor is coming, and after checkout. Both sides agree. */
  | { kind: 'agree'; time: string }
  /** Vendor is coming BEFORE the house frees up. */
  | { kind: 'early'; time: string; checkoutTime: string }
  /** We have a checkout, the vendor has nothing booked that day. */
  | { kind: 'no_appointment' }
  /** Vendor is coming, but nobody checks out (extension, cancellation). */
  | { kind: 'no_checkout'; time: string; propertyId: string; propertyName: string }
  /** Beyond the vendor's announcement horizon: unknowable, not a problem. */
  | { kind: 'unannounced' };

export type VendorDayReport = {
  /** Verdict per schedule row, keyed `${propertyId}|${checkIn}`. */
  byRow: Map<string, VendorVerdict>;
  /** Vendor visits with no matching checkout that day. */
  orphans: Array<{ propertyId: string; propertyName: string; time: string }>;
  /** True when this day is at or before the vendor's announced horizon. */
  announced: boolean;
};

export type VendorAppointmentRow = {
  property_id: string;
  service_date: string;
  service_time: string;
};

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

/** Compare one schedule day against the vendor's bookings for that day. */
export function reconcileDay(
  day: ScheduleDay,
  appointments: VendorAppointmentRow[],
  horizon: string | null,
  propertyNames: Map<string, string>,
): VendorDayReport {
  const announced = !!horizon && day.date <= horizon;
  const byRow = new Map<string, VendorVerdict>();
  const forDay = appointments.filter((a) => a.service_date === day.date);
  const used = new Set<string>();

  for (const row of day.rows) {
    const key = `${row.propertyId}|${row.checkIn}`;
    if (!announced) {
      byRow.set(key, { kind: 'unannounced' });
      continue;
    }
    const appt = forDay.find((a) => a.property_id === row.propertyId);
    if (!appt) {
      byRow.set(key, { kind: 'no_appointment' });
      continue;
    }
    used.add(appt.property_id);
    byRow.set(
      key,
      appt.service_time < row.time
        ? { kind: 'early', time: appt.service_time, checkoutTime: row.time }
        : { kind: 'agree', time: appt.service_time },
    );
  }

  const scheduled = new Set(day.rows.map((r) => r.propertyId));
  const orphans = announced
    ? forDay
        .filter((a) => !scheduled.has(a.property_id) && !used.has(a.property_id))
        .map((a) => ({
          propertyId: a.property_id,
          propertyName: propertyNames.get(a.property_id) ?? a.property_id,
          time: a.service_time,
        }))
    : [];

  return { byRow, orphans, announced };
}

/** One-line summary for a row's verdict, or null when there is nothing
 *  worth saying (unannounced days stay silent). */
export function verdictLabel(v: VendorVerdict | undefined): { text: string; tone: 'ok' | 'warn' | 'bad' } | null {
  if (!v) return null;
  switch (v.kind) {
    case 'agree':
      return { text: `${VENDOR_LABEL} ${v.time}`, tone: 'ok' };
    case 'early':
      return { text: `${VENDOR_LABEL} ${v.time} · before ${v.checkoutTime} checkout`, tone: 'warn' };
    case 'no_appointment':
      return { text: `${VENDOR_LABEL} has nothing booked`, tone: 'bad' };
    case 'no_checkout':
      return { text: `${VENDOR_LABEL} ${v.time} · nobody checks out`, tone: 'bad' };
    case 'unannounced':
      return null;
  }
}

/** Row-level verdicts for a whole schedule window, plus the day reports. */
export function summarize(reports: VendorDayReport[]): {
  agree: number;
  early: number;
  missing: number;
  orphans: number;
} {
  let agree = 0;
  let early = 0;
  let missing = 0;
  let orphans = 0;
  for (const r of reports) {
    for (const v of r.byRow.values()) {
      if (v.kind === 'agree') agree += 1;
      else if (v.kind === 'early') early += 1;
      else if (v.kind === 'no_appointment') missing += 1;
    }
    orphans += r.orphans.length;
  }
  return { agree, early, missing, orphans };
}

export type { ScheduleRow };
