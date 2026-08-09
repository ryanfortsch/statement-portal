import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { WorkTabs } from '@/components/WorkTabs';
import { auth } from '@/auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { fieldDb } from '@/lib/field-db';
import type { WorkSlipRow, TaskRow, RunsBoardData } from '@/lib/work-types';
import { ACTIVE_WORK_SLIP_STATUSES, ACTIVE_TASK_STATUSES } from '@/lib/work-types';
import { loadMaintenanceRunsBoard } from '@/lib/maintenance-runs';
import { QueueClient } from './QueueClient';
import { RunsRail } from './RunsRail';

export const dynamic = 'force-dynamic';

type PropertyForPicker = {
  id: string;
  name: string;
  title: string | null;
  city: string;
  is_active: boolean;
};

async function getData(): Promise<{
  workSlips: WorkSlipRow[];
  snoozedSlips: WorkSlipRow[];
  tasks: TaskRow[];
  properties: PropertyForPicker[];
  slipCommentCounts: Record<string, number>;
  taskCommentCounts: Record<string, number>;
  reporterNames: Record<string, string>;
  runsBoard: RunsBoardData;
}> {
  const todayIso = new Date().toISOString().slice(0, 10);
  // The runs rail degrades to empty rather than sinking the board when the
  // Field tables are mid-migration.
  const runsBoardPromise = loadMaintenanceRunsBoard().catch(
    (): RunsBoardData => ({ runs: [], vendorNeeded: [], backlog: [], unclassifiedCount: 0, roster: [] }),
  );
  const [{ data: ws }, { data: snz }, { data: tk }, { data: ps }, { data: slipComments }, { data: taskComments }] = await Promise.all([
    supabase
      .from('work_slips')
      .select('*')
      .in('status', ACTIVE_WORK_SLIP_STATUSES)
      .or(`snoozed_until.is.null,snoozed_until.lte.${todayIso}`)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false }),
    // Snoozed bucket — only future-snoozed slips, surfaced via the
    // "Snoozed" filter pill on the queue.
    supabase
      .from('work_slips')
      .select('*')
      .in('status', ACTIVE_WORK_SLIP_STATUSES)
      .gt('snoozed_until', todayIso)
      .order('snoozed_until', { ascending: true }),
    supabase
      .from('tasks')
      .select('*')
      .in('status', ACTIVE_TASK_STATUSES)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('properties')
      .select('id, name, title, city, is_active')
      .order('name'),
    // Comment-count rollups: pull just the foreign key, count on the
    // client. With ~12 properties and a small team there's no point
    // pushing a server-side aggregation. If volume grows we can swap
    // to a database view.
    supabase.from('work_slip_comments').select('work_slip_id'),
    supabase.from('task_comments').select('task_id'),
  ]);

  const slipCommentCounts: Record<string, number> = {};
  for (const row of (slipComments ?? []) as Array<{ work_slip_id: string }>) {
    slipCommentCounts[row.work_slip_id] = (slipCommentCounts[row.work_slip_id] ?? 0) + 1;
  }
  const taskCommentCounts: Record<string, number> = {};
  for (const row of (taskComments ?? []) as Array<{ task_id: string }>) {
    taskCommentCounts[row.task_id] = (taskCommentCounts[row.task_id] ?? 0) + 1;
  }

  // Resolve the names of field inspectors who reported slips post-visit, so the
  // board can say "flagged by Delaney". contractors is RLS-locked, so this reads
  // through the service-role field client, not the anon board client.
  const reporterNames: Record<string, string> = {};
  const reporterIds = [
    ...new Set(
      [...((ws ?? []) as WorkSlipRow[]), ...((snz ?? []) as WorkSlipRow[])]
        .map((s) => s.reported_by_contractor_id)
        .filter((id): id is string => !!id),
    ),
  ];
  if (reporterIds.length > 0) {
    const { data: reporters } = await fieldDb().from('contractors').select('id, full_name').in('id', reporterIds);
    for (const r of (reporters ?? []) as Array<{ id: string; full_name: string }>) {
      reporterNames[r.id] = r.full_name;
    }
  }

  return {
    workSlips: (ws ?? []) as WorkSlipRow[],
    snoozedSlips: (snz ?? []) as WorkSlipRow[],
    tasks: (tk ?? []) as TaskRow[],
    properties: (ps ?? []) as PropertyForPicker[],
    slipCommentCounts,
    taskCommentCounts,
    reporterNames,
    runsBoard: await runsBoardPromise,
  };
}

export default async function WorkQueuePage() {
  const session = await auth();
  const { workSlips, snoozedSlips, tasks, properties, slipCommentCounts, taskCommentCounts, reporterNames, runsBoard } = await getData();
  const myEmail = session?.user?.email ?? '';

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="work" />
      <WorkTabs current="work" />

      {/* Quiet utility shelf above the board (the guest-gear matrix lives on
          its own page so the board stays the board). */}
      <div className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
        <Link href="/work/gear" style={{ fontSize: 12, color: 'var(--tide-deep)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
          Guest gear grid →
        </Link>
      </div>

      <RunsRail data={runsBoard} />

      <QueueClient
        workSlips={workSlips}
        snoozedSlips={snoozedSlips}
        tasks={tasks}
        properties={properties}
        myEmail={myEmail}
        slipCommentCounts={slipCommentCounts}
        taskCommentCounts={taskCommentCounts}
        reporterNames={reporterNames}
      />

      <HelmFooter module="Work Queue" right="Source: Helm" />
    </div>
  );
}
