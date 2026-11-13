import 'server-only';
import { retainedPilotConfiguration } from './runtime-config.ts';
import { cleanerRuntimeConfiguration } from './cleaner-runtime-config.ts';
import { createChannexJobStore, type MessageRpc } from './store.ts';
import { createCleanerSmsStore } from './cleaner-sms-store.ts';
import { parseScheduleLedger, type ScheduleLedgerRow } from './schedule-plan.ts';
import { parseCleanerSmsJob } from './cleaner-sms-worker.ts';

export const AUTOMATION_HISTORY_LIMIT = 100;
export type AutomationLane = { state: 'off' | 'configured' | 'receipts_only' | 'invalid'; stays: number | null };
export type AutomationOperationRow = {
  id: string; bookingId: string; key: string | null; audience: 'guest' | 'cleaner' | 'unknown';
  start: string; end: string; fireAt: string; state: string; note: string;
  category: 'attention' | 'waiting' | 'recorded' | 'stopped';
};
export type AutomationOperations = {
  observedAt: string; history: 'available' | 'partial' | 'unavailable'; total: number | null;
  guest: AutomationLane; cleaner: AutomationLane; rows: AutomationOperationRow[];
};
type History = { data: unknown; total: number };
const cleanerKeys = new Set(['cleaner_reminder', 'cleaner_arrival']);
const guestKeys = new Set(['booking_confirmed', 'pre_arrival', 'checkin_day', 'pre_checkout']);

function configuration(env: Record<string, string | undefined>) {
  let guest: AutomationLane, cleaner: AutomationLane;
  try {
    const value = retainedPilotConfiguration(env);
    guest = value ? { state: 'configured', stays: value.stays.length } : { state: 'off', stays: null };
  } catch { guest = { state: 'invalid', stays: null }; }
  try {
    const value = cleanerRuntimeConfiguration(env);
    cleaner = value ? { state: value.mode === 'receipts-only' ? 'receipts_only' : 'configured', stays: value.manifest.stays.length }
      : { state: 'off', stays: null };
  } catch { cleaner = { state: 'invalid', stays: null }; }
  // Never return the manifest, credentials, receipt key, recipient or transport.
  return { guest, cleaner };
}
function rowBase(r: ScheduleLedgerRow): AutomationOperationRow {
  return { id: r.id, bookingId: r.booking_id, key: r.automation_key,
    audience: cleanerKeys.has(r.automation_key ?? '') ? 'cleaner' : guestKeys.has(r.automation_key ?? '') ? 'guest' : 'unknown',
    start: r.planned_check_in, end: r.planned_check_out, fireAt: r.fire_at,
    state: 'Delivery record unavailable', note: 'Review the original sender history before taking action.', category: 'attention' };
}
function prepared(r: ScheduleLedgerRow, now: number, expiry = Date.parse(r.fire_at) + 30 * 60_000) {
  if (r.status !== 'scheduled') return { state: 'Stopped or awaiting review', category: 'stopped' as const,
    note: 'The saved schedule is not active. Review the stay and its existing decisions.' };
  if (now >= expiry) return { state: 'Send window elapsed', category: 'attention' as const,
    note: 'The permitted send window has ended. Do not create a replacement to replay it.' };
  if (now >= Date.parse(r.fire_at)) return { state: 'Due · awaiting sender', category: 'attention' as const,
    note: 'No attempt is recorded yet. Check sender status, holds and the stay review.' };
  return { state: 'Scheduled', category: 'waiting' as const,
    note: 'Scheduled time only. The sender still rechecks holds, booking details and eligibility.' };
}
function historyRows(raw: History) {
  const rows = parseScheduleLedger(raw.data);
  if (!Number.isSafeInteger(raw.total) || raw.total < 0 || rows.length !== Math.min(raw.total, AUTOMATION_HISTORY_LIMIT)) throw Error();
  return rows;
}

/** Owner-only observation of existing canonical history and private receipts.
 * Reads continue while senders are OFF: turning a sender off must not hide a lost
 * response or accepted delivery. No manifests, bodies, contacts or provider IDs
 * enter this DTO. No provider call, claim, registration, hold or receipt write.
 * This is a bounded ledger view, never proof of source queue clearance or heartbeat.
 */
export async function readAutomationOperations(env: Record<string, string | undefined>, deps: {
  history: () => Promise<History>; rpc: MessageRpc; clock?: () => number;
}): Promise<AutomationOperations> {
  const clock = deps.clock ?? Date.now, now = clock();
  const report: AutomationOperations = { ...configuration(env), observedAt: new Date(now).toISOString(),
    history: 'unavailable', total: null, rows: [] };
  try {
    const fresh = () => { const at = clock(); if (!Number.isSafeInteger(at) || at < now || at - now > 25_000) throw Error(); };
    const before = await deps.history(), rows = historyRows(before);
    fresh();
    report.total = before.total;
    const guest = createChannexJobStore(deps.rpc), cleaner = createCleanerSmsStore(deps.rpc, { enabled: true });
    // Small batches keep an unusually large history from flooding PostgREST.
    for (let offset = 0; offset < rows.length; offset += 4) {
      fresh();
      report.rows.push(...await Promise.all(rows.slice(offset, offset + 4).map(async r => {
        const row = rowBase(r);
        try {
          if (row.audience === 'unknown') return row;
          if (row.audience === 'cleaner') {
            const raw = await cleaner.read(r.id);
            if (!raw) return row;
            const job = parseCleanerSmsJob(raw);
            if (job.bookingId !== r.booking_id || job.automationId !== r.automation_id || job.key !== r.automation_key
              || Date.parse(job.fireAt) !== Date.parse(r.fire_at)) throw Error();
            if (job.state === 'prepared') return { ...row, ...prepared(r, now, Date.parse(job.expiresAt)) };
            if (job.state === 'delivered') return { ...row, state: 'SMS delivered', category: 'recorded' as const,
              note: 'The SMS provider returned a delivery receipt.' };
            if (job.state === 'undelivered') return { ...row, state: 'SMS not delivered', category: 'attention' as const,
              note: 'The provider reported non-delivery. Review the receipt before contacting the cleaner.' };
            if (job.state === 'accepted') return { ...row, state: 'SMS accepted · receipt pending', category: 'attention' as const,
              note: 'Provider acceptance is recorded; delivery is not confirmed. Keep receipt checks running.' };
            return { ...row, state: job.state === 'rejected' ? 'SMS rejected' : job.state === 'aborted' ? 'Attempt stopped' : 'SMS outcome uncertain',
              note: 'Review the existing attempt. No automatic resend is permitted.' };
          }
          const job = await guest.read(r.id);
          if (!job) return row;
          if (job.state === 'prepared') return { ...row, ...prepared(r, now) };
          if (job.state === 'recorded') return { ...row, state: 'Message found at provider', category: 'recorded' as const,
            note: 'Channex readback matched the message. This is not proof the guest received or read it.' };
          if (job.state === 'accepted') return { ...row, state: 'Message accepted · readback pending', category: 'attention' as const,
            note: 'Channex accepted the message; independent readback is still pending.' };
          return { ...row, state: job.state === 'rejected' ? 'Message rejected' : 'Message outcome uncertain',
            note: 'An attempt may have reached the provider. Do not resend until reconciled.' };
        } catch { return row; }
      })));
    }
    // Independent RPC reads are not one transaction. Detect canonical changes
    // during observation rather than presenting a mixed result as current.
    const after = await deps.history();
    fresh();
    if (after.total !== before.total || JSON.stringify(historyRows(after)) !== JSON.stringify(rows)) {
      report.rows = []; report.history = 'unavailable'; return report;
    }
    report.history = before.total > rows.length ? 'partial' : 'available';
    report.rows.sort((a, b) => Number(b.category === 'attention') - Number(a.category === 'attention')
      || a.fireAt.localeCompare(b.fireAt) || a.id.localeCompare(b.id));
    return report;
  } catch { return { ...report, history: 'unavailable', rows: [] }; }
}
