import 'server-only';
import { auth } from '@/auth';
import { sessionView } from '@/lib/helm-access-server';
import { supabaseAdmin as db } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';
import { loadMeetingCardsResult } from '@/lib/meetings';
import { loadCaptures } from '@/lib/appointment-capture-server';
import { reconcileCaptures } from '@/lib/appointment-capture';
import { AGENDA_DAYS, agendaWindow, meetingToAgenda, mergeAgenda, validateAppointment, type AgendaData, type AgendaEntry, type SourceCoverage } from '@/lib/appointment-agenda';

export type SavedAppointment = { id: string; user_email: string; version: number; details: unknown; updated_at: string };
export function savedAppointment(row: SavedAppointment, sourceKeys: string[]): AgendaEntry | null {
  const checked = validateAppointment(row.details);
  if (!checked.ok) return null;
  return { ...checked.value, sourceKeys: [...new Set([...checked.value.sourceKeys, ...sourceKeys])], id: row.id,
    version: row.version, updatedAt: row.updated_at, href: `/appointments/${row.id}`, editable: true };
}

/** Every caller re-authenticates. No caller-controlled email/role and no global
 * cache of user data. View as staff cannot display an owner's saved agenda. */
export async function loadAppointmentAgenda(now = new Date()): Promise<AgendaData> {
  const [session, view] = await Promise.all([auth(), sessionView()]);
  const email = session?.user?.email?.trim().toLowerCase() ?? '';
  const window = agendaWindow(now);
  const result: AgendaData = { ...window, entries: [], sources: [], canSave: false };
  if (!email || !email.endsWith('@risingtidestr.com')) return result;
  const owner = view.role === 'owner';
  const [meetings, saved, captured] = await Promise.all([
    loadMeetingCardsResult(now, { days: AGENDA_DAYS, ...(owner ? {} : { createdBy: email }) }),
    !view.viewingAsStaff ? loadSaved(email) : Promise.resolve({ entries: [], source: {
      name: 'Saved appointments', state: 'unavailable', detail: 'Hidden while viewing as staff.',
    } as SourceCoverage, canSave: false }),
    !view.viewingAsStaff ? loadCaptures(email, now, owner) : Promise.resolve({ captures: [], sources: [] }),
  ]);
  result.entries = mergeAgenda(reconcileCaptures(saved.entries, captured.captures), meetings.cards.map(meetingToAgenda));
  result.canSave = saved.canSave;
  result.sources = [
    saved.source,
    { name: 'Helm contact meetings', state: meetings.available ? 'available' : 'unavailable',
      detail: meetings.available ? `${owner ? 'Business contact records' : 'Records you created'} read for the next ${AGENDA_DAYS} days. Attendance still needs review.` : 'Could not read contact meetings. The schedule may be missing appointments.' },
    ...captured.sources,
    { name: 'Personal calendars', state: 'not_connected', detail: 'Not included. Keep family and medical appointments in your private calendar.' },
  ];
  return result;
}
async function loadSaved(email: string) {
  try {
    // Read cancelled and out-of-window records too: their source aliases suppress
    // superseded legacy rows before the display window is applied.
    const [rows, links] = await Promise.all([
      selectAllPaged<SavedAppointment>((from, to) => db.from('agenda_appointments').select('id, user_email, version, details, updated_at').eq('user_email', email).order('id').range(from, to), { maxRows: 10000 }),
      selectAllPaged<{ appointment_id: string; source_key: string }>((from, to) => db.from('agenda_source_links').select('appointment_id, source_key').eq('user_email', email).order('source_key').range(from, to), { maxRows: 50000 }),
    ]);
    const entries = rows.map(r => savedAppointment(r, links.filter(l => l.appointment_id === r.id).map(l => l.source_key))).filter((e): e is AgendaEntry => !!e);
    return { entries, canSave: true, source: { name: 'Saved appointments', state: entries.length === rows.length ? 'available' : 'partial',
      detail: entries.length === rows.length ? 'Your reviewed business appointments. Visible only in your own agenda.' : 'Some saved records could not be read. Review the agenda before relying on it.' } as SourceCoverage };
  } catch {
    return { entries: [], canSave: false, source: { name: 'Saved appointments', state: 'unavailable',
      detail: 'Appointment storage is unavailable. Setup or repair is needed; existing contact records are still shown.' } as SourceCoverage };
  }
}
