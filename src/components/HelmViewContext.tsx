'use client';

import { createContext, useContext } from 'react';
import { STAFF_VIEW, type HelmView } from '@/lib/helm-access';

/**
 * The role and the View as staff switch, resolved on the server by the root
 * layout (`sessionView()`) and handed down through Providers. The client
 * never reads the switch's cookie (it is httpOnly); it reads this.
 *
 * With no provider the view is staff with no switch, which hides the most.
 */
const HelmViewContext = createContext<HelmView>(STAFF_VIEW);

export function HelmViewProvider({ view, children }: { view: HelmView; children: React.ReactNode }) {
  return <HelmViewContext.Provider value={view}>{children}</HelmViewContext.Provider>;
}

export function useHelmView(): HelmView {
  return useContext(HelmViewContext);
}
