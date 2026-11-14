/**
 * A partner home's host on staycapeann.com: sign-in codes, sessions, their
 * requests and their answers. The rules are src/lib/partner-host.ts.
 *
 *   requestHostCode   POST /api/pms/host/code. Answers the same whether or
 *                     not the email hosts a home, so the form tells no one
 *                     who our hosts are. Five codes an hour per email.
 *   startHostSession  POST /api/pms/host/session. The newest code only, ten
 *                     minutes, five tries; a match is claimed once.
 *   hostForSession    every host call: the token's session, live, and the
 *                     partner homes its email hosts right now. A host taken
 *                     off their home's row loses the session with it.
 *   listHostRequests  their homes' open requests and the last 60 days.
 *   hostDecide        Accept or Decline, through the office's own writers
 *                     (acceptBookingRequest, declineBookingRequest), after
 *                     checking the request is on one of their homes.
 *   hostPayouts       their homes' Stripe standing and every booked stay's
 *                     money (src/lib/partner-host-payouts.ts).
 *   hostSetupLink     a fresh Stripe setup link for one of their homes.
 *   hostRates         their homes' prices: the plan's four host lines and
 *                     the seasons ahead (src/lib/partner-host-rates.ts).
 *   hostSavePlan,     write those prices, on one of their homes only,
 *   hostSaveSeason    through the office's own rate writers, recorded as
 *                     host:<email>, then rebuild the home's calendar mirror.
 *
 * Helm keeps sha256 hashes of codes and tokens, never the values.
 */
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { acceptBookingRequest, declineBookingRequest } from '@/lib/booking-requests-db';
import { BOOKING_REQUEST_COLS, type BookingRequestRow } from '@/lib/booking-requests';
import { displayTitle } from '@/lib/sca-quotes-types';
import { sendHostCode } from '@/lib/partner-host-email';
import { selectAllPaged } from '@/lib/paged-select';
import { listedPartners } from '@/lib/partner-listed';
import { threadCountsFor } from '@/lib/partner-messages-db';
import { makeSetupLink } from '@/lib/partner-payments-db';
import { getRatePlan, getRateDays, setRateDays, upsertRatePlan } from '@/lib/property-rates';
import { writeHelmCalendarMirror } from '@/lib/helm-calendar-mirror';
import { shiftIsoDay } from '@/lib/sca-quotes-types';
import {
  HOST_SEASON_WINDOW_DAYS,
  hostPlanPatch,
  hostRatesHome,
  hostSeasonRows,
  parseHostPlan,
  parseHostSeason,
  type HostRatesHome,
} from '@/lib/partner-host-rates';
import { PARTNER_PAYMENT_COLS, shapeAccount, type PartnerPaymentAccount } from '@/lib/partner-payments';
import { HOST_PAYOUT_STAYS, hostPayoutsView, type HostPayoutsView } from '@/lib/partner-host-payouts';
import type { PartnerFeedChannel } from '@/lib/partner-calendar';
import { easternIsoDay, hostCalendarSpans, hostCalendarWindow, hostFeedView, type HostCalendarSpan, type HostFeedView } from '@/lib/partner-host-calendar';
import {
  HOST_CODE_MINUTES,
  HOST_CODE_TRIES,
  HOST_CODES_PER_HOUR,
  HOST_HISTORY_DAYS,
  HOST_NO_HOLD,
  HOST_SESSION_DAYS,
  homesForHost,
  hostActor,
  hostCodeHash,
  hostCodeMatches,
  hostRequestView,
  hostSessionHash,
  makeHostCode,
  makeHostSessionToken,
  normalizeHostCode,
  normalizeHostEmail,
  parseHostSessionToken,
  sortHostRequests,
  type HostHome,
  type HostRequestView,
} from '@/lib/partner-host';

const CODES = 'partner_host_codes';
const SESSIONS = 'partner_host_sessions';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PartnerRow = { id: string; name: string | null; title: string | null; kind: string | null; owner_emails: unknown; owner_full: string | null };

/** Every partner home. A small set; the email match runs in code so case never decides it. */
async function partnerHomes(): Promise<PartnerRow[]> {
  const { data, error } = await supabaseAdmin
    .from('properties')
    .select('id, name, title, kind, owner_emails, owner_full')
    .eq('kind', 'partner')
    .order('id')
    .limit(1000);
  if (error) throw new Error(`partner homes read failed: ${error.message}`);
  return (data ?? []) as PartnerRow[];
}

function asHostHome(p: PartnerRow): HostHome {
  return { id: p.id, title: displayTitle(p.title) || p.name || p.id };
}

export type HostCodeResult = { ok: true } | { ok: false; reason: 'invalid' | 'not_configured' };

export async function requestHostCode(rawEmail: unknown, now: Date = new Date()): Promise<HostCodeResult> {
  const email = normalizeHostEmail(rawEmail);
  if (!email) return { ok: false, reason: 'invalid' };
  if (!isServiceConfigured) return { ok: false, reason: 'not_configured' };

  // Not a host: the same answer as a send.
  if (homesForHost(email, await partnerHomes()).length === 0) return { ok: true };

  const since = new Date(now.getTime() - 3600_000).toISOString();
  const { count, error: countErr } = await supabaseAdmin
    .from(CODES)
    .select('id', { count: 'exact', head: true })
    .eq('email', email)
    .gte('created_at', since);
  if (countErr) throw new Error(`host code count failed: ${countErr.message}`);
  if ((count ?? 0) >= HOST_CODES_PER_HOUR) return { ok: true };

  const code = makeHostCode();
  const { data, error } = await supabaseAdmin
    .from(CODES)
    .insert({
      email,
      code_hash: hostCodeHash(email, code),
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + HOST_CODE_MINUTES * 60_000).toISOString(),
    })
    .select('id')
    .single();
  if (error) throw new Error(`host code insert failed: ${error.message}`);
  await sendHostCode(email, code, (data as { id: string }).id);
  return { ok: true };
}

export type HostSessionResult =
  | { ok: true; token: string; expires_at: string }
  | { ok: false; reason: 'invalid' | 'wrong_code' | 'expired' | 'too_many' | 'not_configured' };

export async function startHostSession(rawEmail: unknown, rawCode: unknown, now: Date = new Date()): Promise<HostSessionResult> {
  const email = normalizeHostEmail(rawEmail);
  const code = normalizeHostCode(rawCode);
  if (!email || !code) return { ok: false, reason: 'invalid' };
  if (!isServiceConfigured) return { ok: false, reason: 'not_configured' };

  const { data, error } = await supabaseAdmin
    .from(CODES)
    .select('id, code_hash, expires_at, attempts, used_at')
    .eq('email', email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`host code read failed: ${error.message}`);
  const row = data as { id: string; code_hash: string; expires_at: string; attempts: number; used_at: string | null } | null;
  if (!row || row.used_at || Date.parse(row.expires_at) <= now.getTime()) return { ok: false, reason: 'expired' };
  if (row.attempts >= HOST_CODE_TRIES) return { ok: false, reason: 'too_many' };

  if (!hostCodeMatches(email, code, row.code_hash)) {
    await supabaseAdmin.from(CODES).update({ attempts: row.attempts + 1 }).eq('id', row.id).eq('attempts', row.attempts);
    return { ok: false, reason: row.attempts + 1 >= HOST_CODE_TRIES ? 'too_many' : 'wrong_code' };
  }

  // The claim: one session per code, even when two taps race.
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from(CODES)
    .update({ used_at: now.toISOString() })
    .eq('id', row.id)
    .is('used_at', null)
    .lt('attempts', HOST_CODE_TRIES)
    .select('id')
    .maybeSingle();
  if (claimErr) throw new Error(`host code claim failed: ${claimErr.message}`);
  if (!claimed) return { ok: false, reason: 'expired' };

  // A host taken off their home since the code went out gets no session.
  if (homesForHost(email, await partnerHomes()).length === 0) return { ok: false, reason: 'expired' };

  const token = makeHostSessionToken();
  const expires = new Date(now.getTime() + HOST_SESSION_DAYS * 86_400_000).toISOString();
  const { error: insErr } = await supabaseAdmin.from(SESSIONS).insert({
    token_hash: hostSessionHash(token),
    email,
    created_at: now.toISOString(),
    expires_at: expires,
    last_seen_at: now.toISOString(),
  });
  if (insErr) throw new Error(`host session insert failed: ${insErr.message}`);
  return { ok: true, token, expires_at: expires };
}

export type HostSession = { email: string; hostName: string | null; homes: HostHome[] };

export async function hostForSession(rawToken: unknown, now: Date = new Date()): Promise<HostSession | null> {
  const token = parseHostSessionToken(rawToken);
  if (!token || !isServiceConfigured) return null;
  const hash = hostSessionHash(token);
  const { data, error } = await supabaseAdmin
    .from(SESSIONS)
    .select('email, expires_at, ended_at, last_seen_at')
    .eq('token_hash', hash)
    .maybeSingle();
  if (error) throw new Error(`host session read failed: ${error.message}`);
  const row = data as { email: string; expires_at: string; ended_at: string | null; last_seen_at: string | null } | null;
  if (!row || row.ended_at || Date.parse(row.expires_at) <= now.getTime()) return null;

  const homes = homesForHost(row.email, await partnerHomes());
  if (homes.length === 0) return null;

  if (!row.last_seen_at || now.getTime() - Date.parse(row.last_seen_at) > 3600_000) {
    await supabaseAdmin.from(SESSIONS).update({ last_seen_at: now.toISOString() }).eq('token_hash', hash);
  }
  const named = homes.find((h) => h.owner_full && h.owner_full.trim());
  return { email: row.email, hostName: named?.owner_full?.trim() ?? null, homes: homes.map(asHostHome) };
}

export async function endHostSession(rawToken: unknown, now: Date = new Date()): Promise<void> {
  const token = parseHostSessionToken(rawToken);
  if (!token || !isServiceConfigured) return;
  await supabaseAdmin.from(SESSIONS).update({ ended_at: now.toISOString() }).eq('token_hash', hostSessionHash(token)).is('ended_at', null);
}

export async function listHostRequests(session: HostSession, now: Date = new Date()): Promise<HostRequestView[]> {
  const ids = session.homes.map((h) => h.id);
  if (ids.length === 0) return [];
  const since = new Date(now.getTime() - HOST_HISTORY_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('booking_requests')
    .select(BOOKING_REQUEST_COLS)
    .in('property_id', ids)
    .or(`status.eq.pending,created_at.gte.${since}`)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(`host requests read failed: ${error.message}`);
  const titles = new Map(session.homes.map((h) => [h.id, h.title]));
  const rows = (data ?? []) as BookingRequestRow[];
  const counts = await threadCountsFor(
    rows.map((r) => r.id),
    'host',
  );
  return sortHostRequests(rows.map((r) => ({ ...hostRequestView(r, titles.get(r.property_id) ?? null, now), ...counts.get(r.id) })));
}

export type HostDecision = 'accept' | 'decline';
export type HostDecideResult = { ok: true; request: HostRequestView } | { ok: false; reason: string; notFound?: boolean };

export async function hostDecide(
  session: HostSession,
  rawId: unknown,
  decision: HostDecision,
  reason: string,
  now: Date = new Date(),
): Promise<HostDecideResult> {
  const id = typeof rawId === 'string' && UUID.test(rawId) ? rawId : null;
  if (!id) return { ok: false, reason: 'No such request.', notFound: true };
  const { data, error } = await supabaseAdmin.from('booking_requests').select('property_id, hold_status').eq('id', id).maybeSingle();
  if (error) throw new Error(`host request read failed: ${error.message}`);
  const found = data as { property_id: string; hold_status: string } | null;
  const home = session.homes.find((h) => h.id === found?.property_id);
  if (!home) return { ok: false, reason: 'No such request.', notFound: true };
  // A host books only over a card on hold. Without one nobody has paid, so
  // the office settles it with them (its own Accept has no such rule).
  if (decision === 'accept' && found?.hold_status !== 'held') return { ok: false, reason: HOST_NO_HOLD };

  const by = hostActor(session.email);
  const r = decision === 'accept' ? await acceptBookingRequest(id, by, now) : await declineBookingRequest(id, by, reason, now);
  if (!r.ok) return { ok: false, reason: r.reason };
  return { ok: true, request: hostRequestView(r.row, home.title, now) };
}

// ── The host's calendar ─────────────────────────────────────────────────────

export type HostCalendarHome = {
  id: string;
  title: string;
  /** On staycapeann.com right now. */
  listed: boolean;
  /** The host's own calendars Helm reads, with when each was last read. Never the link itself. */
  feeds: HostFeedView[];
  spans: HostCalendarSpan[];
  /** Stays booked here that have not checked out, soonest first. */
  stays: HostRequestView[];
};

/**
 * Each of the host's homes: its nights for this month and the next eleven
 * (booked here, waiting on them, held on their own calendars) and the stays
 * still to come. Throws on a failed read: a calendar that cannot see a stay
 * must not show the night open.
 */
export async function hostCalendar(session: HostSession, now: Date = new Date()): Promise<{ today: string; from: string; to: string; homes: HostCalendarHome[] }> {
  const window = hostCalendarWindow(now);
  const ids = session.homes.map((h) => h.id);
  if (ids.length === 0) return { ...window, homes: [] };

  const [requests, feeds, holds, listed] = await Promise.all([
    selectAllPaged<BookingRequestRow>(
      (from, to) =>
        supabaseAdmin
          .from('booking_requests')
          .select(BOOKING_REQUEST_COLS)
          .in('property_id', ids)
          .in('status', ['accepted', 'pending'])
          .gt('check_out', window.from)
          .lt('check_in', window.to)
          .order('check_in', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'host calendar requests' },
    ),
    selectAllPaged<{ id: string; property_id: string; channel: PartnerFeedChannel; last_synced_at: string | null }>(
      (from, to) =>
        supabaseAdmin
          .from('partner_calendar_feeds')
          .select('id, property_id, channel, last_synced_at')
          .in('property_id', ids)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'host calendar feeds' },
    ),
    selectAllPaged<{ feed_id: string; property_id: string; kind: 'stay' | 'block'; check_in: string; check_out: string }>(
      (from, to) =>
        supabaseAdmin
          .from('partner_calendar_holds')
          .select('feed_id, property_id, kind, check_in, check_out, id')
          .in('property_id', ids)
          .gt('check_out', window.from)
          .lt('check_in', window.to)
          .order('check_in', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'host calendar holds' },
    ),
    listedPartners(),
  ]);

  const channelOf = new Map(feeds.map((f) => [f.id, f.channel]));
  return {
    ...window,
    homes: session.homes.map((home) => {
      const mine = requests.filter((r) => r.property_id === home.id);
      return {
        id: home.id,
        title: home.title,
        listed: listed.has(home.id),
        feeds: feeds.filter((f) => f.property_id === home.id).map((f) => hostFeedView(f, now)),
        spans: hostCalendarSpans(
          {
            requests: mine,
            holds: holds
              .filter((h) => h.property_id === home.id)
              .map((h) => ({ kind: h.kind, check_in: h.check_in, check_out: h.check_out, channel: channelOf.get(h.feed_id) ?? 'other' })),
            from: window.from,
            to: window.to,
          },
          now,
        ),
        stays: mine.filter((r) => r.status === 'accepted' && r.check_out > window.today).map((r) => hostRequestView(r, home.title, now)),
      };
    }),
  };
}

/**
 * The host's money: each home's Stripe standing as staycapeann.com last
 * reported it, and their booked stays, newest first, up to HOST_PAYOUT_STAYS.
 * Throws on a failed read; the bridge answers 503.
 */
export async function hostPayouts(session: HostSession, now: Date = new Date()): Promise<HostPayoutsView> {
  const ids = session.homes.map((h) => h.id);
  if (ids.length === 0) return hostPayoutsView([], new Map(), [], now);
  const [accountsRead, staysRead] = await Promise.all([
    supabaseAdmin.from('partner_payment_accounts').select(PARTNER_PAYMENT_COLS).in('property_id', ids),
    supabaseAdmin
      .from('booking_requests')
      .select(BOOKING_REQUEST_COLS)
      .in('property_id', ids)
      .eq('status', 'accepted')
      .order('check_in', { ascending: false })
      .order('id', { ascending: true })
      .limit(HOST_PAYOUT_STAYS),
  ]);
  if (accountsRead.error) throw new Error(`host payment accounts read failed: ${accountsRead.error.message}`);
  if (staysRead.error) throw new Error(`host stays read failed: ${staysRead.error.message}`);
  const accounts = new Map<string, PartnerPaymentAccount>();
  for (const raw of (accountsRead.data ?? []) as Array<Record<string, unknown>>) {
    const a = shapeAccount(raw);
    accounts.set(a.property_id, a);
  }
  return hostPayoutsView(session.homes, accounts, (staysRead.data ?? []) as BookingRequestRow[], now);
}

export type HostSetupLinkResult = { ok: true; token: string } | { ok: false; reason: string; notFound?: boolean };

/**
 * A fresh Stripe setup link for one of the host's homes, so they can start
 * or finish with Stripe without waiting on the office. The same writer the
 * office uses, recorded as the host; the home's earlier link stops working.
 */
export async function hostSetupLink(session: HostSession, rawPropertyId: unknown, now: Date = new Date()): Promise<HostSetupLinkResult> {
  const home = typeof rawPropertyId === 'string' ? session.homes.find((h) => h.id === rawPropertyId) : undefined;
  if (!home) return { ok: false, reason: 'That home is not one of yours.', notFound: true };
  const made = await makeSetupLink(home.id, hostActor(session.email), now);
  return made.ok ? { ok: true, token: made.token } : { ok: false, reason: made.reason };
}

/** Each of the host's homes: its plan's four host lines and its seasons from today on. */
export async function hostRates(session: HostSession, now: Date = new Date()): Promise<{ today: string; homes: HostRatesHome[] }> {
  const today = easternIsoDay(now);
  const until = shiftIsoDay(today, HOST_SEASON_WINDOW_DAYS);
  const homes = await Promise.all(
    session.homes.map(async (h) => {
      const [plan, days] = await Promise.all([getRatePlan(h.id), getRateDays(h.id, today, until)]);
      return hostRatesHome(h, plan, days, today);
    }),
  );
  return { today, homes };
}

export type HostRateWriteResult = { ok: true; message: string } | { ok: false; reason: string; notFound?: boolean };

function hostHomeOf(session: HostSession, rawPropertyId: unknown): HostHome | undefined {
  return typeof rawPropertyId === 'string' ? session.homes.find((h) => h.id === rawPropertyId) : undefined;
}

/** A failed mirror rebuild never undoes a saved price: the 30-minute calendar sync rebuilds it too. */
async function remirror(propertyId: string, from: string, to: string): Promise<void> {
  try {
    const r = await writeHelmCalendarMirror([propertyId], shiftIsoDay(from, -1), to);
    if (r.errors.length) console.error(`[host rates] mirror ${propertyId}: ${r.errors.join('; ')}`);
  } catch (e) {
    console.error(`[host rates] mirror ${propertyId}:`, e instanceof Error ? e.message : String(e));
  }
}

/** The nightly price, weekend price, minimum stay and cleaning fee on one of their homes. Nothing else on the plan moves. */
export async function hostSavePlan(session: HostSession, rawPropertyId: unknown, body: unknown, now: Date = new Date()): Promise<HostRateWriteResult> {
  const home = hostHomeOf(session, rawPropertyId);
  if (!home) return { ok: false, reason: 'That home is not one of yours.', notFound: true };
  const parsed = parseHostPlan(body);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  await upsertRatePlan(hostPlanPatch(home.id, parsed.value), hostActor(session.email));
  const today = easternIsoDay(now);
  await remirror(home.id, today, shiftIsoDay(today, HOST_SEASON_WINDOW_DAYS));
  return { ok: true, message: 'Your prices are saved.' };
}

/** A price and / or a minimum stay across dates on one of their homes, or those dates back to the plan. */
export async function hostSaveSeason(session: HostSession, rawPropertyId: unknown, body: unknown, now: Date = new Date()): Promise<HostRateWriteResult> {
  const home = hostHomeOf(session, rawPropertyId);
  if (!home) return { ok: false, reason: 'That home is not one of yours.', notFound: true };
  const parsed = parseHostSeason(body, easternIsoDay(now));
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const input = parsed.value;
  const existing = await getRateDays(home.id, input.from, input.to);
  const written = await setRateDays(hostSeasonRows(home.id, input, existing), hostActor(session.email));
  await remirror(home.id, input.from, input.to);
  const span = written === 1 ? '1 night' : `${written} nights`;
  return { ok: true, message: input.clear ? `${span} back to your usual prices.` : `${span} saved.` };
}
