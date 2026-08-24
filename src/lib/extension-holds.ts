/**
 * Deterministic extension detection from the Guesty calendar mirror.
 *
 * Rising Tide's extension process (the payment-link rail) never changes
 * the OTA reservation: the guest pays through a Stripe link and the
 * calendar is "squared away manually on our end". So `bookings.check_out`
 * keeps the ORIGINAL date indefinitely, and every downstream consumer --
 * including this schedule and Guesty's own checkout-reminder automation
 * -- believes the guest leaves on the wrong day.
 *
 * Proving case (2026-08-24): Stacey Grillo at 84 Thatcher paid $708.18 on
 * 8/23 for two extra nights through Thursday the 27th. Her Airbnb
 * reservation row was last touched 2026-07-08 and still said 8/25, so the
 * schedule would have sent Rosa to a house with a guest still in it on
 * the 25th and skipped the real turnover on the 27th -- which is itself a
 * same-day turn, with the next guest arriving that afternoon.
 *
 * The thread miner can read the agreement out of prose, but Helm already
 * holds it as hard data. This reads that instead:
 *
 *   the signal: a real hold (block_type not null) in
 *   property_calendar_days starting EXACTLY on a stay's checkout date.
 *   Guesty's block_end is inclusive of the last held night, so the
 *   guest's true checkout is block_end + 1 day.
 *
 * Corroboration is mandatory, because an abutting hold usually is NOT an
 * extension: of eight fleet-wide on 2026-08-24, seven were owner use.
 *
 *   high (auto-applies)  the hold names the guest, or says "extension"
 *   medium (proposed)    an extension payment link or a concierge
 *                        "sync extension in Guesty" slip backs it up
 *   ignored              anything else (owner use, maintenance holds)
 *
 * Runs in /api/cron/cleaner-schedule ahead of the digest draft, and on
 * the card's re-scan. Idempotent via miner_key `ghold:<pid>:<check_in>:
 * <block_end>`: re-running is a no-op, and a guest who extends AGAIN
 * mints a new key and supersedes the previous adjustment.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { insertAdjustment, todayET, addDays } from '@/lib/checkout-schedule';

const HOLD_BOT = 'guesty-hold';
const DEFAULT_HORIZON_DAYS = 30;
/** Extension-ish payment links / slips this recent count as corroboration. */
const CORROBORATION_LOOKBACK_DAYS = 45;

export type ExtensionHoldsResult = {
  staysScanned: number;
  holdsFound: number;
  applied: number;
  proposed: number;
  ignoredNoCorroboration: number;
  alreadyRecorded: number;
  errors: string[];
};

type StayLite = {
  property_id: string;
  check_in: string;
  check_out: string;
  guest_name: string | null;
};

type HoldLite = {
  property_id: string;
  block_start: string;
  block_end: string;
  block_type: string;
  block_note: string | null;
};

/** Significant lowercase name tokens (>= 3 chars), so "Stacey Grillo"
 *  matches a note reading "Extension hold - Stacey Grillo (paid, Helm)"
 *  without a one-letter initial causing a spurious hit. */
function nameTokens(name: string | null): string[] {
  return (name ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

export async function detectExtensionHolds(
  supabase: SupabaseClient,
  opts?: { horizonDays?: number },
): Promise<ExtensionHoldsResult> {
  const result: ExtensionHoldsResult = {
    staysScanned: 0,
    holdsFound: 0,
    applied: 0,
    proposed: 0,
    ignoredNoCorroboration: 0,
    alreadyRecorded: 0,
    errors: [],
  };

  const today = todayET();
  const horizonEnd = addDays(today, opts?.horizonDays ?? DEFAULT_HORIZON_DAYS);

  const [staysRes, holdsRes] = await Promise.all([
    supabase
      .from('bookings')
      .select('property_id, check_in, check_out, guest_name')
      .gte('check_out', today)
      .lte('check_out', horizonEnd)
      .in('status', ['confirmed', 'completed'])
      .is('duplicate_of', null),
    supabase
      .from('property_calendar_days')
      .select('property_id, block_start, block_end, block_type, block_note')
      .not('block_type', 'is', null)
      .gte('block_start', today)
      .lte('block_start', horizonEnd),
  ]);

  const stays = (staysRes.data ?? []) as StayLite[];
  result.staysScanned = stays.length;

  // One row per calendar DAY carries the same block_start/_end; collapse
  // to one hold per (property, block_start).
  const holdByKey = new Map<string, HoldLite>();
  for (const h of (holdsRes.data ?? []) as HoldLite[]) {
    if (!h.block_start || !h.block_end) continue;
    holdByKey.set(`${h.property_id}|${h.block_start}`, h);
  }

  // Corroborating evidence, loaded once and matched per property.
  const since = new Date(Date.now() - CORROBORATION_LOOKBACK_DAYS * 86400_000).toISOString();
  const [linksRes, slipsRes] = await Promise.all([
    supabase
      .from('payment_link_requests')
      .select('property_id, label, guest_name, created_at')
      .gte('created_at', since),
    supabase
      .from('work_slips')
      .select('property_id, from_guest_request_key, created_at')
      .like('from_guest_request_key', 'stayfix:%')
      .gte('created_at', since),
  ]);
  const EXTENSION_LABEL = /extens|extra night/i;
  const linkProps = new Set(
    ((linksRes.data ?? []) as Array<{ property_id: string; label: string | null }>)
      .filter((r) => EXTENSION_LABEL.test(r.label ?? ''))
      .map((r) => r.property_id),
  );
  const slipProps = new Set(
    ((slipsRes.data ?? []) as Array<{ property_id: string; from_guest_request_key: string | null }>)
      .filter((r) => /extension|extra_night/i.test(r.from_guest_request_key ?? ''))
      .map((r) => r.property_id),
  );

  // Collapse duplicate booking rows per stay so one extension can't be
  // filed twice under the same key (the insert is idempotent anyway, but
  // this keeps the counters honest).
  const seenStays = new Set<string>();

  for (const stay of stays) {
    const stayKey = `${stay.property_id}|${stay.check_in}`;
    if (seenStays.has(stayKey)) continue;
    const hold = holdByKey.get(`${stay.property_id}|${stay.check_out}`);
    if (!hold) continue;
    seenStays.add(stayKey);
    result.holdsFound += 1;

    const note = (hold.block_note ?? '').toLowerCase();
    const tokens = nameTokens(stay.guest_name);
    const namesGuest = tokens.length > 0 && tokens.some((t) => note.includes(t));
    const saysExtension = /extens/i.test(note);
    const backedByMoney = linkProps.has(stay.property_id) || slipProps.has(stay.property_id);

    let confidence: 'high' | 'medium' | null = null;
    if (namesGuest || saysExtension) confidence = 'high';
    else if (backedByMoney) confidence = 'medium';
    if (!confidence) {
      // Owner use, maintenance, a hold that merely abuts. Never guessed at.
      result.ignoredNoCorroboration += 1;
      continue;
    }

    // block_end is the last HELD night, so the guest leaves the next day.
    const newCheckOut = addDays(hold.block_end, 1);
    if (newCheckOut <= stay.check_out) continue;

    const evidenceBits = [
      hold.block_note ? `Guesty hold: "${hold.block_note}"` : `Guesty ${hold.block_type} hold`,
      `${hold.block_start} through ${hold.block_end}`,
    ];
    if (backedByMoney) evidenceBits.push('extension payment on file');

    try {
      const inserted = await insertAdjustment(supabase, {
        propertyId: stay.property_id,
        stayCheckIn: stay.check_in,
        originalCheckOut: stay.check_out,
        adjustedCheckOut: newCheckOut,
        adjustedCheckoutTime: null,
        note: `Stay extended to ${newCheckOut} (held in Guesty, reservation not updated)`,
        source: 'guesty_hold',
        minerKey: `ghold:${stay.property_id}:${stay.check_in}:${hold.block_end}`,
        evidence: evidenceBits.join(' · ').slice(0, 500),
        confidence,
        createdBy: HOLD_BOT,
      });
      if (!inserted) result.alreadyRecorded += 1;
      else if (inserted.status === 'active') result.applied += 1;
      else result.proposed += 1;
    } catch (err) {
      result.errors.push(
        `${stay.property_id} ${stay.check_in}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return result;
}
