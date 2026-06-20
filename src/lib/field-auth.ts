/**
 * Contractor identity + session for the Field portal.
 *
 * Two credentials, both deliberately separate from Helm's Google SSO (which
 * hard-rejects any non-@risingtidestr.com email):
 *   1. portal_token — the persistent invite/login link (/field/<token>).
 *      Resolves to ONE contractor who can then see MANY packets.
 *   2. session cookie — set on first visit, so server actions (claim, the
 *      Stepper's per-card saves, completion) can resolve the acting
 *      contractor without the token on every request.
 *
 * Server-only. All reads go through the service-role client (field-db).
 */
import 'server-only';
import crypto from 'crypto';
import { cookies } from 'next/headers';
import { auth } from '@/auth';
import { fieldDb } from '@/lib/field-db';
import type { ContractorRow } from '@/lib/field-types';

const TOKEN_RE = /^[a-f0-9]{32}$/;
export const FIELD_SESSION_COOKIE = 'field_session';
const SESSION_TTL_DAYS = 90;

export function newPortalToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

/** Resolve a contractor from a /field/<token> link. Returns null for a bad
 *  token, an expired token, or an archived account. */
export async function resolveContractorByToken(token: string): Promise<ContractorRow | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { data } = await fieldDb()
    .from('contractors')
    .select('*')
    .eq('portal_token', token)
    .maybeSingle();
  const c = (data as ContractorRow | null) ?? null;
  if (!c) return null;
  if (c.status === 'archived') return null;
  if (c.token_expires_at && new Date(c.token_expires_at).getTime() < Date.now()) return null;
  return c;
}

/** Mint a session row + set the httpOnly cookie. Called when a contractor
 *  opens their portal link, so subsequent navigation/actions are cookie-authed
 *  and the bearer token can drop out of the URL. */
export async function startContractorSession(
  contractorId: string,
  ctx: { ip?: string | null; userAgent?: string | null } = {},
): Promise<void> {
  const sessionToken = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await fieldDb().from('contractor_sessions').insert({
    contractor_id: contractorId,
    session_token: sessionToken,
    expires_at: expiresAt.toISOString(),
    ip: ctx.ip ?? null,
    user_agent: ctx.userAgent ?? null,
  });
  await fieldDb().from('contractors').update({ last_seen_at: new Date().toISOString() }).eq('id', contractorId);
  const jar = await cookies();
  jar.set(FIELD_SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 86_400,
  });
}

/** Resolve the contractor from the session cookie, or null. */
export async function resolveContractorFromCookie(): Promise<ContractorRow | null> {
  const jar = await cookies();
  const sessionToken = jar.get(FIELD_SESSION_COOKIE)?.value;
  if (!sessionToken) return null;
  const { data: sess } = await fieldDb()
    .from('contractor_sessions')
    .select('contractor_id, expires_at')
    .eq('session_token', sessionToken)
    .maybeSingle();
  const s = sess as { contractor_id: string; expires_at: string } | null;
  if (!s) return null;
  if (new Date(s.expires_at).getTime() < Date.now()) return null;
  const { data } = await fieldDb().from('contractors').select('*').eq('id', s.contractor_id).maybeSingle();
  const c = (data as ContractorRow | null) ?? null;
  if (!c || c.status === 'archived') return null;
  return c;
}

export async function endContractorSession(): Promise<void> {
  const jar = await cookies();
  const sessionToken = jar.get(FIELD_SESSION_COOKIE)?.value;
  if (sessionToken) {
    await fieldDb().from('contractor_sessions').delete().eq('session_token', sessionToken);
    jar.delete(FIELD_SESSION_COOKIE);
  }
}

/**
 * Who is performing an inspection. The Stepper's server actions (saveResult,
 * completeInspection, addInspectionNote, createWorkSlipFromInspection) call
 * this instead of reading the Google session directly, so the SAME field flow
 * works for both internal staff and external contractors.
 */
export type InspectionActor =
  | { kind: 'staff'; email: string; name: string }
  | { kind: 'contractor'; email: string; name: string; contractorId: string };

export async function resolveInspectionActor(): Promise<InspectionActor | null> {
  const session = await auth();
  if (session?.user?.email) {
    const name =
      session.user.name?.trim() ||
      session.user.email.split('@')[0].replace(/^./, (c) => c.toUpperCase());
    return { kind: 'staff', email: session.user.email, name };
  }
  const contractor = await resolveContractorFromCookie();
  if (contractor) {
    return {
      kind: 'contractor',
      email: contractor.email,
      name: contractor.full_name,
      contractorId: contractor.id,
    };
  }
  return null;
}
