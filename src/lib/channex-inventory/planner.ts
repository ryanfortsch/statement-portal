/** Availability-only planning, adapted from the certified staging consumer.
 * No provider IO. A plan is not permission to publish or proof of OTA delivery. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { buildAvailability } from '../availability.ts';
import { zonedTimeToMs, type RatePlanRow, type RateDayRow } from '../rate-plan.ts';
import { shiftIsoDay, todayInEastern } from '../sca-quotes-types.ts';
import { nights } from '../channex-bookings/primitives.ts';
import { CALDERWOOD_PRODUCTION as mapping } from '../channex-production-preflight.ts';

export const INVENTORY_DAYS = 500;
export const INVENTORY_SOURCES = ['canonical-calendar', 'channex-bookings'] as const;
const int = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(160);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const t = Date.parse(v);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
});
const rules = z.object({ advance_notice_hours: int.max(8760), booking_window_days: z.literal(365),
  turnover_buffer_days: int.max(30), checkin_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
}).strict();
const stateSchema = z.object({
  propertyId: z.literal(mapping.helmPropertyId), remotePropertyId: z.literal(mapping.propertyId),
  roomTypeId: z.literal(mapping.roomTypeId), ratePlanId: z.literal(mapping.ratePlanId), generation: z.literal(1),
  environment: z.literal('production'), timeZone: z.literal('America/New_York'),
  planningEnabled: z.boolean(), importEnabled: z.boolean(), captureEnabled: z.boolean(), captureVersion: int,
  configurationVersion: int.min(1), headVersion: int, observedAt: int, inputToken: digest,
  start: date, end: date,
  requiredSources: z.tuple([z.literal(INVENTORY_SOURCES[0]), z.literal(INVENTORY_SOURCES[1])]),
  coverage: z.array(z.object({ source: z.enum(INVENTORY_SOURCES), start: date, end: date,
    complete: z.boolean(), observedAt: int, freshUntil: int }).strict()).max(2),
  inputs: z.object({ authority: z.enum(['helm', 'guesty']), plan: rules.nullable(),
    bookings: z.array(z.object({ id, status: z.enum(['inquiry', 'pending', 'confirmed', 'cancelled', 'completed', 'block']),
      check_in: date, check_out: date, duplicate_of: id.nullable(), hold_kind: z.string().nullable(),
      source: z.string(), channel: z.string() }).strict()).max(5000),
    rateDays: z.array(z.object({ date, closed: z.boolean() }).strict()).max(INVENTORY_DAYS),
    periods: z.array(z.object({ startMonth: int.min(1).max(12), startDay: int.min(1).max(31),
      endMonth: int.min(1).max(12), endDay: int.min(1).max(31) }).strict()).max(1000),
  }).strict(),
}).strict();
export type InventoryState = z.infer<typeof stateSchema>;
export type InventoryDay = { date: string; available: 0 | 1 };
export type InventoryPlan = { id: string; digest: string; start: string; end: string; freshUntil: number; days: InventoryDay[] };
export type InventoryExpectation = Pick<InventoryState, 'captureVersion' | 'configurationVersion' | 'headVersion' | 'inputToken'>;
export type InventorySaveResult = { status: 'stored' | 'unchanged' | 'refreshed' | 'superseded'; version: number };
export interface InventoryPlanningStore {
  read(): Promise<unknown>;
  commit(expected: InventoryExpectation, plan: InventoryPlan): Promise<InventorySaveResult>;
}
export function inventoryDigest(days: InventoryDay[]) {
  return createHash('sha256').update(days.map(d => `${d.date}:${d.available}\n`).join('')).digest('hex');
}
export function inventoryPlanId(state: InventoryExpectation & Pick<InventoryState, 'start' | 'end'>, value: string) {
  return createHash('sha256').update([
    mapping.helmPropertyId, mapping.propertyId, mapping.roomTypeId, mapping.ratePlanId, '1',
    state.captureVersion, state.configurationVersion, state.start, state.end, value,
  ].join('|')).digest('hex');
}
/** Inert price placeholders solely to reuse the canonical availability rules.
 * No price/minimum-stay columns are read or returned by this subsystem. */
function availabilityPlan(input: z.infer<typeof rules>): RatePlanRow {
  return { property_id: mapping.helmPropertyId, ...input, currency: 'USD', base_nightly_cents: 0,
    weekend_nightly_cents: null, weekend_days: [], guests_included: 0, extra_guest_cents_per_night: 0,
    cleaning_fee_cents: 0, pet_fee_cents: null, security_deposit_cents: null, weekly_discount_pct: 0,
    monthly_discount_pct: 0, direct_markup_pct: 0, min_nights_default: 1, max_nights: null,
    checkout_time: '11:00', max_occupancy: null, pets_allowed: false, quiet_hours: null,
    cancellation_policy_key: 'custom', cancellation_terms: null, house_rules: null };
}
export function parseInventoryState(raw: unknown): InventoryState {
  const state = stateSchema.parse(raw);
  if (nights(state.start, state.end).length !== INVENTORY_DAYS) throw Error('Expected complete 500-day inventory window');
  const input = state.inputs;
  if (new Set(input.bookings.map(b => b.id)).size !== input.bookings.length ||
    new Set(input.rateDays.map(d => d.date)).size !== input.rateDays.length ||
    new Set(state.coverage.map(c => c.source)).size !== state.coverage.length) throw Error('Duplicate inventory input');
  for (const b of input.bookings) {
    if (b.check_in >= b.check_out || Date.parse(b.check_out) - Date.parse(b.check_in) > 3660 * 86400000) throw Error('Invalid booking span');
  }
  if (input.rateDays.some(d => d.date < state.start || d.date >= state.end)) throw Error('Closure outside inventory window');
  for (const p of input.periods) for (const [m, d] of [[p.startMonth, p.startDay], [p.endMonth, p.endDay]]) {
    if (new Date(Date.UTC(2000, m - 1, d)).getUTCMonth() !== m - 1) throw Error('Invalid rental period');
  }
  return state;
}
export function prepareInventory(raw: unknown, now: number): { state: InventoryState; plan: InventoryPlan | null } {
  int.parse(now);
  const state = parseInventoryState(raw), input = state.inputs, rules = input.plan;
  if (state.observedAt > now) throw Error('Snapshot clock is ahead');
  if (!state.planningEnabled || !state.importEnabled || !state.captureEnabled || !state.captureVersion || input.authority !== 'helm' || !rules ||
    state.start !== todayInEastern(new Date(now)) || state.observedAt + 60000 <= now) return { state, plan: null };
  // Coverage must include neighbours whose turnover buffers reach this window.
  const coveredStart = shiftIsoDay(state.start, -rules.turnover_buffer_days);
  const coveredEnd = shiftIsoDay(state.end, rules.turnover_buffer_days);
  for (const c of state.coverage) {
    if (c.start >= c.end || Date.parse(c.end) - Date.parse(c.start) > 560 * 86400000 || c.observedAt > now ||
      c.freshUntil <= c.observedAt || c.freshUntil - c.observedAt > 3600000) throw Error('Invalid source coverage');
  }
  if (state.requiredSources.some(source => !state.coverage.some(c => c.source === source && c.complete &&
    c.start <= coveredStart && c.end >= coveredEnd && c.freshUntil > now))) return { state, plan: null };
  const dates = nights(state.start, state.end);
  const availability = buildAvailability({ bookings: input.bookings, plan: availabilityPlan(rules),
    rateDays: new Map(input.rateDays.map(d => [d.date, { property_id: mapping.helmPropertyId, ...d,
      nightly_cents: null, min_nights: null, cta: false, ctd: false, note: null, source: 'operator' } satisfies RateDayRow])),
    rentalPeriods: input.periods, start: state.start, end: shiftIsoDay(state.end, -1), now: new Date(now), timeZone: state.timeZone });
  const boundaries = dates.map(d => zonedTimeToMs(d, rules.checkin_time, state.timeZone) - rules.advance_notice_hours * 3600000 + 1).filter(t => t > now);
  const midnight = zonedTimeToMs(shiftIsoDay(state.start, 1), '00:00', state.timeZone);
  const freshUntil = Math.min(state.observedAt + 60000, midnight, ...boundaries, ...state.coverage.map(c => c.freshUntil));
  if (!Number.isSafeInteger(freshUntil) || freshUntil <= now) return { state, plan: null };
  const days: InventoryDay[] = availability.map(d => ({ date: d.date, available: d.available ? 1 : 0 }));
  const digest = inventoryDigest(days);
  return { state, plan: { id: inventoryPlanId(state, digest), digest, start: state.start, end: state.end, freshUntil, days } };
}
/** One bounded attempt. A lost commit response must be followed by a fresh read,
 * never by sending the old plan or manufacturing an empty calendar. */
export async function planProductionInventory(store: InventoryPlanningStore, clock: () => number) {
  const raw = await store.read();
  if (z.object({ status: z.literal('disabled') }).strict().safeParse(raw).success) return { status: 'disabled' as const };
  const { state, plan } = prepareInventory(raw, clock());
  if (!plan) return { status: 'blocked' as const };
  const { captureVersion, configurationVersion, headVersion, inputToken } = state;
  return store.commit({ captureVersion, configurationVersion, headVersion, inputToken }, plan);
}
