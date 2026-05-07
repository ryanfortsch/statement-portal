'use client';

/**
 * Sign-in indicator + sign-out button shown in HelmMasthead.
 *
 * Compact form: a single circular avatar with the user's first initial,
 * acts as the sign-out trigger. Hover/title surfaces the full username
 * for shared workstations.
 *
 * Reads the session via useSession() from next-auth/react (client-side)
 * so this component is safe to render anywhere — including inside a
 * 'use client' page tree like /statements. Previous server-component
 * version called auth() → headers(), which threw
 * "headers was called outside a request scope" when /statements
 * (a 'use client' page) pulled HelmMasthead → UserMenu in via the
 * 2026-05-06 masthead unification.
 *
 * Renders nothing while the session is loading or unauthenticated, so
 * the masthead on /auth/signin doesn't show a stray avatar.
 */

import { signOut, useSession } from 'next-auth/react';

export function UserMenu() {
  const { data: session, status } = useSession();
  if (status !== 'authenticated' || !session?.user?.email) return null;

  const username = session.user.email.split('@')[0];
  const initial =
    (session.user.name || username).trim().charAt(0).toUpperCase() || '?';

  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: '/auth/signin' })}
      title={`Sign out (${username})`}
      aria-label={`Sign out as ${username}`}
      style={{
        width: 28,
        height: 28,
        borderRadius: '50%',
        background: 'var(--paper-2)',
        border: '1px solid var(--rule)',
        color: 'var(--ink-2)',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        fontFamily: 'inherit',
      }}
    >
      {initial}
    </button>
  );
}
