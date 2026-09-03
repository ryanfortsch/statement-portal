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
  /** Active guesty_hold adjustments whose hold no longer exists in a fresh
   *  mirror, dismissed so a refunded/removed extension does not persist. */
  retracted: number;
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

/** Words that appear in hold notes for reasons that have nothing to do
 *  with who the guest is. "Will Harmon" must not match "Owner will be up
 *  for the weekend". */
const NAME_STOPWORDS = new Set([
  'will', 'with', 'from', 'here', 'that', 'this', 'then', 'they', 'them', 'have', 'been',
  'owner', 'guest', 'hold', 'block', 'week', 'weekend', 'stay', 'night', 'nights', 'extra',
  'extension', 'paid', 'helm', 'family', 'friends', 'house', 'home', 'clean', 'cleaning',
]);

/** Significant lowercase name tokens: at least four characters, not a
 *  stopword, and matched as WHOLE words. "Stacey Grillo" matches a note
 *  reading "Extension hold - Stacey Grillo (paid, Helm)"; a three-letter
 *  fragment or a name that is also an English word does not. Placeholder
 *  guest names (ical "Reservation HM...") yield no usable tokens. */
function nameTokens(name: string | null): string[] {
  return (name ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !NAME_STOPWORDS.has(t) && !/^(reservation|reserved|blocked|airbnb|vrbo|hm[a-z0-9]+)$/.test(t));
}

function noteNames(note: string, tokens: string[]): boolean {
  return tokens.some((t) => new RegExp(`\\b${t}\\b`, 'i').test(note));
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
    retracted: 0,
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
  // Links carry the guest's name. A link for a DIFFERENT guest at the same
  // property is not evidence for this stay (the 45-day lookback spans
  // several stays per house). A link with no name at all still counts at
  // property level, since that is all it can say.
  const extensionLinks = ((linksRes.data ?? []) as Array<{ property_id: string; label: string | null; guest_name: string | null }>)
    .filter((r) => EXTENSION_LABEL.test(r.label ?? ''));
  const linkBacksStay = (propertyId: string, guestName: string | null): boolean => {
    const stayTokens = nameTokens(guestName);
    return extensionLinks.some((l) => {
      if (l.property_id !== propertyId) return false;
      const linkTokens = nameTokens(l.guest_name);
      if (linkTokens.length === 0 || stayTokens.length === 0) return true;
      return linkTokens.some((t) => stayTokens.includes(t));
    });
  };
  const slipProps = new Set(
    ((slipsRes.data ?? []) as Array<{ property_id: string; from_guest_request_key: string | null }>)
      .filter((r) => /extension|extra_night/i.test(r.from_guest_request_key ?? ''))
      .map((r) => r.property_id),
  );

  // RETRACT first. An active guesty_hold adjustment whose hold is no longer
  // in the (successfully read) mirror describes an extension that was
  // refunded or removed. Left alone it keeps the stay on the wrong day
  // indefinitely. Only holds inside the scanned window can be judged, so
  // only adjustments whose original checkout falls in it are eligible.
  if (!holdsRes.error) {
    const { data: liveHolds, error: liveErr } = await supabase
      .from('checkout_adjustments')
      .select('id, property_id, original_check_out, miner_key')
      .eq('status', 'active')
      .eq('source', 'guesty_hold')
      .gte('original_check_out', today)
      .lte('original_check_out', horizonEnd);
    if (liveErr) {
      result.errors.push(`retract read: ${liveErr.message}`);
    } else {
      for (const a of (liveHolds ?? []) as Array<{ id: string; property_id: string; original_check_out: string; miner_key: string | null }>) {
        const stillHeld = holdByKey.get(`${a.property_id}|${a.original_check_out}`);
        const keyEnd = a.miner_key?.split(':')[3] ?? null;
        if (stillHeld && (!keyEnd || stillHeld.block_end === keyEnd)) continue;
        const { data: gone } = await supabase
          .from('checkout_adjustments')
          .update({
            status: 'dismissed',
            note: 'Hold removed from the Guesty calendar; extension retracted',
            updated_at: new Date().toISOString(),
          })
          .eq('id', a.id)
          .eq('status', 'active')
          .select('id')
          .maybeSingle();
        if (gone) result.retracted += 1;
      }
    }
  }

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
    const namesGuest = tokens.length > 0 && noteNames(note, tokens);
    const saysExtension = /extens/i.test(note);
    const backedByMoney = linkBacksStay(stay.property_id, stay.guest_name) || slipProps.has(stay.property_id);

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
