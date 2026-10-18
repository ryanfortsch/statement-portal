import { HelmFooter } from '@/components/HelmFooter';
import { auth } from '@/auth';
import type { RunsBoardData } from '@/lib/work-types';
import { loadMaintenanceRunsBoard } from '@/lib/maintenance-runs';
import { sessionMailbox } from '@/lib/gmail-draft';
import { RunsRail } from '../RunsRail';

export const dynamic = 'force-dynamic';

/**
 * Maintenance tab: the runs board on its own page. It started as a rail on
 * /work and immediately crowded the queue off the screen — six run cards
 * plus the vendor list is a page of its own, not a header. The Work board
 * stays the triage queue; this is where visits get planned, published, and
 * emailed out.
 */
export default async function MaintenancePage() {
  const session = await auth();
  const [runsBoard, mine] = await Promise.all([
    loadMaintenanceRunsBoard().catch(
      (): RunsBoardData => ({ runs: [], vendorNeeded: [], backlog: [], unclassifiedCount: 0, roster: [] }),
    ),
    // Whose Gmail a work order drafts in: the signed-in person's own, or
    // none (the composer then offers Copy).
    sessionMailbox(session?.user?.email).catch(() => null),
  ]);

  return (
    <>
      <div style={{ flex: 1 }}>
        <RunsRail data={runsBoard} standalone myMailbox={mine?.address ?? null} />
      </div>

      <HelmFooter module="Maintenance Runs" right="Source: Helm" />
    </>
  );
}
