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
import { listUnmanagedAccessCodes, seamConfigured, getDevice } from '@/lib/seam';

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

// ── Auto-confirm quiet estimates ─────────────────────────────────────
//
// A lock.locked estimate is never authoritative on its own (Schlage's
// auto-lock can fire while the cleaner is still inside). The operator doesn't
// want to be the human backstop for every one of these, so this sweep
// graduates an estimate to authoritative once every lock mapped to the
// property has stayed quiet for long enough after the relock -- no operator
// action required. Wired from /api/cron/confirm-cleanings.

/** How long, after the relock, with zero further lock activity on ANY of the
 *  property's active locks, before an estimate is trusted on its own.
 *  Env-overridable so the operator can retune without a code change. */
export function autoConfirmThresholdMinutes(): number {
  const raw = Number(process.env.CLEANING_AUTO_CONFIRM_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? raw : 45;
}

// How far past the original estimate we'll look for a later relock (the
// "stepped out to the truck, came back, finished later" pattern) before
// treating the property's lock history as belonging to a DIFFERENT, later
// checkout entirely. Without this cap, an old backlog row would pick up
// whatever some future guest/cleaner/inspector did on that same lock days
// later and wrongly treat it as part of THIS cleaning session.
const REENTRY_WINDOW_HOURS = 12;

/** Every ACTIVE lock mapped to a property. A cleaner (or the next guest) can
 *  use any of a property's doors, so activity checks must span every mapped
 *  lock, not just the one device that fired the original estimate. */
export async function activeLockDeviceIds(sb: SupabaseClient, propertyId: string): Promise<string[]> {
  const { data } = await sb
    .from('lock_devices')
    .select('device_id')
    .eq('property_id', propertyId)
    .eq('active', true);
  return ((data ?? []) as Array<{ device_id: string }>).map((r) => r.device_id);
}

/** The single most recent lock.locked/lock.unlocked event across a set of
 *  devices, strictly after `afterIso` and at or before `throughIso`. Uses
 *  received_at (webhook delivery lands 1-2s after the physical event per the
 *  2026-07-06 fleet audit -- negligible next to a 45-minute threshold, and
 *  keeps this a plain indexed query instead of parsing the jsonb payload).
 *  Only signature-valid deliveries count. */
async function mostRecentLockActivity(
  sb: SupabaseClient,
  deviceIds: string[],
  afterIso: string,
  throughIso: string,
): Promise<{ eventType: string; occurredAt: string } | null> {
  if (deviceIds.length === 0) return null;
  const { data } = await sb
    .from('lock_events')
    .select('event_type, received_at')
    .in('device_id', deviceIds)
    .in('event_type', ['lock.locked', 'lock.unlocked'])
    .eq('signature_valid', true)
    .gt('received_at', afterIso)
    .lte('received_at', throughIso)
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as { event_type: string; received_at: string };
  return { eventType: row.event_type, occurredAt: row.received_at };
}

/**
 * Live corroboration, asked right before the irreversible auto-confirm write:
 * is every one of the property's locks CURRENTLY reporting locked, according
 * to Seam itself (not just Helm's own webhook history)?
 *
 * This closes a real gap in the quiet-time check above: "no lock_events row
 * seen since the relock" only proves Helm hasn't been TOLD of anything yet,
 * not that nothing happened. Seam delivers webhooks via Svix, which retries a
 * failed delivery with backoff (immediately, then 5s/5min/30min/2h/5h/10h) --
 * a transient hiccup on Helm's endpoint (a redeploy, a cold start) could delay
 * a genuine re-entry event well past the 45-minute default threshold, with
 * the cron none the wiser. Querying Seam directly sidesteps that specific
 * failure mode: it's Seam's own record of the device, independent of whether
 * ITS webhook delivery to Helm specifically is currently behind.
 *
 * Fails CLOSED on anything short of a confirmed `true`: unlocked, offline
 * (Seam omits the field entirely), or an API error all block graduation this
 * cycle rather than risk a false "Cleaned". The row simply gets re-evaluated
 * on the next cron pass.
 */
async function allLocksConfirmedLocked(deviceIds: string[]): Promise<boolean> {
  if (!seamConfigured()) return false;
  for (const deviceId of deviceIds) {
    try {
      const device = await getDevice(deviceId);
      if (device?.properties?.locked !== true) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Try to graduate one pending estimate for (propertyId, checkoutDate). Re-reads
 * the row fresh (the caller's scan may be stale by the time this runs) and
 * only ever acts while it's still a live, unconfirmed estimate.
 *
 * Re-baselines to the LATEST lock.locked within a bounded re-entry window
 * rather than trusting cleaning_sessions.finished_at as-is: recordLockFinishEstimate
 * freezes that column at the FIRST relock and ignores later ones (a known,
 * separate bug -- see its "already finished" guard), so reading raw lock_events
 * here is what makes a "cleaner stepped out, came back, finished later" turn
 * resolve correctly instead of graduating on a stale, premature timestamp.
 * (The re-baselined timestamp is sourced from lock_events.received_at, a
 * slightly different clock than finished_at's Seam-reported occurred_at --
 * normally ~1-2s apart per the 2026-07-06 fleet audit, immaterial next to a
 * 45-minute threshold.)
 *
 * If the most recent activity within the window is an UNLOCK, this skips
 * outright rather than guessing -- that's either the cleaner back inside, or
 * (on a same-day turn) the next guest arriving, and neither should be silently
 * folded into "cleaned." It falls back to the existing Quo-text / manual-tap
 * paths, same as today.
 *
 * The webhook history clearing doesn't end the check: right before writing,
 * this also asks Seam LIVE whether every one of the property's locks is
 * currently locked (allLocksConfirmedLocked) -- see that function's doc for
 * why the historical check alone isn't sufficient.
 */
export async function tryAutoGraduateEstimate(
  sb: SupabaseClient,
  propertyId: string,
  checkoutDate: string,
  thresholdMinutes: number,
): Promise<{ ok: boolean; graduated: boolean; reason?: string }> {
  const { data } = await sb
    .from('cleaning_sessions')
    .select('entered_at, finished_at, finish_source, finish_estimated')
    .eq('property_id', propertyId)
    .eq('checkout_date', checkoutDate)
    .maybeSingle();
  const row = data as
    | { entered_at: string | null; finished_at: string | null; finish_source: string | null; finish_estimated: boolean }
    | null;
  if (!row || row.finish_source !== 'estimate' || !row.finish_estimated || !row.entered_at || !row.finished_at) {
    return { ok: true, graduated: false, reason: 'not a live pending estimate' };
  }

  const deviceIds = await activeLockDeviceIds(sb, propertyId);
  if (deviceIds.length === 0) {
    return { ok: true, graduated: false, reason: 'no active locks mapped' };
  }

  const nowMs = Date.now();
  const referenceMs = Date.parse(row.finished_at);
  const capMs = Math.min(nowMs, referenceMs + REENTRY_WINDOW_HOURS * 3_600_000);
  const mostRecent = await mostRecentLockActivity(sb, deviceIds, row.finished_at, new Date(capMs).toISOString());

  let quietSinceIso = row.finished_at;
  if (mostRecent) {
    if (mostRecent.eventType !== 'lock.locked') {
      return { ok: true, graduated: false, reason: 're-entered since the relock, not graduating this cycle' };
    }
    quietSinceIso = mostRecent.occurredAt;
  }

  const quietMinutes = (nowMs - Date.parse(quietSinceIso)) / 60_000;
  if (quietMinutes < thresholdMinutes) {
    return { ok: true, graduated: false, reason: `quiet ${Math.round(quietMinutes)}m of ${thresholdMinutes}m needed` };
  }

  // Final gate: live-confirm every lock on the property is ACTUALLY locked
  // right now, per Seam, not just per Helm's own webhook history (see
  // allLocksConfirmedLocked's doc for why the history alone can lag).
  if (!(await allLocksConfirmedLocked(deviceIds))) {
    return { ok: true, graduated: false, reason: 'live device read did not confirm locked, not graduating this cycle' };
  }

  // Compare-and-swap: only write if still an unconfirmed estimate, so a Quo
  // text or a manual tap that lands in the gap between the scan and this
  // write always wins instead of being clobbered.
  const { data: updated, error } = await sb
    .from('cleaning_sessions')
    .update({
      finished_at: quietSinceIso,
      finish_source: 'auto_quiet',
      finish_estimated: false,
      updated_at: new Date().toISOString(),
    })
    .eq('property_id', propertyId)
    .eq('checkout_date', checkoutDate)
    .eq('finish_source', 'estimate')
    .select('property_id');
  if (error) return { ok: false, graduated: false, reason: error.message };
  if (!updated || updated.length === 0) {
    return { ok: true, graduated: false, reason: 'lost race to a concurrent confirm' };
  }
  return { ok: true, graduated: true };
}

/** The cron's entry point: scan every unconfirmed estimate and try to
 *  graduate each. One bad row never aborts the sweep. Rows already confirmed
 *  by Quo or a manual tap (finish_estimated=false) are excluded by the WHERE
 *  clause, so this never touches an already-authoritative row. Unbounded by
 *  age on purpose: every graduated row leaves this set permanently, so the
 *  scan only ever holds genuinely still-pending estimates, however old. */
export async function autoGraduateQuietEstimates(
  sb: SupabaseClient,
  thresholdMinutes: number,
): Promise<{ scanned: number; graduated: number; skipped: number; errors: number }> {
  const { data } = await sb
    .from('cleaning_sessions')
    .select('property_id, checkout_date')
    .eq('finish_source', 'estimate')
    .eq('finish_estimated', true)
    .not('entered_at', 'is', null)
    .order('finished_at', { ascending: true });

  const rows = (data ?? []) as Array<{ property_id: string; checkout_date: string }>;
  let graduated = 0;
  let skipped = 0;
  let errors = 0;
  for (const row of rows) {
    try {
      const r = await tryAutoGraduateEstimate(sb, row.property_id, row.checkout_date, thresholdMinutes);
      if (!r.ok) errors += 1;
      else if (r.graduated) graduated += 1;
      else skipped += 1;
    } catch {
      errors += 1;
    }
  }
  return { scanned: rows.length, graduated, skipped, errors };
}
