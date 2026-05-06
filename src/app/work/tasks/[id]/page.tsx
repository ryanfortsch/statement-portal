import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { supabase } from '@/lib/supabase';
import type { TaskRow, TaskCommentRow } from '@/lib/work-types';
import { TaskDetail } from './TaskDetail';

export const dynamic = 'force-dynamic';

type PropertyForPicker = { id: string; name: string; title: string | null; city: string; is_active: boolean };

async function getData(id: string): Promise<{
  task: TaskRow;
  comments: TaskCommentRow[];
  properties: PropertyForPicker[];
} | null> {
  const { data: task } = await supabase.from('tasks').select('*').eq('id', id).maybeSingle();
  if (!task) return null;

  const [{ data: comments }, { data: properties }] = await Promise.all([
    supabase
      .from('task_comments')
      .select('*')
      .eq('task_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('properties')
      .select('id, name, title, city, is_active')
      .order('name'),
  ]);

  return {
    task: task as TaskRow,
    comments: (comments ?? []) as TaskCommentRow[],
    properties: (properties ?? []) as PropertyForPicker[],
  };
}

type Params = { id: string };

export default async function WorkTaskDetailPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const data = await getData(id);
  if (!data) notFound();

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="work" />
      <TaskDetail task={data.task} comments={data.comments} properties={data.properties} />
      <HelmFooter module="Task" right="Source: Helm" />
    </div>
  );
}
