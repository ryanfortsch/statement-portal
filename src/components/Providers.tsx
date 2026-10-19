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
import { ConfirmProvider } from '@/components/ConfirmDialog';
import { STAFF_VIEW, type HelmView } from '@/lib/helm-access';
import { HelmViewProvider } from './HelmViewContext';

/**
 * The root layout hands in the server-side session so client chrome (the
 * nav's owner/staff filtering via useHelmRole, UserMenu) renders with the
 * real session on the first paint instead of a `loading` beat during
 * which the Money tab would blink in or out.
 *
 * It hands in the resolved role too (`view`, from sessionView()), because
 * the role the chrome shows is the EFFECTIVE one: an owner in View as staff
 * sees the staff nav, and the switch's cookie is httpOnly, so the browser
 * could not work that out from the session alone.
 *
 * ConfirmProvider is the one confirm modal for the whole app: any client
 * component calls useConfirm() and gets it, in place of the browser's
 * confirm(), prompt() and alert().
 */
export function Providers({
  children,
  session,
  view,
}: {
  children: React.ReactNode;
  session?: Session | null;
  view?: HelmView;
}) {
  return (
    <SessionProvider session={session}>
      <HelmViewProvider view={view ?? STAFF_VIEW}>
        <ConfirmProvider>{children}</ConfirmProvider>
      </HelmViewProvider>
    </SessionProvider>
  );
}
