'use client';

import type { HelmRole } from '@/lib/helm-access';
import { useHelmView } from './HelmViewContext';

/**
 * The signed-in role on the client, for the nav and other chrome that hides
 * owner-only modules from staff. The root layout resolves it on the server
 * (`sessionView()`, which honours View as staff) and hands it down through
 * Providers, so this resolves on the first render with no loading flash.
 * With no session at all (public pages) it reads as staff, which hides the
 * most and is the safe default.
 *
 * This is presentation only. The proxy and the server actions are the gate.
 */
export function useHelmRole(): HelmRole {
  return useHelmView().role;
}
