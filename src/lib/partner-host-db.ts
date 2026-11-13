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
 *
 * Helm keeps sha256 hashes of codes and tokens, never the values.
 */
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { acceptBookingRequest, declineBookingRequest } from '@/lib/booking-requests-db';
import { BOOKING_REQUEST_COLS, type BookingRequestRow } from '@/lib/booking-requests';
import { displayTitle } from '@/lib/sca-quotes-types';
import { sendHostCode } from '@/lib/partner-host-email';
import {
  HOST_CODE_MINUTES,
  HOST_CODE_TRIES,
  HOST_CODES_PER_HOUR,
  HOST_HISTORY_DAYS,
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
  return sortHostRequests(((data ?? []) as BookingRequestRow[]).map((r) => hostRequestView(r, titles.get(r.property_id) ?? null, now)));
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
  const { data, error } = await supabaseAdmin.from('booking_requests').select('property_id').eq('id', id).maybeSingle();
  if (error) throw new Error(`host request read failed: ${error.message}`);
  const home = session.homes.find((h) => h.id === (data as { property_id: string } | null)?.property_id);
  if (!home) return { ok: false, reason: 'No such request.', notFound: true };

  const by = hostActor(session.email);
  const r = decision === 'accept' ? await acceptBookingRequest(id, by, now) : await declineBookingRequest(id, by, reason, now);
  if (!r.ok) return { ok: false, reason: r.reason };
  return { ok: true, request: hostRequestView(r.row, home.title, now) };
}
