import 'server-only';
import { supabaseAdmin as supabase, isServiceConfigured } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';
import { buildDoNotHostIndex, normalizeEmail, EMPTY_DO_NOT_HOST_INDEX, type DoNotHostGuest, type DoNotHostIndex } from '@/lib/do-not-host';
import { displayName } from '@/lib/guests-types';

/**
 * The do-not-host register: every flagged guest record with every key it is
 * known by, for the resolver in do-not-host.ts.
 *
 * The record carries its id, email and Guesty guest id. Its phones are
 * collected from where a guest's phone already lives: the Helm-native
 * `guests` row with the same email, and the `bookings` rows under that
 * email (an OTA stay copied from Guesty carries the number the channel
 * gave). No second phone directory: a surface that already names a number
 * (the New numbers card) hands the stay's email in and the register
 * answers by email first.
 *
 * Every read fails soft to fewer keys. The flag is an enrichment, never a
 * gate, so a missing source can only hide a line, never draw one on the
 * wrong person.
 */
type FlaggedRow = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  guesty_guest_id: string | null;
  do_not_host_reason: string | null;
  do_not_host_set_by: string | null;
  do_not_host_set_at: string | null;
};

export async function loadDoNotHostGuests(): Promise<DoNotHostGuest[]> {
  if (!isServiceConfigured) return [];
  const rows = await selectAllPaged<FlaggedRow>((from, to) =>
    supabase
      .from('audience_contacts')
      .select('id, email, first_name, last_name, guesty_guest_id, do_not_host_reason, do_not_host_set_by, do_not_host_set_at')
      .eq('do_not_host', true)
      .order('do_not_host_set_at', { ascending: false, nullsFirst: false })
      .order('id')
      .range(from, to),
  ).catch(() => [] as FlaggedRow[]);
  if (rows.length === 0) return [];

  const emails = [...new Set(rows.map((r) => normalizeEmail(r.email)).filter(Boolean))];
  const phonesByEmail = await loadPhonesByEmail(emails);

  return rows.map((r) => {
    const email = normalizeEmail(r.email);
    return {
      contact_id: r.id,
      name: displayName(r),
      guesty_guest_ids: r.guesty_guest_id ? [r.guesty_guest_id] : [],
      emails: email ? [email] : [],
      phones: phonesByEmail.get(email) ?? [],
      reason: r.do_not_host_reason,
      set_by: r.do_not_host_set_by,
      set_at: r.do_not_host_set_at,
    };
  });
}

/** The register as a resolver. A failed read is an empty index. */
export async function loadDoNotHostIndex(): Promise<DoNotHostIndex> {
  try {
    return buildDoNotHostIndex(await loadDoNotHostGuests());
  } catch {
    return EMPTY_DO_NOT_HOST_INDEX;
  }
}

/** Characters PostgREST reads as filter syntax or ilike wildcards. An email
 *  carrying one is matched by its guests row only. */
const UNSAFE_IN_FILTER = /[,()"%_\\]/;

async function loadPhonesByEmail(emails: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (emails.length === 0) return out;
  const add = (email: string, ...phones: Array<string | null | undefined>) => {
    const list = out.get(email) ?? [];
    for (const p of phones) {
      const v = (p ?? '').trim();
      if (v && !list.includes(v)) list.push(v);
    }
    out.set(email, list);
  };

  // Each read fails soft to nothing: fewer phone keys, never a wrong one.
  const soft = async <T,>(run: () => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> => {
    try {
      const { data, error } = await run();
      return error ? [] : data ?? [];
    } catch {
      return [];
    }
  };
  const safe = emails.filter((e) => !UNSAFE_IN_FILTER.test(e));
  const [guests, bookings] = await Promise.all([
    soft<{ email_normalized: string | null; phone: string | null; phone_e164: string | null }>(() =>
      supabase.from('guests').select('email_normalized, phone, phone_e164').in('email_normalized', emails),
    ),
    safe.length === 0
      ? Promise.resolve([] as Array<{ guest_email: string | null; guest_phone: string | null }>)
      : soft<{ guest_email: string | null; guest_phone: string | null }>(() =>
          supabase
            .from('bookings')
            .select('guest_email, guest_phone')
            .or(safe.map((e) => `guest_email.ilike.${e}`).join(','))
            .not('guest_phone', 'is', null)
            .limit(1000),
        ),
  ]);

  for (const g of guests) {
    const email = normalizeEmail(g.email_normalized);
    if (email) add(email, g.phone, g.phone_e164);
  }
  for (const b of bookings) {
    const email = normalizeEmail(b.guest_email);
    if (email && emails.includes(email)) add(email, b.guest_phone);
  }
  return out;
}

/**
 * The Guesty guest behind each reservation an approval card names, so an
 * OTA card (no email, no phone) still resolves. Fails soft to {}.
 */
export async function loadGuestyGuestByReservation(reservationIds: readonly string[]): Promise<Record<string, string>> {
  const ids = [...new Set(reservationIds.filter(Boolean))];
  if (!isServiceConfigured || ids.length === 0) return {};
  try {
    const { data, error } = await supabase
      .from('guesty_reservations')
      .select('guesty_reservation_id, guest_id')
      .in('guesty_reservation_id', ids)
      .not('guest_id', 'is', null);
    if (error || !data) return {};
    const out: Record<string, string> = {};
    for (const r of data as Array<{ guesty_reservation_id: string; guest_id: string | null }>) {
      if (r.guest_id) out[r.guesty_reservation_id] = r.guest_id;
    }
    return out;
  } catch {
    return {};
  }
}
