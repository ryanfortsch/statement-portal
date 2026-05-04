import { HelmMasthead } from '@/components/HelmMasthead';
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
}> {
  const [{ data: ws }, { data: tk }, { data: ps }] = await Promise.all([
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
  ]);

  return {
    workSlips: (ws ?? []) as WorkSlipRow[],
    tasks: (tk ?? []) as TaskRow[],
    properties: (ps ?? []) as PropertyForPicker[],
  };
}

export default async function WorkQueuePage() {
  const session = await auth();
  const { workSlips, tasks, properties } = await getData();
  const myEmail = session?.user?.email ?? '';

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="work" />

      <QueueClient
        workSlips={workSlips}
        tasks={tasks}
        properties={properties}
        myEmail={myEmail}
      />

      <footer style={{ borderTop: '1px solid var(--ink)' }}>
        <div
          className="max-w-[1100px] mx-auto px-10 flex items-center justify-between"
          style={{
            padding: '14px 40px',
            fontSize: 10,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-4)',
          }}
        >
          <span>Rising Tide &middot; Work Queue</span>
          <span style={{ fontStyle: 'italic', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-3)', fontSize: 11 }}>
            Source: Helm
          </span>
        </div>
      </footer>
    </div>
  );
}
