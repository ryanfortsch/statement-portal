'use client';

import { useSession } from 'next-auth/react';
import { roleForEmail, type HelmRole } from '@/lib/helm-access';

/**
 * The signed-in role on the client, for the nav and other chrome that hides
 * owner-only modules from staff. The root layout hands the server session to
 * SessionProvider, so this resolves on the first render with no loading
 * flash. With no session at all (public pages) it reads as staff, which
 * hides the most and is the safe default.
 *
 * This is presentation only. The proxy and the server actions are the gate.
 */
export function useHelmRole(): HelmRole {
  const { data } = useSession();
  return roleForEmail(data?.user?.email);
}
