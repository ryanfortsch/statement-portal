'use client';

/**
 * Silent background trigger that archives the submitted onboarding
 * intake to Drive when the owner lands on the thank-you page.
 *
 * Owner-facing, so unlike the inspection summary trigger this renders
 * NOTHING — the archive is an internal record-keeping step the owner
 * shouldn't see. Fires once on mount; the server route is idempotent
 * (returns the existing url if already archived) so a refresh re-firing
 * is harmless. The request is dispatched immediately on mount, so even
 * if the owner closes the tab the server still completes the archive.
 */

import { useEffect } from 'react';

export function ArchiveOnboardingTrigger({
  projectionId,
  alreadyArchived,
}: {
  projectionId: string;
  alreadyArchived: boolean;
}) {
  useEffect(() => {
    if (alreadyArchived) return;
    fetch('/api/archive-onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectionId }),
      keepalive: true, // let the request finish even if the tab closes
    }).catch(() => {
      // Best-effort; a staff-side backfill can re-fire the idempotent route.
    });
  }, [projectionId, alreadyArchived]);

  return null;
}
