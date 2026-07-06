/**
 * Cleaning sessions engine — turns Seam lock events + the Quo cleaner text
 * into a start/finish pair per turnover (cleaning_sessions table).
 *
 *   entered_at  — high-confidence "cleaner arrived": a Seam lock.unlocked whose
 *                 access_code_id matches the lock's cleaner code (2222). Fires
 *                 on the physical act of entry, no cleaner action required.
 *   finished_at — "cleaned": authoritative from the Quo text (mirrorQuoFinish)
 *                 or an operator confirm (confirmCleaningDone). A lock.locked
 *                 after entry only seeds an ESTIMATE (finish_estimated=true).
 *
 * Keyed (property_id, checkout_date), the same join the turnover row already
 * uses for cleaning_completions. Server-only (service-role writes).
 *
 * Wired from: /api/webhooks/seam (lock.unlocked / lock.locked),
 * /api/sync-seam (resolveCleanerCodeId per lock + events backfill),
 * src/lib/quo-ingest.ts (mirrorQuoFinish), and a confirm server action.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listUnmanagedAccessCodes } from '@/lib/seam';

/** The static cleaner keypad code. Same on every lock today; override per
 *  environment if a property ever uses a different one. */
export const CLEANER_CODE = process.env.SEAM_CLEANER_CODE || '2222';

export type CleaningSession = {
  enteredAt: string | null;
  finishedAt: string | null;
  entrySource: string | null;
  finishSource: string | null;
  finishEstimated: boolean;
};

export type CleaningSessionRow = {
  property_id: string;
  checkout_date: string;
  entered_at: string | null;
  finished_at: string | null;
  entry_source: string | null;
  finish_source: string | null;
  finish_estimated: boolean;
};

export type LockEventInput = {
  deviceId: string;
  occurredAt: string;
  method?: string | null;
  accessCodeId?: string | null;
};

type Outcome = { ok: boolean; reason?: string; propertyId?: string; checkoutDate?: string };

/** The checkout being turned over for an event/text at `asOfIso`: the most
 *  recent confirmed checkout on/before that date. Matches how operations.ts
 *  derives previousCheckout (bookings.check_out), so the join lines up. */
export async function mostRecentCheckoutForProperty(
  sb: SupabaseClient,
  propertyId: string,
  asOfIso: string,
): Promise<string | null> {
  // bookings.check_out: the SAME source operations.ts now derives
  // previousCheckout from (post Guesty wind-down), with the same
  // confirmed/completed + non-duplicate filters, so the cleaning_sessions row
  // keys to the exact checkout the turnover joins on. (Was guesty_reservations,
  // which is wound down: a checkout that only exists in bookings returned null
  // here, dropping the cleaner signal entirely and leaving a false "awaiting
  // cleaner".)
  const cutoff = asOfIso.slice(0, 10);
  const { data } = await sb
    .from('bookings')
    .select('check_out')
    .eq('property_id', propertyId)
    .in('status', ['confirmed', 'completed'])
    .is('duplicate_of', null)
    .lte('check_out', cutoff)
    .order('check_out', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.check_out as string | undefined) ?? null;
}

export async function lockProperty(
  sb: SupabaseClient,
  deviceId: string,
): Promise<{ propertyId: string; cleanerCodeId: string | null; inspectorCodeId: string | null } | null> {
  const { data } = await sb
    .from('lock_devices')
    .select('property_id, active, cleaner_access_code_id, inspector_access_code_id')
    .eq('device_id', deviceId)
    .maybeSingle();
  const propertyId = (data?.property_id as string | null) ?? null;
  const active = (data?.active as boolean | undefined) ?? true;
  if (!propertyId || !active) return null;
  return {
    propertyId,
    cleanerCodeId: (data?.cleaner_access_code_id as string | null) ?? null,
    inspectorCodeId: (data?.inspector_access_code_id as string | null) ?? null,
  };
}

/** A non-keypad unlock (physical key, mobile key, card, auto) is not a code
 *  entry and can't be attributed to the cleaner. */
export function isKeypadEntry(method?: string | null): boolean {
  const m = (method ?? '').toLowerCase();
  return !/manual|mobile|card|thumbturn|auto|tap|fob/.test(m);
}

/** Is this access code a LIVE field packet entry code on this device? Field
 *  contractor codes are Seam managed codes tracked in packet_access_codes for
 *  the claim→submit window (removed_at null while live). They route to the
 *  inspection lifecycle, never cleaning. */
export async function isLiveFieldCode(
  sb: SupabaseClient,
  deviceId: string,
  accessCodeId: string,
): Promise<boolean> {
  const { data } = await sb
    .from('packet_access_codes')
    .select('id')
    .eq('device_id', deviceId)
    .eq('seam_access_code_id', accessCodeId)
    .is('removed_at', null)
    .limit(1)
    .maybeSingle();
  return data != null;
}

/**
 * lock.unlocked → record the cleaner's arrival. Cleaner match: the unlock's
 * access_code_id equals the lock's resolved cleaner code. Fallback (Schlage
 * sometimes omits access_code_id, or the code isn't resolved yet): any keypad
 * unlock counts as a cleaner candidate, since 2222 is the cleaner-only code.
 * A keypad unlock with a DIFFERENT known code (a guest PIN) is rejected.
 */
export async function recordCleanerEntry(sb: SupabaseClient, ev: LockEventInput): Promise<Outcome> {
  const lock = await lockProperty(sb, ev.deviceId);
  if (!lock) return { ok: false, reason: 'unmapped or inactive lock' };

  if (!isKeypadEntry(ev.method)) return { ok: false, reason: `non-keypad method (${ev.method})` };
  // The master / inspection code routes to the inspection lifecycle, not
  // cleaning. Reject it here even when the cleaner code is unresolved, so an
  // inspector entry never gets logged as a cleaner arrival.
  if (lock.inspectorCodeId && ev.accessCodeId && ev.accessCodeId === lock.inspectorCodeId) {
    return { ok: false, reason: 'inspector code, not cleaner' };
  }
  if (lock.cleanerCodeId && ev.accessCodeId && ev.accessCodeId !== lock.cleanerCodeId) {
    return { ok: false, reason: 'keypad code is not the cleaner code (guest/other)' };
  }
  // With the cleaner code unresolved, the any-keypad fallback below would
  // swallow a FIELD contractor's packet-code entry as a cleaner arrival. Check
  // only in that gap (a resolved lock already rejected any mismatch above).
  if (!lock.cleanerCodeId && ev.accessCodeId && (await isLiveFieldCode(sb, ev.deviceId, ev.accessCodeId))) {
    return { ok: false, reason: 'field inspector code, not cleaner' };
  }

  const checkoutDate = await mostRecentCheckoutForProperty(sb, lock.propertyId, ev.occurredAt);
  if (!checkoutDate) return { ok: false, reason: 'no recent checkout to attribute' };

  // Keep the EARLIEST entry as the start (cleaner may punch in more than once).
  const { data: existing } = await sb
    .from('cleaning_sessions')
    .select('entered_at')
    .eq('property_id', lock.propertyId)
    .eq('checkout_date', checkoutDate)
    .maybeSingle();
  const prior = (existing?.entered_at as string | undefined) ?? null;
  const enteredAt = prior && prior <= ev.occurredAt ? prior : ev.occurredAt;

  const { error } = await sb.from('cleaning_sessions').upsert(
    {
      property_id: lock.propertyId,
      checkout_date: checkoutDate,
      entered_at: enteredAt,
      entry_source: 'seam_lock',
      entry_device_id: ev.deviceId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'property_id,checkout_date' },
  );
  if (error) return { ok: false, reason: error.message };
  return { ok: true, propertyId: lock.propertyId, checkoutDate };
}

/**
 * lock.locked → seed an ESTIMATED finish, but only when a cleaner has entered
 * and there's no finish yet. Never authoritative: Schlage auto-locks on a
 * timer (often while the cleaner's still inside) and guests/owners lock too.
 */
export async function recordLockFinishEstimate(sb: SupabaseClient, ev: LockEventInput): Promise<Outcome> {
  const lock = await lockProperty(sb, ev.deviceId);
  if (!lock) return { ok: false, reason: 'unmapped or inactive lock' };

  const checkoutDate = await mostRecentCheckoutForProperty(sb, lock.propertyId, ev.occurredAt);
  if (!checkoutDate) return { ok: false, reason: 'no recent checkout' };

  const { data: existing } = await sb
    .from('cleaning_sessions')
    .select('entered_at, finished_at')
    .eq('property_id', lock.propertyId)
    .eq('checkout_date', checkoutDate)
    .maybeSingle();
  if (!existing?.entered_at) return { ok: false, reason: 'no cleaner entry yet' };
  if (existing.finished_at) return { ok: false, reason: 'already finished' };

  const { error } = await sb
    .from('cleaning_sessions')
    .update({
      finished_at: ev.occurredAt,
      finish_source: 'estimate',
      finish_estimated: true,
      updated_at: new Date().toISOString(),
    })
    .eq('property_id', lock.propertyId)
    .eq('checkout_date', checkoutDate);
  if (error) return { ok: false, reason: error.message };
  return { ok: true, propertyId: lock.propertyId, checkoutDate };
}

/** Mirror the authoritative Quo "done" text into cleaning_sessions, upgrading
 *  any prior estimate to confirmed. Called from quo-ingest alongside its
 *  existing cleaning_completions insert. */
export async function mirrorQuoFinish(
  sb: SupabaseClient,
  args: { propertyId: string; completedAt: string },
): Promise<void> {
  // Re-derive checkout_date (off bookings) so the Quo finish lands on the same
  // cleaning_sessions row as the lock entry and the turnover join.
  const checkoutDate = await mostRecentCheckoutForProperty(sb, args.propertyId, args.completedAt);
  if (!checkoutDate) return;
  await sb.from('cleaning_sessions').upsert(
    {
      property_id: args.propertyId,
      checkout_date: checkoutDate,
      finished_at: args.completedAt,
      finish_source: 'quo',
      finish_estimated: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'property_id,checkout_date' },
  );
}

/** Operator taps "confirm done" on an estimated clean. */
export async function confirmCleaningDone(
  sb: SupabaseClient,
  propertyId: string,
  checkoutDate: string,
  byEmail: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await sb.from('cleaning_sessions').upsert(
    {
      property_id: propertyId,
      checkout_date: checkoutDate,
      finished_at: new Date().toISOString(),
      finish_source: 'manual',
      finish_estimated: false,
      confirmed_by_email: byEmail,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'property_id,checkout_date' },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Resolve + store the cleaner code's access_code_id for a lock (from the
 *  unmanaged-code list). Run per device on the daily Seam sync; the id can
 *  drift, so re-resolving keeps the cleaner match working. */
export async function resolveCleanerCodeId(sb: SupabaseClient, deviceId: string): Promise<string | null> {
  try {
    const codes = await listUnmanagedAccessCodes(deviceId);
    const match = codes.find((c) => (c.code ?? '').trim() === CLEANER_CODE);
    const id = match?.access_code_id ?? null;
    if (id) {
      await sb
        .from('lock_devices')
        .update({ cleaner_access_code_id: id, updated_at: new Date().toISOString() })
        .eq('device_id', deviceId);
    }
    return id;
  } catch {
    return null;
  }
}
