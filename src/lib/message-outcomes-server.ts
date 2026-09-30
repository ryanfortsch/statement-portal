import { supabaseAdmin } from '@/lib/supabase-admin';
import { assembleOutcomes, workKeys, WORK_COLUMNS, type OutcomeSource, type WorkRow, type FieldStop, type FieldVisit, liveVisit } from './message-outcomes';

/** Batched, bounded reads of current work records; never blocks replying on failure. */
export async function enrichMessageOutcomes<T extends OutcomeSource>(sources: T[]): Promise<T[]> {
  const keys = workKeys(sources);
  const signal = AbortSignal.timeout(5000);
  const requests = Object.entries(keys).flatMap(([column, values]) => {
    const batches = [];
    for (let i = 0; i < values.length; i += 100) batches.push(values.slice(i, i + 100));
    return batches.map(async batch => {
      const { data, error } = await supabaseAdmin.from('work_slips').select(WORK_COLUMNS).in(column, batch).abortSignal(signal);
      if (error) throw error;
      return (data ?? []) as WorkRow[];
    });
  });
  const results = await Promise.allSettled(requests);
  const rows = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  const failed = results.some(r => r.status === 'rejected');
  const visits = new Map<string, FieldVisit[]>();
  let visitsFailed = false;
  const ids = [...new Set(rows.filter(r => ['open','in_progress','scheduled','blocked'].includes(r.status)).map(r => r.id))];
  if (ids.length) {
    try {
      const packet = 'id,status,visit_date,awarded_contractor_id';
      const [stops, attachments] = await Promise.all([
        supabaseAdmin.from('packet_stops').select(`work_slip_id,status,completed_at,inspection_packets(${packet})`).in('work_slip_id',ids).abortSignal(signal),
        supabaseAdmin.from('packet_stop_work_slips').select(`work_slip_id,completed_at,packet_stops(status,completed_at,inspection_packets(${packet}))`).in('work_slip_id',ids).abortSignal(signal),
      ]);
      if (stops.error || attachments.error) throw new Error('Field links unavailable');
      const candidates = [
        ...(stops.data ?? []).map(s => ({id:s.work_slip_id,stop:s as unknown as FieldStop,completedAt:null})),
        ...(attachments.data ?? []).map(a => ({id:a.work_slip_id,stop:a.packet_stops as unknown as FieldStop,completedAt:a.completed_at})),
      ];
      const contractorIds = [...new Set(candidates.map(c => c.stop?.inspection_packets?.awarded_contractor_id).filter((id):id is string => !!id))];
      const names = new Map<string,string>();
      if (contractorIds.length) {
        const {data,error} = await supabaseAdmin.from('contractors').select('id,full_name').in('id',contractorIds).abortSignal(signal);
        if (error) throw error;
        for (const c of data ?? []) names.set(c.id,c.full_name);
      }
      for (const c of candidates) {
        const visit = liveVisit(c.stop,c.completedAt,names);
        if (visit && !(visits.get(c.id) ?? []).some(v => v.id === visit.id)) visits.set(c.id,[...(visits.get(c.id) ?? []),visit]);
      }
    } catch { visitsFailed = true; }
  }
  return sources.map(s => {
    const outcomes = assembleOutcomes(s, rows, failed);
    for (const work of outcomes.work) {
      work.visits = visits.get(work.id) ?? [];
      const assigned = work.visits.filter(v => v.name);
      if (assigned.length && work.assignee === 'Unassigned') work.assignee = [...new Set(assigned.map(v => v.name))].join(', ');
      if (visitsFailed && ids.includes(work.id)) {
        if (work.assignee === 'Unassigned') work.assignee = 'Field assignment unavailable';
        work.error = 'Field assignment could not be checked. Open the work slip to review.';
      }
    }
    return {...s,outcomes};
  });
}
