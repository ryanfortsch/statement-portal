'use client';

/**
 * Client-side providers mounted in the root layout. Wraps next-auth's
 * SessionProvider so any client component (UserMenu, the future Quo
 * presence indicator, etc.) can read the session via useSession()
 * without forcing the parent page to be a server component.
 *
 * Why this matters: HelmMasthead is rendered both from server pages and
 * from one 'use client' page (/statements). Before this provider, the
 * UserMenu inside HelmMasthead called next-auth's server-only auth(),
 * which then called next/headers' headers(), which throws
 * "headers was called outside a request scope" when its render frame
 * is in a client tree. Switching UserMenu to useSession() removes that
 * server-only call from the masthead path entirely.
 */

import { SessionProvider } from 'next-auth/react';
import type { Session } from 'next-auth';

/**
 * The root layout hands in the server-side session so client chrome (the
 * nav's owner/staff filtering via useHelmRole, UserMenu) renders with the
 * real session on the first paint instead of a `loading` beat during
 * which the Money tab would blink in or out.
 */
export function Providers({ children, session }: { children: React.ReactNode; session?: Session | null }) {
  return <SessionProvider session={session}>{children}</SessionProvider>;
}
