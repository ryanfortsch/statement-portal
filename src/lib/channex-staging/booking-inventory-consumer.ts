/** Canonical booking capture -> existing inventory planner. No provider IO.
 * Completeness is explicit, never inferred from an empty bookings query.
 */
import { z } from 'zod';
import { buildAvailability } from '../availability.ts';
import type { RatePlanRow, RateDayRow } from '../rate-plan.ts';
import { zonedTimeToMs } from '../rate-plan.ts';
import { shiftIsoDay, todayInEastern } from '../sca-quotes-types.ts';
import { nights } from './core.ts';
import { planInventory } from './inventory-planner.ts';
import { projectInventory, type InventorySnapshot } from './inventory-projection.ts';
import { replayInventoryJournal, type InventoryJournal, type InventoryJournalStore } from './inventory-journal.ts';
import type { DispatchContext, InventoryJob } from './inventory-outbox.ts';

const int = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positive = int.min(1);
const id = z.string().min(1).max(160);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const t = Date.parse(v);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}, 'Invalid date');
const ruleSchema = z.object({
  advance_notice_hours: int.max(8760), booking_window_days: int.max(3660),
  turnover_buffer_days: int.max(30), checkin_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
}).strict();
const inputsSchema = z.object({
  authority: z.enum(['helm', 'guesty']), plan: ruleSchema.nullable(),
  bookings: z.array(z.object({ id, status: z.enum(['inquiry', 'pending', 'confirmed', 'cancelled', 'completed', 'block']),
    check_in: date, check_out: date, duplicate_of: id.nullable(), hold_kind: z.string().nullable(),
    source: z.string(), channel: z.string(),
  }).strict()).max(5000),
  rateDays: z.array(z.object({ date, closed: z.boolean() }).strict()).max(366),
  periods: z.array(z.object({ startMonth: int.min(1).max(12), startDay: int.min(1).max(31),
    endMonth: int.min(1).max(12), endDay: int.min(1).max(31) }).strict()).max(1000),
}).strict();
const stateSchema = z.object({
  property: id, captureEnabled: z.boolean(), captureVersion: int,
  configurationVersion: positive,
  configuration: z.object({ environment: z.literal('staging'), topology: z.literal('single-unit'),
    connection: id, listing: id, generation: positive, publishEnabled: z.boolean(),
    timeZone: z.literal('America/New_York'), start: date, end: date,
    requiredSources: z.array(id).min(1).max(20),
    coverage: z.array(z.object({ source: id, start: date, end: date, complete: z.boolean(),
      observedAt: int, freshUntil: int }).strict()).max(20),
  }).strict(),
  plannedCaptureVersion: int, plannedConfigurationVersion: int, planVersion: int,
  journalVersion: int.max(10000), journal: z.unknown(), lastDigest: z.string().nullable(),
  plannedFreshUntil: int, inputsMatchPlan: z.boolean(), inputs: inputsSchema,
}).strict();
export type BookingInventoryState = z.infer<typeof stateSchema>;
export type BookingInventoryExpectation = {
  captureVersion: number; configurationVersion: number; planVersion: number; journalVersion: number;
  inputs: BookingInventoryState['inputs'];
};
export interface BookingInventoryConsumerStore {
  property: string;
  read(): Promise<unknown>;
  commit(expected: BookingInventoryExpectation, journal: InventoryJournal, freshUntil: number, digest: string): Promise<boolean>;
  journal: InventoryJournalStore;
}

export function parseBookingInventoryState(raw: unknown, property: string): BookingInventoryState {
  const state = stateSchema.parse(raw);
  if (state.property !== property) throw new Error('Inventory property mismatch');
  nights(state.configuration.start, state.configuration.end);
  if (state.plannedCaptureVersion > state.captureVersion || state.plannedConfigurationVersion > state.configurationVersion) {
    throw new Error('Inventory checkpoint is ahead of source');
  }
  const { journal } = replayInventoryJournal(state.journal);
  if (journal.commands.length !== state.journalVersion) throw new Error('Inventory journal version mismatch');
  return state;
}

/** Supply only inert price fields to the existing availability engine. Neither
 * those values nor PriceLabs fields are read from the database or emitted.
 * This avoids reimplementing its stay/duplicate/OTA/buffer/notice/season rules.
 */
function availabilityPlan(property: string, rules: z.infer<typeof ruleSchema>): RatePlanRow {
  return { property_id: property, ...rules, currency: 'USD', base_nightly_cents: 0,
    weekend_nightly_cents: null, weekend_days: [], guests_included: 0,
    extra_guest_cents_per_night: 0, cleaning_fee_cents: 0, pet_fee_cents: null,
    security_deposit_cents: null, weekly_discount_pct: 0, monthly_discount_pct: 0,
    direct_markup_pct: 0, min_nights_default: 1, max_nights: null, checkout_time: '11:00',
    max_occupancy: null, pets_allowed: false, quiet_hours: null,
    cancellation_policy_key: 'custom', cancellation_terms: null, house_rules: null };
}

export function bookingInventorySnapshot(state: BookingInventoryState, now: number): InventorySnapshot | null {
  int.parse(now);
  const c = state.configuration, input = state.inputs, dates = nights(c.start, c.end);
  if (!state.captureEnabled || !input.plan || state.captureVersion === 0) return null;
  if (new Set(c.requiredSources).size !== c.requiredSources.length || new Set(c.coverage.map(v => v.source)).size !== c.coverage.length) {
    throw new Error('Duplicate coverage source');
  }
  if (c.coverage.some(v => !c.requiredSources.includes(v.source))) throw new Error('Unexpected coverage source');
  for (const v of c.coverage) {
    if (v.start >= v.end || Date.parse(v.end) - Date.parse(v.start) > 426 * 86400000) throw new Error('Invalid coverage window');
    if (v.observedAt > now || v.freshUntil <= v.observedAt || v.freshUntil - v.observedAt > 3600000) {
      throw new Error('Invalid coverage freshness');
    }
  }
  const required = c.requiredSources.map(source => c.coverage.find(v => v.source === source));
  const coveredStart = shiftIsoDay(c.start, -input.plan.turnover_buffer_days);
  const coveredEnd = shiftIsoDay(c.end, input.plan.turnover_buffer_days);
  if (required.some(v => !v || !v.complete || v.freshUntil <= now || v.start > coveredStart || v.end < coveredEnd)) return null;
  if (new Set(input.bookings.map(v => v.id)).size !== input.bookings.length ||
      new Set(input.rateDays.map(v => v.date)).size !== input.rateDays.length) throw new Error('Duplicate canonical input');
  for (const b of input.bookings) {
    if (b.check_in >= b.check_out || Date.parse(b.check_out) - Date.parse(b.check_in) > 3660 * 86400000) throw new Error('Invalid booking span');
  }
  if (input.rateDays.some(v => v.date < c.start || v.date >= c.end)) throw new Error('Rate day outside window');
  const days = buildAvailability({ bookings: input.bookings, plan: availabilityPlan(state.property, input.plan),
    rateDays: new Map(input.rateDays.map(d => [d.date, { property_id: state.property, ...d,
      nightly_cents: null, min_nights: null, cta: false, ctd: false, note: null, source: 'operator' } satisfies RateDayRow])),
    rentalPeriods: input.periods, start: c.start, end: shiftIsoDay(c.end, -1), now: new Date(now), timeZone: c.timeZone });
  // Notice boundaries and Eastern midnight can invalidate a plan without a write.
  const noticeBoundaries = dates.map(d => zonedTimeToMs(d, input.plan!.checkin_time, c.timeZone) - input.plan!.advance_notice_hours * 3600000 + 1).filter(t => t > now);
  const midnight = zonedTimeToMs(shiftIsoDay(todayInEastern(new Date(now)), 1), '00:00', c.timeZone);
  const freshUntil = Math.min(now + 60000, midnight, ...noticeBoundaries, ...required.map(v => v!.freshUntil));
  if (!Number.isSafeInteger(freshUntil) || freshUntil <= now) return null;
  if (state.planVersion === Number.MAX_SAFE_INTEGER) throw new Error('Inventory plan version exhausted');
  const snapshot: InventorySnapshot = {
    version: state.planVersion + 1, resources: [state.property], listings: [{ id: c.listing, resources: [state.property] }],
    requiredSources: c.requiredSources,
    coverage: required.map(v => ({ source: v!.source, resources: [state.property], start: c.start, end: c.end, complete: true, freshUntil })),
    bookings: [], holds: days.filter(d => !d.available).map(d => ({ id: `unavailable-${d.date}`, resources: [state.property], start: d.date, end: shiftIsoDay(d.date, 1) })),
  };
  return snapshot;
}

/** One bounded pass. A lost response is not retried blindly; reread durable state. */
export async function consumeBookingInventory(store: BookingInventoryConsumerStore, clock: () => number) {
  const state = parseBookingInventoryState(await store.read(), store.property);
  const snapshot = bookingInventorySnapshot(state, clock());
  if (!snapshot) return { status: 'blocked' as const };
  const c = state.configuration;
  const projection = projectInventory(snapshot, c.listing, c.start, c.end, clock());
  if (!projection.complete) return { status: 'blocked' as const };
  if (state.plannedCaptureVersion === state.captureVersion && state.plannedConfigurationVersion === state.configurationVersion &&
      state.inputsMatchPlan && state.lastDigest === projection.digest && state.plannedFreshUntil > clock()) return { status: 'unchanged' as const };
  return planInventory({
    read: async () => ({ snapshot, configurationVersion: state.configurationVersion, journalVersion: state.journalVersion,
      journal: state.journal, connection: c.connection, property: state.property, listing: c.listing, generation: c.generation }),
    commit: async (_expected, journal, freshUntil) => store.commit({ captureVersion: state.captureVersion,
      configurationVersion: state.configurationVersion, planVersion: state.planVersion, journalVersion: state.journalVersion,
      inputs: state.inputs }, journal, freshUntil, projection.digest),
  }, c.start, c.end, clock);
}

/** Reuses the existing submitting barrier. The SQL append rechecks source state
 * again atomically; this read alone cannot authorize provider IO.
 */
export async function bookingInventoryDispatchContext(store: BookingInventoryConsumerStore, job: InventoryJob, clock: () => number): Promise<DispatchContext> {
  const state = parseBookingInventoryState(await store.read(), store.property), c = state.configuration;
  const snapshot = bookingInventorySnapshot(state, clock());
  const projection = snapshot && projectInventory(snapshot, c.listing, c.start, c.end, clock());
  return { environment: 'staging', connection: c.connection, property: state.property, generation: c.generation,
    version: state.planVersion, digest: projection?.digest ?? '', authority: state.inputs.authority,
    enabled: c.publishEnabled && state.captureEnabled,
    complete: !!projection?.complete && state.inputsMatchPlan && state.plannedCaptureVersion === state.captureVersion &&
      state.plannedConfigurationVersion === state.configurationVersion && job.version === state.planVersion,
    freshUntil: Math.min(projection?.freshUntil ?? 0, state.plannedFreshUntil) };
}
