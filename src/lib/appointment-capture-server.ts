import 'server-only';
import { randomUUID } from 'node:crypto';
import { supabaseAdmin as db } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';
import { existingGoogleAccess } from '@/lib/gmail-draft';
import { effectiveRole } from '@/lib/helm-access';
import { captureCalendar, captureGmail, CaptureAccessError } from '@/lib/appointment-capture-google';
import { captureCoverage, messageCapture, schedulingSignal, type Capture, type CaptureKind, type CaptureState } from '@/lib/appointment-capture';
import { validateAppointment, type SourceCoverage } from '@/lib/appointment-agenda';

/** Explicit rollout allowlist. Existing credentials alone never opt another
 * operator into copying their calendar/mail. No OAuth or settings writes here. */
export function enabledAgendaAccounts(): string[] {
  return [...new Set((process.env.AGENDA_CAPTURE_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).filter(x => /^[a-z0-9._+-]+@risingtidestr\.com$/.test(x)))];
}
export async function loadCaptures(email: string, now: Date, canReadQuo = false): Promise<{ captures: Capture[]; sources: SourceCoverage[]; available: boolean }> {
  const kinds: CaptureKind[] = ['calendar', 'gmail', 'quo'];
  try {
    const [records, states] = await Promise.all([
      selectAllPaged<Capture>((from, to) => db.from('agenda_capture').select('source_key,kind,revision,aliases,details,checked_at,changed_at').eq('user_email', email).order('source_key').range(from, to), { maxRows: 10000 }),
      selectAllPaged<CaptureState>((from, to) => db.from('agenda_capture_state').select('kind,state,detail,last_attempt_at,last_success_at').eq('user_email', email).order('kind').range(from, to)),
    ]);
    const valid = records.filter(r => validateAppointment(r.details).ok && Array.isArray(r.aliases) && /^[a-f0-9]{64}$/.test(r.revision));
    return { available: valid.length === records.length, captures: valid.filter(c => c.kind !== 'quo' || canReadQuo), sources: kinds.map(kind => {
      if (kind === 'quo' && !canReadQuo) return { name: 'Quo business texts', state: 'unavailable', detail: 'Business contact history capture is owner-only.' };
      const coverage = captureCoverage(kind, states.find(s => s.kind === kind), now);
      if (!enabledAgendaAccounts().includes(email)) return { ...coverage, state: 'not_connected', detail: `Ongoing capture is not enabled for your account. ${coverage.detail}` };
      if (valid.length !== records.length) return { ...coverage, state: 'partial', detail: `Some source records could not be read. ${coverage.detail}` };
      return coverage;
    }) };
  } catch {
    return { available: false, captures: [], sources: kinds.map(kind => ({ name: { calendar: 'Work Google Calendar', gmail: 'Work Gmail', quo: 'Quo business texts' }[kind], state: 'unavailable', detail: 'Source capture storage is unavailable. No live coverage is claimed.' })) };
  }
}

type Touch = { id: string; contact_id: string; touched_at: string; summary: string | null; notes: string | null; quo_message_id: string };
async function captureQuo(email: string, since: Date, now: Date): Promise<Capture[]> {
  // Cron has no browser session. The UI passes its effective permission
  // separately to loadCaptures; it never uses this background eligibility check.
  if (effectiveRole(email, null) !== 'owner') throw Error('Quo contact history is available only to owners; no staff capture.');
  const contacts = await selectAllPaged<{ id: string }>((from, to) => db.from('contacts').select('id').in('type', ['owner', 'vendor', 'prospect']).order('id').range(from, to));
  const allowed = new Set(contacts.map(c => c.id));
  // Reuses authenticated API/signed-webhook contact history. Does not read
  // unsigned raw events, unknown numbers, guest line or private phone books.
  const touches = await selectAllPaged<Touch>((from, to) => db.from('contact_touches').select('id,contact_id,touched_at,summary,notes,quo_message_id')
    .eq('channel', 'sms').not('quo_message_id', 'is', null).gte('touched_at', since.toISOString()).order('touched_at').order('id').range(from, to), { maxRows: 10000 });
  const schedulingContacts = new Set(touches.filter(t => allowed.has(t.contact_id) && schedulingSignal(`${t.summary || ''} ${t.notes || ''}`)).map(t => t.contact_id));
  return touches.filter(t => allowed.has(t.contact_id) && schedulingContacts.has(t.contact_id)).map(t =>
    messageCapture('quo', `quo:${t.quo_message_id}`, [], `https://helm.risingtidestr.com/crm/${t.contact_id}`, [t.quo_message_id, t.touched_at, t.summary, t.notes], now));
}

export async function syncAppointmentSources(email: string, now = new Date()): Promise<{ state: string; sources?: Record<string, string> }> {
  if (!enabledAgendaAccounts().includes(email)) throw Error('Agenda account is not enabled.');
  const lease = randomUUID();
  const claimed = await db.rpc('claim_agenda_capture', { p_user_email: email, p_lease_id: lease });
  if (claimed.error) throw Error('Capture storage is unavailable.');
  if (!claimed.data) return { state: 'already_running' };
  const deadline = Date.now() + 220000;
  const budgetFetch: typeof fetch = async (input, init) => {
    const left = deadline - Date.now(); if (left < 1000) throw Error('Capture time budget reached; retry next run.');
    return fetch(input, { ...init, signal: AbortSignal.any([AbortSignal.timeout(left), ...(init?.signal ? [init.signal] : [])]) });
  };
  try {
    const [previous, links, saved] = await Promise.all([
      loadCaptures(email, now, effectiveRole(email, null) === 'owner'),
      selectAllPaged<{ source_key: string; appointment_id: string }>((from, to) => db.from('agenda_source_links').select('source_key,appointment_id').eq('user_email', email).order('source_key').range(from, to), { maxRows: 50000 }),
      selectAllPaged<{ id: string; details: { date?: string; status?: string } }>((from, to) => db.from('agenda_appointments').select('id,details').eq('user_email', email).order('id').range(from, to), { maxRows: 10000 }),
    ]);
    if (!previous.available) throw Error('Existing capture records could not be read completely.');
    const stateRows = await db.from('agenda_capture_state').select('*').eq('user_email', email);
    if (stateRows.error) throw Error('Capture state unavailable.');
    const states = (stateRows.data || []) as CaptureState[];
    // Tracked Calendar IDs include reviewed snapshots so moving an event out of
    // the display window cannot leave a ghost at the former time.
    const floor = new Date(now.getTime() - 60 * 86400000).toISOString();
    const active = new Set(saved.filter(s => s.details.status !== 'cancelled' && (!s.details.date || s.details.date >= floor.slice(0, 10))).map(s => s.id));
    const tracked = [...new Set([...previous.captures.filter(c => !c.changed_at || c.changed_at >= floor || (c.details.date && c.details.date >= floor.slice(0, 10))).map(c => c.source_key),
      ...links.filter(l => active.has(l.appointment_id)).map(l => l.source_key)])];
    let token: string | null = null;
    try { token = await existingGoogleAccess(email); } catch { /* recorded below, no token/error-body logging */ }
    const result: Record<string, string> = {};
    for (const kind of ['calendar', 'gmail', 'quo'] as const) {
      const old = states.find(s => s.kind === kind);
      let state: CaptureState['state'] = 'available', detail = '', records: Capture[] = [];
      try {
        const since = new Date(old?.last_success_at ? Math.min(Date.parse(old.last_success_at) - 86400000, now.getTime() - 30 * 86400000) : now.getTime() - 30 * 86400000);
        if (kind !== 'quo' && !token) { state = 'not_connected'; detail = 'No existing identity-verified Google credential is available for your account. Nothing was read.'; }
        else if (kind === 'calendar') {
          records = await captureCalendar(token!, email, tracked, now, budgetFetch);
          detail = 'Primary work calendar checked for the next 30 days, plus tracked events. Other calendars are not included. New events and changed details require review.';
        } else if (kind === 'gmail') {
          records = await captureGmail(token!, email, tracked, since, now, budgetFetch);
          detail = 'Scheduling keyword search in your work mailbox, including sent/read mail, with tracked conversations rechecked. Review required; this is not exhaustive mail understanding.';
        } else {
          records = await captureQuo(email, since, now);
          detail = 'Known owner/vendor/prospect text history checked for scheduling conversations and replies. Depends on Helm Quo ingest; unknown numbers, calls and unsynced messages are not covered.';
          const upstream = await db.from('sync_status').select('last_synced_at,last_status').eq('source', 'quo').maybeSingle();
          if (upstream.error || !upstream.data?.last_synced_at || upstream.data.last_status !== 'ok' || now.getTime() - Date.parse(upstream.data.last_synced_at) > 8 * 3600000) {
            state = 'partial'; detail += ' The upstream Quo sync is stale, failing or unverified; captured history may be incomplete.';
          } else detail += ` Upstream Quo sync last succeeded ${upstream.data.last_synced_at}.`;
        }
      } catch (error) {
        state = error instanceof CaptureAccessError && [401, 403].includes(error.status) ? 'not_connected' : 'unavailable';
        detail = state === 'not_connected' ? `${kind === 'calendar' ? 'Calendar' : 'Gmail'} read access was refused. Existing authorization may lack the required read scope; no new permissions were requested.` : 'The source check did not finish. Previously captured records are retained; check the source directly.';
      }
      if (records.some(r => !validateAppointment(r.details).ok)) { records = []; state = 'unavailable'; detail = 'Provider records failed validation. Previously captured records are retained.'; }
      const written = await db.rpc('record_agenda_capture', { p_user_email: email, p_lease_id: lease, p_kind: kind, p_records: records,
        p_state: { state, detail, last_success_at: state === 'available' ? now.toISOString() : old?.last_success_at || null } });
      if (written.error) throw Error('Capture result could not be saved; no successful check claimed.');
      result[kind] = state;
    }
    return { state: 'checked', sources: result };
  } finally { await db.from('agenda_capture_lease').delete().eq('user_email', email).eq('lease_id', lease); }
}
