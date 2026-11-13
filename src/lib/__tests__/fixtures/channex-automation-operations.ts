import { readAutomationOperations } from '../../channex-messaging/operations.ts';
import type { ScheduleLedgerRow } from '../../channex-messaging/schedule-plan.ts';
import type { ChannexJob } from '../../channex-messaging/worker.ts';
import type { CleanerSmsJob } from '../../channex-messaging/cleaner-sms-worker.ts';
import type { MessageRpc } from '../../channex-messaging/store.ts';
const id = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export function operationsFixture() {
  const now = '2026-11-13T20:00:00.000Z';
  const rows: ScheduleLedgerRow[] = [0, 1].map(i => ({ id: id(i + 1), booking_id: id(3), property_id: '65_calderwood',
    automation_id: id(i + 4), automation_key: i ? 'cleaner_reminder' : 'pre_arrival', fire_at: now, status: 'scheduled',
    planned_check_in: '2026-11-24', planned_check_out: '2026-11-28', sent_at: null, provider_message_id: null }));
  const guest: { -readonly [K in keyof ChannexJob]: ChannexJob[K] } = { sendId: id(1), environment: 'production', propertyId: '320c5cb5-91e0-46af-b9b3-a3fc20b4631e',
    channelId: id(6), provider: 'Airbnb', bookingId: id(7), threadId: id(8), bodySha256: 'b'.repeat(64),
    contextRevision: 'c'.repeat(32), state: 'accepted', attemptId: id(9), providerMessageId: id(10) };
  const cleaner: { -readonly [K in keyof CleanerSmsJob]: CleanerSmsJob[K] } = { sendId: id(2), bookingId: id(3), automationId: id(5),
    releaseId: id(11), propertyId: '65_calderwood', key: 'cleaner_reminder', keyId: 'synthetic-key-version', contextRevision: 'd'.repeat(32),
    recipientHmac: 'e'.repeat(64), targetHmac: 'f'.repeat(64), bodySha256: 'a'.repeat(64), fireAt: now,
    expiresAt: '2026-11-13T20:30:00.000Z', state: 'accepted', attemptId: id(12), providerMessageId: 'AC' + 'a'.repeat(32),
    providerStatus: 'queued', providerUpdatedAt: null };
  const calls: string[] = [];
  const rpc: MessageRpc = async (name, args) => { calls.push(name);
    if (name === 'helm_channex_message_read' && args.p_send_id === id(1)) return { data: guest, error: null };
    if (name === 'helm_channex_cleaner_read' && args.p_send_id === id(2)) return { data: cleaner, error: null };
    throw Error('Unexpected RPC'); };
  return { now, rows, guest, cleaner, calls, deps: { clock: () => Date.parse(now), rpc,
    history: async (): Promise<{data: unknown; total: number}> => ({ data: rows, total: rows.length }) } };
}
export async function syntheticAutomationOperations() { const f = operationsFixture(); return readAutomationOperations({}, f.deps); }
