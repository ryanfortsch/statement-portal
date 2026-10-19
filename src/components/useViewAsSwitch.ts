'use client';

import { useState } from 'react';
import { backToOwnerView, viewAsStaff } from '@/app/view-as-actions';
import { ownerViewReturnPath } from '@/lib/helm-access';

/**
 * Flip View as staff (the user menu and the banner), then load the page
 * again from the server. A full load rather than a router refresh: the
 * proxy decides afresh (an owner page becomes /not-available in staff
 * view, exactly as it does for a staff login), the root layout resolves the
 * new role for the nav, and nothing rendered for the other role survives in
 * the client cache.
 *
 * The load happens even when the action fails (a tab left open on a page
 * the other role cannot reach can have its action post bounced), because
 * the server, not this tab, knows which way the switch points.
 */
export function useViewAsSwitch() {
  const [pending, setPending] = useState(false);

  async function flip(action: () => Promise<unknown>, target: string | null) {
    setPending(true);
    try {
      await action();
    } catch {
      // Reload anyway; see above.
    }
    if (!target || target === window.location.href) window.location.reload();
    else window.location.assign(target);
  }

  return {
    pending,
    toStaff: () => flip(viewAsStaff, null),
    toOwner: () => flip(backToOwnerView, ownerViewReturnPath(window.location.pathname, window.location.search, window.location.origin)),
  };
}
