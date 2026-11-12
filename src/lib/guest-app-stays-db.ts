/**
 * Server side of the guest app's stay links (/h/s/<token>, guest_app_stays).
 * The rules live in guest-app-stays.ts; this file reads and writes.
 *
 * What it reads, and what it never reads:
 *   - the home's app through loadGuestApp (guest-app-db.ts), the permanent
 *     page's own loader, untouched: everything a stay page shows about the
 *     house is exactly what the printed card shows;
 *   - the stay from `bookings` (the minted row, followed through
 *     duplicate_of to the canonical one), live, so a date change moves the
 *     window and a cancellation ends it;
 *   - the door code ONLY through getLiveStayCode (guest-locks.ts), and only
 *     in revealStayCode. loadGuestStay, which builds the page's HTML, turns
 *     the code into a StayCodeState (no digits) before it returns.
 *   - never property_access: no Wi-Fi password, no standing house code, no
 *     gate or alarm code passes through this module.
 *   - each bookings row's channel, for stayMayAskEmail: only a plainly
 *     direct stay may show the email line (guest-app-join.ts writes it).
 * guest-app-stays.test.ts reads this file and fails if any of that changes.
 */
import 'server-only';
import { randomBytes } from 'node:crypto';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { getGuestAppRow, guestAppOrigin, guestAppUrl, guestyCheckinTime, loadGuestApp } from '@/lib/guest-app-db';
import { getLiveStayCode } from '@/lib/guest-locks';
import { loadGuestTimes } from '@/lib/property-rates';
import { isCapeAnnOps } from '@/lib/property-scope';
import {
  appForStay,
  buildStayLayer,
  codeIsLive,
  codeState,
  opensLine,
  stayMatchesReservation,
  stayMayAskEmail,
  stayPhase,
  stayWindow,
  STAY_TOKEN_RE,
  type GuestStayView,
  type StayClusterRow,
  type StayDates,
  type StayTimes,
  type StayWindow,
} from '@/lib/guest-app-stays';

export function newStayToken(): string {
  return randomBytes(16).toString('hex');
}

export function guestStayUrl(token: string): string {
  return `${guestAppOrigin()}/h/s/${token}`;
}

type StayRow = {
  id: string;
  token: string;
  property_id: string;
  booking_id: string;
  revoked_at: string | null;
};

const STAY_COLS = 'id, token, property_id, booking_id, revoked_at';

type BookingRow = StayClusterRow & {
  id: string;
  property_id: string;
  status: string;
  check_in: string;
  check_out: string;
  duplicate_of: string | null;
  channel: string | null;
};

const BOOKING_COLS = 'id, property_id, status, check_in, check_out, duplicate_of, channel, source, external_booking_id, external_confirmation_code';

/** A stay is these statuses; cancelled, inquiry, pending and block are not. */
const STAY_STATUSES = new Set(['confirmed', 'completed']);

async function bookingById(id: string): Promise<BookingRow | null> {
  const { data, error } = await supabaseAdmin.from('bookings').select(BOOKING_COLS).eq('id', id).maybeSingle();
  if (error || !data) return null;
  return data as BookingRow;
}

/**
 * The stay a bookings row belongs to: its canonical row (duplicate_of
 * followed, a few hops at most) and every row that is a duplicate of it,
 * since a door code may have been issued against either.
 */
async function stayCluster(bookingId: string): Promise<{ canonical: BookingRow; cluster: BookingRow[] } | null> {
  let row = await bookingById(bookingId);
  for (let hop = 0; row?.duplicate_of && hop < 4; hop++) row = await bookingById(row.duplicate_of);
  if (!row || row.duplicate_of) return null;
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select(BOOKING_COLS)
    .eq('property_id', row.property_id)
    .eq('duplicate_of', row.id);
  if (error) return null;
  return { canonical: row, cluster: [row, ...((data ?? []) as BookingRow[])] };
}

/** The home this stay belongs to can carry a stay link: a live Cape Ann home with its guest app on. */
async function homeAllowsStays(
  propertyId: string,
): Promise<{ welcomeNote: string | null; homeToken: string; lockBrand: string | null; name: string | null } | null> {
  const [homeRow, propRes] = await Promise.all([
    getGuestAppRow(propertyId),
    supabaseAdmin.from('properties').select('id, name, region, kind, is_active, smart_lock_brand').eq('id', propertyId).maybeSingle(),
  ]);
  const prop = propRes.data as {
    name: string | null;
    region: string | null;
    kind: string | null;
    is_active: boolean | null;
    smart_lock_brand: string | null;
  } | null;
  if (!homeRow?.enabled || !prop || prop.is_active !== true || !isCapeAnnOps({ region: prop.region, kind: prop.kind })) return null;
  return { welcomeNote: homeRow.welcome_note, homeToken: homeRow.token, lockBrand: prop.smart_lock_brand, name: prop.name };
}

async function stayTimes(propertyId: string, checkIn: string): Promise<StayTimes> {
  const [times, guestyCheckin, adjRes] = await Promise.all([
    loadGuestTimes([propertyId]),
    guestyCheckinTime(propertyId),
    supabaseAdmin
      .from('checkout_adjustments')
      .select('adjusted_check_out, adjusted_checkout_time, created_at')
      .eq('property_id', propertyId)
      .eq('stay_check_in', checkIn)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1),
  ]);
  const t = times.get(propertyId);
  const adj = ((adjRes.data ?? []) as Array<{ adjusted_check_out: string | null; adjusted_checkout_time: string | null }>)[0];
  return {
    // The rate plan on a Helm-run home; Guesty's listing time on the rest.
    checkInTime: t?.checkin || guestyCheckin,
    checkOutTime: t?.checkout ?? null,
    adjustedCheckOut: adj?.adjusted_check_out ?? null,
    adjustedCheckOutTime: adj?.adjusted_checkout_time ?? null,
  };
}

async function lockMapped(propertyId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from('lock_devices').select('device_id').eq('property_id', propertyId).eq('active', true).limit(1);
  return Array.isArray(data) && data.length > 0;
}

// ── Minting ────────────────────────────────────────────────────────────────

export type StayLink = { token: string; url: string; opensAt: string; closesAt: string };

async function liveLinkFor(ids: readonly string[]): Promise<StayRow | null> {
  const { data, error } = await supabaseAdmin
    .from('guest_app_stays')
    .select(STAY_COLS)
    .in('booking_id', [...ids])
    .is('revoked_at', null)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? []) as StayRow[])[0] ?? null;
}

export type MintOptions = {
  /** Who asked: an email, 'automations' or 'stay-concierge'. */
  by: string;
  now?: Date;
  /** Refuse a booking at any other home (a property page action names its home). */
  propertyId?: string;
};

/**
 * The stay link for one booking, made on first ask and the same link after.
 * Null when the stay cannot have one: not a confirmed stay, already over,
 * at another home than the caller named, or a home without the guest app.
 * Throws only on a failed write.
 */
export async function ensureStayLink(bookingId: string, opts: MintOptions): Promise<StayLink | null> {
  const { by, now = new Date() } = opts;
  if (!isServiceConfigured || !bookingId) return null;
  const found = await stayCluster(bookingId);
  if (!found || found.canonical.status !== 'confirmed') return null;
  if (opts.propertyId && found.canonical.property_id !== opts.propertyId) return null;
  const { canonical, cluster } = found;
  if (!(await homeAllowsStays(canonical.property_id))) return null;
  const window = stayWindow(
    { checkIn: canonical.check_in, checkOut: canonical.check_out },
    await stayTimes(canonical.property_id, canonical.check_in),
  );
  if (!window || stayPhase(now, window) === 'over') return null;

  const ids = cluster.map((r) => r.id);
  let row = await liveLinkFor(ids);
  if (!row) {
    const { data, error } = await supabaseAdmin
      .from('guest_app_stays')
      .insert({ token: newStayToken(), property_id: canonical.property_id, booking_id: canonical.id, created_by: by })
      .select(STAY_COLS)
      .maybeSingle();
    // A second mint racing this one hits the one-live-link index: read the winner.
    if (error && !/duplicate key|unique/i.test(error.message)) throw new Error(error.message);
    row = (data as StayRow | null) ?? (await liveLinkFor(ids));
  }
  if (!row) return null;
  return { token: row.token, url: guestStayUrl(row.token), opensAt: window.opensAt.toISOString(), closesAt: window.closesAt.toISOString() };
}

/** Retire a stay's link (it reached someone it should not have) and make its replacement. */
export async function rotateStayLink(bookingId: string, opts: MintOptions): Promise<StayLink | null> {
  const now = opts.now ?? new Date();
  if (!isServiceConfigured || !bookingId) return null;
  const found = await stayCluster(bookingId);
  if (!found) return null;
  if (opts.propertyId && found.canonical.property_id !== opts.propertyId) return null;
  const { error } = await supabaseAdmin
    .from('guest_app_stays')
    .update({ revoked_at: now.toISOString() })
    .in('booking_id', found.cluster.map((r) => r.id))
    .is('revoked_at', null);
  if (error) throw new Error(error.message);
  return ensureStayLink(found.canonical.id, { ...opts, now });
}

// ── Reading a link ─────────────────────────────────────────────────────────

type ResolvedStay = {
  token: string;
  /** guest_app_stays.id: what the email line counts its signups by. */
  stayId: string;
  propertyId: string;
  bookingIds: string[];
  dates: StayDates;
  times: StayTimes;
  window: StayWindow;
  home: { welcomeNote: string | null; lockBrand: string | null; name: string | null };
  /** stayMayAskEmail: a plainly direct stay, so the email line may show. */
  mayAskEmail: boolean;
};

/** A token to its live stay, or null (unknown, revoked, cancelled, moved homes, app off). */
async function resolveStay(token: string): Promise<ResolvedStay | null> {
  if (!isServiceConfigured || !STAY_TOKEN_RE.test(token)) return null;
  const { data, error } = await supabaseAdmin.from('guest_app_stays').select(STAY_COLS).eq('token', token).maybeSingle();
  const row = data as StayRow | null;
  if (error || !row || row.revoked_at) return null;
  const found = await stayCluster(row.booking_id);
  if (!found || !STAY_STATUSES.has(found.canonical.status) || found.canonical.property_id !== row.property_id) return null;
  const home = await homeAllowsStays(row.property_id);
  if (!home) return null;
  const dates = { checkIn: found.canonical.check_in, checkOut: found.canonical.check_out };
  const times = await stayTimes(row.property_id, dates.checkIn);
  const window = stayWindow(dates, times);
  if (!window) return null;
  return {
    token,
    stayId: row.id,
    propertyId: row.property_id,
    bookingIds: found.cluster.map((r) => r.id),
    dates,
    times,
    window,
    home: { welcomeNote: home.welcomeNote, lockBrand: home.lockBrand, name: home.name },
    mayAskEmail: stayMayAskEmail(found.canonical.channel, found.cluster.map((r) => r.channel)),
  };
}

/**
 * What /h/s/<token> renders. The digits never reach this return value:
 * the live code becomes a StayCodeState here, and only revealStayCode
 * hands digits out.
 */
export async function loadGuestStay(token: string, now = new Date()): Promise<GuestStayView> {
  const stay = await resolveStay(token);
  if (!stay) return { kind: 'void' };
  const app = await loadGuestApp(stay.propertyId, stay.home.welcomeNote, now);
  if (!app) return { kind: 'void' };
  const join = stay.mayAskEmail;
  const phase = stayPhase(now, stay.window);
  if (phase === 'over') return { kind: 'over', app, join };
  if (phase === 'before') return { kind: 'before', app, opens: opensLine(stay.window), join };

  const [mapped, live] = await Promise.all([lockMapped(stay.propertyId), getLiveStayCode(stay.propertyId, stay.bookingIds, now)]);
  const layer = buildStayLayer({
    dates: stay.dates,
    times: stay.times,
    window: stay.window,
    app,
    lockBrand: stay.home.lockBrand,
    lockMapped: mapped,
    code: codeState(live, now, stay.window),
    now,
  });
  if (!layer) return { kind: 'void' };
  return { kind: 'open', app: appForStay(app, layer), stay: layer, join };
}

/**
 * The email line's view of a token (guest-app-join.ts): the live stay and
 * whether it may ask, re-read at the POST like the code reveal. Null for a
 * link that no longer opens anything.
 */
export async function resolveStayForJoin(
  token: string,
): Promise<{ stayId: string; propertyId: string; homeName: string | null; mayAskEmail: boolean } | null> {
  const stay = await resolveStay(token);
  if (!stay) return null;
  return { stayId: stay.stayId, propertyId: stay.propertyId, homeName: stay.home.name, mayAskEmail: stay.mayAskEmail };
}

export type StayCodeReveal =
  | { ok: true; code: string; worksFrom: string | null; worksUntil: string | null; doorCount: number }
  | { ok: false; reason: 'not_found' | 'not_open' | 'no_code' };

/**
 * The digits, for the guest's tap. Re-reads everything (the link, the
 * stay, the window, the code) at the moment of the tap, so a page left
 * open past checkout or a code revoked since the page loaded gets nothing.
 */
export async function revealStayCode(token: string, now = new Date()): Promise<StayCodeReveal> {
  const stay = await resolveStay(token);
  if (!stay) return { ok: false, reason: 'not_found' };
  if (stayPhase(now, stay.window) !== 'open') return { ok: false, reason: 'not_open' };
  const live = await getLiveStayCode(stay.propertyId, stay.bookingIds, now);
  if (!live || !codeIsLive(live, now, stay.window)) return { ok: false, reason: 'no_code' };
  const state = codeState(live, now, stay.window);
  return { ok: true, code: live.code, worksFrom: state.worksFrom, worksUntil: state.worksUntil, doorCount: state.doorCount };
}

/** Count an open (p_code false) or a code shown (true). Never throws. */
export async function recordStaySeen(token: string, code: boolean): Promise<void> {
  if (!isServiceConfigured || !STAY_TOKEN_RE.test(token)) return;
  try {
    await supabaseAdmin.rpc('guest_app_stay_seen', { p_token: token, p_code: code });
  } catch {
    /* counted next time */
  }
}

// ── The concierge bridge ───────────────────────────────────────────────────

export type ReservationLinkInput = {
  propertyId: string;
  checkIn: string;
  checkOut: string;
  reservationId?: string | null;
  confirmationCode?: string | null;
};

export type ReservationLink =
  | { kind: 'stay'; url: string; opensAt: string; closesAt: string }
  | { kind: 'home'; url: string };

/**
 * The link a message to this reservation should carry: its stay link when
 * Helm can find the stay (the home's one confirmed canonical stay on exactly
 * these dates, not naming a different reservation), else the home's
 * permanent link. Null when the home has no guest app at all.
 */
export async function guestAppLinkForReservation(input: ReservationLinkInput, by: string, now = new Date()): Promise<ReservationLink | null> {
  if (!isServiceConfigured) return null;
  const home = await getGuestAppRow(input.propertyId);
  if (!home?.enabled) return null;
  const homeLink: ReservationLink = { kind: 'home', url: guestAppUrl(home.token) };

  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select(BOOKING_COLS)
    .eq('property_id', input.propertyId)
    .eq('check_in', input.checkIn)
    .eq('check_out', input.checkOut)
    .eq('status', 'confirmed')
    .is('duplicate_of', null);
  const candidates = (data ?? []) as BookingRow[];
  if (error || candidates.length !== 1) return homeLink;

  const found = await stayCluster(candidates[0].id);
  if (!found || !stayMatchesReservation(found.cluster, input)) return homeLink;
  // A mint that fails (the stays table unreachable) still answers with the
  // home's link, which carries no code, rather than leaving the message bare.
  const link = await ensureStayLink(found.canonical.id, { by, now, propertyId: input.propertyId }).catch((err: unknown) => {
    console.error('[guest-app-stays] mint failed:', err instanceof Error ? err.message : String(err));
    return null;
  });
  return link ? { kind: 'stay', url: link.url, opensAt: link.opensAt, closesAt: link.closesAt } : homeLink;
}

/** For a message to a stay Helm already holds (automations): the stay link, else the home's. */
export async function guestAppLinkForBooking(bookingId: string, propertyId: string, by: string, mint: boolean): Promise<string | null> {
  if (!isServiceConfigured) return null;
  try {
    if (mint) {
      // A failed mint (the stays table unreachable) falls through to the home's link.
      const link = await ensureStayLink(bookingId, { by, propertyId }).catch((err: unknown) => {
        console.error('[guest-app-stays] mint failed:', err instanceof Error ? err.message : String(err));
        return null;
      });
      if (link) return link.url;
    }
    const home = await getGuestAppRow(propertyId);
    return home?.enabled ? guestAppUrl(home.token) : null;
  } catch {
    return null;
  }
}
