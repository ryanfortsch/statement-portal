'use server';

import { cookies } from 'next/headers';
import { auth } from '@/auth';
import { roleForEmail, VIEW_AS_COOKIE, VIEW_AS_STAFF } from '@/lib/helm-access';

/**
 * The View as staff switch (the user menu and the banner under the
 * masthead). The one writer of VIEW_AS_COOKIE; `helm-access.test.ts` fails
 * if anything else sets it.
 *
 * Turning it on reads the LOGIN's role, never the effective one: only an
 * owner may flip it, and a staff login asking gets a refusal and no cookie
 * (the resolver would ignore the cookie anyway; this keeps it from being
 * written at all). httpOnly so no script reads it, SameSite=Lax, and no
 * expiry, so it ends with the browser session.
 *
 * Turning it off has no check on purpose: it can only hand an owner back
 * their own role, it must work from any page (/not-available included) so
 * an owner is never stuck, and for anyone else there is nothing to remove.
 */

export async function viewAsStaff(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (roleForEmail(session?.user?.email) !== 'owner') return { ok: false, error: 'Owners only' };
  (await cookies()).set(VIEW_AS_COOKIE, VIEW_AS_STAFF, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
  return { ok: true };
}

export async function backToOwnerView(): Promise<{ ok: true }> {
  (await cookies()).delete(VIEW_AS_COOKIE);
  return { ok: true };
}
