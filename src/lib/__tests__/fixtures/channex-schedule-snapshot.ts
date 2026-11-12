import { compileCalderwoodTemplates } from '../../channex-messaging/template-migration.ts';
import { parsePreparationRules } from '../../channex-messaging/preparation-rules.ts';
import type { ScheduleLedgerRow } from '../../channex-messaging/schedule-plan.ts';
import { syntheticCapture } from './channex-template-capture.ts';
import type { SourceTimingEvidence } from '../../channex-messaging/timing-evidence.ts';

export const scheduleFixtureId = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** Synthetic retained capture + synthetic active rules. This does not simulate
 * release approval or exercise a release RPC (none exists yet). Never use live data. */
export function syntheticScheduleSnapshot(now: number) {
  const capturedRules = parsePreparationRules(compileCalderwoodTemplates(syntheticCapture, now).map((r, i) => ({ ...r,
    id: scheduleFixtureId(i + 10), property_id: '65_calderwood', audience: r.key.startsWith('cleaner_') ? 'cleaner' : 'guest',
    trigger: r.key.startsWith('cleaner_') ? 'pre_arrival' : r.key, offset_days: 0, at_local: null,
    timezone: 'America/New_York', channel_exclusions: [], delivery: r.key.startsWith('cleaner_') ? 'sms' : 'ota_manual',
    send_mode: 'approve', min_nights: null, subject: null, enabled: false, configured_in_ota: true })));
  return {
    observedAt: new Date(now).toISOString(),
    booking: { id: scheduleFixtureId(1), propertyId: '65_calderwood', status: 'confirmed', duplicateOf: null as string | null,
      start: '2026-11-24', end: '2026-11-28' },
    clocks: { start: '2026-11-24', end: '2026-11-28', timezone: 'America/New_York', plannedArrival: null as string | null,
      plannedDeparture: null as string | null, defaultArrival: '16:00', defaultDeparture: '11:00',
      confirmedAt: new Date(now - 600_000).toISOString() as string | null },
    route: { remoteBookingId: scheduleFixtureId(5), threadId: scheduleFixtureId(6) },
    sourceIdentity: { guestyId: 'a'.repeat(24), code: 'SYNTHETIC-STAY', source: 'guesty_legacy' },
    timingEvidence: null as SourceTimingEvidence | null,
    capturedRules, currentRules: capturedRules.map(r => r.audience === 'guest'
      ? { ...r, enabled: true, configured_in_ota: false, send_mode: 'auto' as const, migration_policy: null } : { ...r }),
    ledger: [] as ScheduleLedgerRow[],
    merge: { guest_first: 'Synthetic Guest', door_code: 'SYNTHETIC-CODE', wifi_name: 'Synthetic Network',
      wifi_password: 'SYNTHETIC-PASSWORD', property_name: 'Synthetic Home' } as Record<string, string | null>,
  };
}

/** Synthetic evidence only. Production must read an existing reviewed binding,
 * never generate one from the current snapshot/context as this test helper does. */
export function syntheticTimingEvidence(s: ReturnType<typeof syntheticScheduleSnapshot>,
  context: Omit<SourceTimingEvidence['binding'], 'reviewedAt' | 'remoteBookingId' | 'threadId'>,
  now: number): SourceTimingEvidence {
  const { start, end, ...clocks } = s.clocks;
  return { kind: 'reviewed_guesty_capture', captureId: scheduleFixtureId(70),
    sourceContract: 'guesty_v2_clocks_v3_confirmed_at_double_read', checkedAt: new Date(now - 1000).toISOString(),
    row: { bookingId: s.booking.id, ...s.sourceIdentity, source: 'guesty_legacy', start, end, status: 'confirmed',
      clocks: { ...clocks, timezone: 'America/New_York', confirmedAt: clocks.confirmedAt! } },
    binding: { ...context, ...s.route, reviewedAt: new Date(now).toISOString() } };
}
