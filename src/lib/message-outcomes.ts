/** Stable IDs only: matching a home or a recipient never proves a link. */
export type FollowupNote = {
  id: string; audience: 'guest' | 'owner' | 'cleaner' | 'contractor'; recipient: string;
  status: string; body: string; error: string; resolved_at?: string; send_at?: string;
};
export type WorkReference = { request_key: string; id: string; title: string; state: string; error: string };
export type FollowupReferences = { work: WorkReference[]; notes: FollowupNote[]; error: string };
export type WorkOutcome = { id: string; title: string; status: string; assignee: string; scheduledDate: string; completedAt: string; error: string; visits?: FieldVisit[] };
export type MessageOutcomes = { work: WorkOutcome[]; notes: FollowupNote[]; error: string };
export type MessageOutcomeCarrier = { followup_refs?: FollowupReferences; outcomes?: MessageOutcomes };
export type OutcomeSource = MessageOutcomeCarrier & {
  id: string; channel?: string; external_message_id?: string;
  maintenance_work?: { status: string; slip_id: string; title: string; error: string } | null;
};
export type WorkRow = {
  id: string; title: string; status: string; assigned_to_type: string;
  assigned_to_label: string | null; assigned_to_email: string | null;
  scheduled_date: string | null; completed_at: string | null;
  from_guest_request_key: string | null; from_quo_message_id: string | null; from_gmail_message_id: string | null;
};
export const WORK_COLUMNS = 'id,title,status,assigned_to_type,assigned_to_label,assigned_to_email,scheduled_date,completed_at,from_guest_request_key,from_quo_message_id,from_gmail_message_id';
export function workKeys(sources: OutcomeSource[]) {
  const ids = new Set<string>(), requests = new Set<string>(), quo = new Set<string>(), gmail = new Set<string>();
  for (const s of sources) {
    for (const w of s.followup_refs?.work ?? []) { if (w.id) ids.add(w.id); if (w.request_key) requests.add(w.request_key); }
    if (s.maintenance_work?.slip_id) ids.add(s.maintenance_work.slip_id);
    if (s.external_message_id) {
      if (s.channel === 'sms_quo') quo.add(s.external_message_id);
      if (s.channel === 'email_gmail') gmail.add(s.external_message_id);
    }
  }
  return { id: [...ids], from_guest_request_key: [...requests], from_quo_message_id: [...quo], from_gmail_message_id: [...gmail] };
}
export function assembleOutcomes(source: OutcomeSource, rows: WorkRow[], failed = false): MessageOutcomes {
  const keys = workKeys([source]);
  const linked = rows.filter(r => (Object.keys(keys) as (keyof typeof keys)[]).some(k => !!r[k] && keys[k].includes(r[k]!)));
  const work: WorkOutcome[] = [...new Map(linked.map(r => [r.id, r])).values()].map(r => ({
    id: r.id, title: r.title, status: r.status,
    assignee: r.assigned_to_label || r.assigned_to_email || (r.assigned_to_type === 'owner' ? 'Owner' : r.assigned_to_type === 'team' ? 'Team · person not specified' : 'Unassigned'),
    scheduledDate: r.scheduled_date || '', completedAt: r.completed_at || '', error: '',
  }));
  const refs = source.followup_refs?.work ?? (source.maintenance_work ? [{ id: source.maintenance_work.slip_id, title: source.maintenance_work.title, state: source.maintenance_work.status, error: source.maintenance_work.error, request_key: '' }] : []);
  for (const ref of refs) {
    if (linked.some(r => (ref.id && r.id === ref.id) || (ref.request_key && r.from_guest_request_key === ref.request_key))) continue;
    if (ref.state === 'lookup' && !failed) continue;
    work.push({ id: ref.id, title: ref.title || 'Property work', status: ref.id || failed ? 'unavailable' : ref.state,
      assignee: '', scheduledDate: '', completedAt: '', error: ref.error || (ref.id ? 'The current work slip could not be loaded.' : '') });
  }
  return { work, notes: source.followup_refs?.notes ?? [], error: failed ? 'Work status could not be refreshed.' : source.followup_refs?.error || '' };
}
export function workStatus(status: string, assignee: string): string {
  return ({open: assignee === 'Unassigned' ? 'Unassigned' : assignee === 'Field assignment unavailable' ? 'Open · assignment unavailable' : 'Assigned', in_progress: 'Underway', done: 'Completed', scheduled: 'Scheduled', blocked: 'Blocked', dismissed: 'Dismissed', skipped: 'Skipped', proposed: 'Proposed', pending: 'Creating work slip', detect: 'Checking work', authorized_detect: 'Checking work', unconfirmed: 'Creation unconfirmed', filed: 'Status unavailable', unavailable: 'Status unavailable'} as Record<string,string>)[status] || 'Status unknown';
}
export function noteStatus(note: FollowupNote): string {
  if (note.error) return 'Needs review';
  return ({approved: 'Sent', pending: 'Draft awaiting approval', proposed: 'Proposed', scheduled: 'Scheduled', sending: 'Sending', rejected: 'Skipped', skipped: 'Skipped', superseded: 'Replaced', manual_sent: 'Marked handled', failed: 'Failed', unavailable: 'Status unavailable'} as Record<string,string>)[note.status] || 'Status unknown';
}
export const NOTE_ROUTES = {guest: '/messaging', owner: '/owner-messaging', cleaner: '/cleaner-messaging', contractor: '/contractor-messaging'};

export type FieldVisit = { id:string; date:string; name:string; status:string };
export type FieldStop = { work_slip_id?:string; status:string; completed_at:string|null; inspection_packets: {id:string;status:string;visit_date:string;awarded_contractor_id:string|null} | null };
export function liveVisit(stop:FieldStop|null, completedAt:string|null, names:Map<string,string>):FieldVisit|null {
  const packet=stop?.inspection_packets;
  if (!stop || !packet || completedAt || stop.completed_at || !['pending','in_progress'].includes(stop.status) || !['draft','published','claimed','in_progress'].includes(packet.status)) return null;
  return {id:packet.id,date:packet.visit_date,name:packet.awarded_contractor_id ? names.get(packet.awarded_contractor_id) || 'Assigned contractor' : '',status:packet.status};
}
