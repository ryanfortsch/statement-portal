import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';
import type { WorkSlipRow, TaskRow } from '@/lib/work-types';
import { ACTIVE_WORK_SLIP_STATUSES, ACTIVE_TASK_STATUSES } from '@/lib/work-types';
import { QueueClient } from './QueueClient';

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
  tasks: TaskRow[];
  properties: PropertyForPicker[];
  slipCommentCounts: Record<string, number>;
  taskCommentCounts: Record<string, number>;
}> {
  const [{ data: ws }, { data: tk }, { data: ps }, { data: slipComments }, { data: taskComments }] = await Promise.all([
    supabase
      .from('work_slips')
      .select('*')
      .in('status', ACTIVE_WORK_SLIP_STATUSES)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false }),
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

  return {
    workSlips: (ws ?? []) as WorkSlipRow[],
    tasks: (tk ?? []) as TaskRow[],
    properties: (ps ?? []) as PropertyForPicker[],
    slipCommentCounts,
    taskCommentCounts,
  };
}

export default async function WorkQueuePage() {
  const session = await auth();
  const { workSlips, tasks, properties, slipCommentCounts, taskCommentCounts } = await getData();
  const myEmail = session?.user?.email ?? '';

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="work" />

      <QueueClient
        workSlips={workSlips}
        tasks={tasks}
        properties={properties}
        myEmail={myEmail}
        slipCommentCounts={slipCommentCounts}
        taskCommentCounts={taskCommentCounts}
      />

      <HelmFooter module="Work Queue" right="Source: Helm" />
    </div>
  );
}
