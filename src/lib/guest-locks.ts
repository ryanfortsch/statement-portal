/**
 * Guest × Seam door codes. The booking-driven sibling of field-locks.ts:
 * issue a time-boxed PIN on a property's mapped Schlage lock for a stay
 * (check-in → check-out), or a short "test code" (now → +3h) to pressure-test
 * the Helm→Seam→Schlage path. Revoke removes the Seam code and soft-deletes
 * the row.
 *
 * Operator-in-the-loop: issuing a code does NOT message the guest (auto-
 * delivery is a later layer). Stays dark until SEAM_API_KEY is set AND the
 * property has a mapped, active lock in lock_devices.
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient } from '@/lib/supabase-admin';
import {
  seamConfigured,
  createAccessCode,
  deleteAccessCode,
  listAccessCodes,
  listUnmanagedAccessCodes,
  listDevices,
  normalizeFromDevice,
  ingestDeviceBattery,
  type SeamAccessCodeFull,
} from '@/lib/seam';

export type PropertyLock = { device_id: string; display_name: string | null };

export type GuestCodeBookingRow = {
  booking_id: string;
  guest_name: string | null;
  check_in: string;
  check_out: string;
  code: { id: string; code: string | null } | null;
};

export type GuestTestCode = { id: string; code: string | null; ends_at: string | null };

export type UnmappedLock = { device_id: string; label: string };

/** A code currently programmed on the lock, straight from Seam. `source`
 *  distinguishes Helm/Seam-managed codes from ones set outside Seam. */
export type LockCode = {
  access_code_id: string;
  name: string | null;
  code: string | null;
  starts_at: string | null;
  ends_at: string | null;
  source: 'helm' | 'external';
};

export type GuestCodeView = {
  seamConfigured: boolean;
  lock: PropertyLock | null;
  bookingRows: GuestCodeBookingRow[];
  testCodes: GuestTestCode[];
  unmappedLocks: UnmappedLock[];
  lockCodes: LockCode[];
};

export type IssueResult = { ok: true; code: string } | { ok: false; error: string };

// Schlage Encode wants all codes the same length; field-locks uses 4 digits,
// so we match (no leading zero).
function randomPin(): string {
  return String(1000 + Math.floor(Math.random() * 9000));
}

// Eastern offset; pilot properties are Cape Ann. The hour-level approximation
// across DST is harmless for a stay-length window (mirrors field-locks).
const CHECKIN_HOUR = '16:00:00';
const CHECKOUT_HOUR = '11:00:00';
const ET_OFFSET = '-04:00';

function todayET(): string {
  // en-CA renders YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function getPropertyLock(sb: SupabaseClient, propertyId: string): Promise<PropertyLock | null> {
  const { data } = await sb
    .from('lock_devices')
    .select('device_id, display_name')
    .eq('property_id', propertyId)
    .eq('active', true)
    .limit(1);
  const row = ((data ?? [])[0] as { device_id: string; display_name: string | null } | undefined) ?? null;
  return row ? { device_id: row.device_id, display_name: row.display_name } : null;
}

/** Everything the Guest door codes panel needs, in one call. */
export async function getGuestCodeView(propertyId: string): Promise<GuestCodeView> {
  try {
    const sb = getServiceClient();
    const lock = await getPropertyLock(sb, propertyId);
    const today = todayET();
    const [{ data: bks }, { data: codes }, { data: unmapped }] = await Promise.all([
      sb
        .from('bookings')
        .select('id, guest_name, check_in, check_out')
        .eq('property_id', propertyId)
        .eq('status', 'confirmed')
        .gte('check_out', today)
        .order('check_in', { ascending: true })
        .limit(25),
      sb
        .from('guest_access_codes')
        .select('id, code, booking_id, ends_at')
        .eq('property_id', propertyId)
        .is('removed_at', null),
      sb
        .from('lock_devices')
        .select('device_id, display_name, manufacturer')
        .is('property_id', null)
        .eq('active', true),
    ]);

    const codeRows = (codes ?? []) as {
      id: string;
      code: string | null;
      booking_id: string | null;
      ends_at: string | null;
    }[];
    const byBooking = new Map<string, { id: string; code: string | null }>();
    for (const c of codeRows) if (c.booking_id) byBooking.set(c.booking_id, { id: c.id, code: c.code });

    // Collapse duplicate bookings for the same stay window. The iCal ingest can
    // emit one row per feed for a single stay — one with the guest name, one
    // with only the confirmation code. Same (check_in, check_out) on one
    // property = one stay, so we'd never want to issue two codes for it.
    const isRealName = (n: string | null) => !!n && !/^reservation\b/i.test(n);
    const byStay = new Map<string, GuestCodeBookingRow>();
    for (const b of (bks ?? []) as {
      id: string;
      guest_name: string | null;
      check_in: string;
      check_out: string;
    }[]) {
      const row: GuestCodeBookingRow = {
        booking_id: b.id,
        guest_name: b.guest_name,
        check_in: b.check_in,
        check_out: b.check_out,
        code: byBooking.get(b.id) ?? null,
      };
      const key = `${b.check_in}|${b.check_out}`;
      const prev = byStay.get(key);
      if (!prev) {
        byStay.set(key, row);
        continue;
      }
      // Keep a real guest name and any already-issued code; prefer the
      // booking_id that owns the code so re-issue stays idempotent.
      const codeOwner = prev.code ? prev : row.code ? row : prev;
      byStay.set(key, {
        booking_id: codeOwner.booking_id,
        guest_name: isRealName(prev.guest_name) ? prev.guest_name : row.guest_name,
        check_in: prev.check_in,
        check_out: prev.check_out,
        code: prev.code ?? row.code,
      });
    }
    const bookingRows: GuestCodeBookingRow[] = [...byStay.values()];

    const testCodes: GuestTestCode[] = codeRows
      .filter((c) => !c.booking_id)
      .map((c) => ({ id: c.id, code: c.code, ends_at: c.ends_at }));

    const unmappedLocks: UnmappedLock[] = (
      (unmapped ?? []) as { device_id: string; display_name: string | null; manufacturer: string | null }[]
    ).map((l) => ({ device_id: l.device_id, label: l.display_name ?? l.manufacturer ?? l.device_id }));

    // What's physically on the lock right now (Helm-issued or not), read from
    // Seam. Best-effort — a Seam hiccup must not break the property page.
    let lockCodes: LockCode[] = [];
    if (lock && seamConfigured()) {
      const toRow = (c: SeamAccessCodeFull, source: 'helm' | 'external'): LockCode => ({
        access_code_id: c.access_code_id,
        name: c.name ?? null,
        code: c.code ?? null,
        starts_at: c.starts_at ?? null,
        ends_at: c.ends_at ?? null,
        source,
      });
      // Managed (created through Seam/Helm) + unmanaged (set in the Schlage app
      // or already on the lock). Each call best-effort so one failing doesn't
      // hide the other or break the page.
      const [managed, unmanaged] = await Promise.all([
        listAccessCodes(lock.device_id).catch(() => [] as SeamAccessCodeFull[]),
        listUnmanagedAccessCodes(lock.device_id).catch(() => [] as SeamAccessCodeFull[]),
      ]);
      const seen = new Set<string>();
      lockCodes = [
        ...managed.map((c) => toRow(c, 'helm')),
        ...unmanaged.map((c) => toRow(c, 'external')),
      ].filter((c) => (seen.has(c.access_code_id) ? false : (seen.add(c.access_code_id), true)));
    }

    return { seamConfigured: seamConfigured(), lock, bookingRows, testCodes, unmappedLocks, lockCodes };
  } catch {
    // Table not migrated yet, etc. — panel shows its empty state.
    return {
      seamConfigured: seamConfigured(),
      lock: null,
      bookingRows: [],
      testCodes: [],
      unmappedLocks: [],
      lockCodes: [],
    };
  }
}

/** Short code valid now → +3h, to verify a real PIN lands on the lock. */
export async function issueTestCode(propertyId: string, byEmail: string): Promise<IssueResult> {
  if (!seamConfigured()) return { ok: false, error: 'SEAM_API_KEY is not set in this environment.' };
  const sb = getServiceClient();
  const lock = await getPropertyLock(sb, propertyId);
  if (!lock) return { ok: false, error: 'No active Schlage lock is mapped to this property in Seam yet.' };

  const pin = randomPin();
  const startsAt = new Date().toISOString();
  const endsAt = new Date(Date.now() + 3 * 3_600_000).toISOString();
  try {
    const ac = await createAccessCode({
      deviceId: lock.device_id,
      name: `Helm test · ${byEmail.split('@')[0]}`,
      code: pin,
      startsAt,
      endsAt,
    });
    await sb.from('guest_access_codes').insert({
      property_id: propertyId,
      device_id: lock.device_id,
      booking_id: null,
      guest_name: 'Test code',
      code: pin,
      seam_access_code_id: ac?.access_code_id ?? null,
      starts_at: startsAt,
      ends_at: endsAt,
      created_by_email: byEmail,
    });
    return { ok: true, code: pin };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Stay-scoped code (check-in → check-out). Idempotent per booking+lock. */
export async function issueGuestCodeForBooking(
  propertyId: string,
  bookingId: string,
  byEmail: string,
): Promise<IssueResult> {
  if (!seamConfigured()) return { ok: false, error: 'SEAM_API_KEY is not set in this environment.' };
  const sb = getServiceClient();
  const lock = await getPropertyLock(sb, propertyId);
  if (!lock) return { ok: false, error: 'No active Schlage lock is mapped to this property in Seam yet.' };

  const { data: existing } = await sb
    .from('guest_access_codes')
    .select('code')
    .eq('booking_id', bookingId)
    .eq('device_id', lock.device_id)
    .is('removed_at', null)
    .limit(1);
  const prior = ((existing ?? [])[0] as { code: string | null } | undefined) ?? null;
  if (prior?.code) return { ok: true, code: prior.code };

  const { data: bk } = await sb
    .from('bookings')
    .select('guest_name, check_in, check_out')
    .eq('id', bookingId)
    .maybeSingle();
  const booking = bk as { guest_name: string | null; check_in: string; check_out: string } | null;
  if (!booking) return { ok: false, error: 'Booking not found.' };

  const pin = randomPin();
  const startsAt = new Date(`${booking.check_in}T${CHECKIN_HOUR}${ET_OFFSET}`).toISOString();
  const endsAt = new Date(`${booking.check_out}T${CHECKOUT_HOUR}${ET_OFFSET}`).toISOString();
  try {
    const ac = await createAccessCode({
      deviceId: lock.device_id,
      name: `Guest · ${booking.guest_name ?? 'stay'}`,
      code: pin,
      startsAt,
      endsAt,
    });
    await sb.from('guest_access_codes').insert({
      property_id: propertyId,
      device_id: lock.device_id,
      booking_id: bookingId,
      guest_name: booking.guest_name,
      code: pin,
      seam_access_code_id: ac?.access_code_id ?? null,
      starts_at: startsAt,
      ends_at: endsAt,
      created_by_email: byEmail,
    });
    return { ok: true, code: pin };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Remove a code from the lock (Seam) and soft-delete the row. */
export async function revokeGuestCode(codeId: string): Promise<{ ok: boolean; error?: string }> {
  const sb = getServiceClient();
  const { data } = await sb
    .from('guest_access_codes')
    .select('id, seam_access_code_id')
    .eq('id', codeId)
    .is('removed_at', null)
    .maybeSingle();
  const row = (data as { id: string; seam_access_code_id: string | null } | null) ?? null;
  if (!row) return { ok: true }; // already gone

  if (row.seam_access_code_id && seamConfigured()) {
    try {
      await deleteAccessCode(row.seam_access_code_id);
    } catch {
      // Already removed/expired upstream — still mark it locally.
    }
  }
  const { error } = await sb
    .from('guest_access_codes')
    .update({ removed_at: new Date().toISOString() })
    .eq('id', codeId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Pull every Seam device into lock_devices (auto-registers, property_id null).
 * Runs as the signed-in operator from the panel, so it needs no CRON_SECRET —
 * the same work the /api/cron/sync-seam route does, callable from a button.
 */
export async function syncSeamDevices(): Promise<{ ok: boolean; count: number; error?: string }> {
  if (!seamConfigured()) return { ok: false, count: 0, error: 'SEAM_API_KEY is not set in this environment.' };
  try {
    const sb = getServiceClient();
    const devices = await listDevices();
    for (const d of devices) {
      await ingestDeviceBattery(sb, normalizeFromDevice(d));
    }
    return { ok: true, count: devices.length };
  } catch (err) {
    return { ok: false, count: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Assign a synced lock to a property (the in-app alternative to a SQL UPDATE). */
export async function mapLockToProperty(
  propertyId: string,
  deviceId: string,
): Promise<{ ok: boolean; error?: string }> {
  const sb = getServiceClient();
  const { error } = await sb
    .from('lock_devices')
    .update({ property_id: propertyId, updated_at: new Date().toISOString() })
    .eq('device_id', deviceId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
