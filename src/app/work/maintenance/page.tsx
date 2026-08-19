import { HelmFooter } from '@/components/HelmFooter';
import type { RunsBoardData } from '@/lib/work-types';
import { loadMaintenanceRunsBoard } from '@/lib/maintenance-runs';
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
  const runsBoard = await loadMaintenanceRunsBoard().catch(
    (): RunsBoardData => ({ runs: [], vendorNeeded: [], backlog: [], unclassifiedCount: 0, roster: [] }),
  );

  return (
    <>
      <div style={{ flex: 1 }}>
        <RunsRail data={runsBoard} standalone />
      </div>

      <HelmFooter module="Maintenance Runs" right="Source: Helm" />
    </>
  );
}
