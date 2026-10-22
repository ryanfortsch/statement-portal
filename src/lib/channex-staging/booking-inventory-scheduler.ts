/** Expiring publisher on the existing isolated worker; fixed pilot by default. */
import { setTimeout as sleep } from 'node:timers/promises';
import { CALDERWOOD_STAGING, readIsolatedChannex } from '../calderwood-readonly/channex.ts';
import { bindInventoryRoute, propertyMapping } from './inventory-route.ts';
import { createInventoryRouteReader } from './inventory-route-store.ts';
import { ChannexAvailabilityClient } from './availability-client.ts';
import { createBookingInventoryConsumerStore } from './booking-inventory-consumer-store.ts';
import { bookingInventoryCoverage, bookingInventorySnapshot, parseBookingInventoryState } from './booking-inventory-consumer.ts';
import { runBookingInventoryCycle, reconcileBookingInventoryOnce } from './booking-inventory-cycle.ts';
import { advanceInventoryWindow, inventoryWindowDecision, rollingInventoryWindow } from './booking-inventory-window.ts';
import { InventoryHistoryCapacityError, recordInventoryCommand } from './inventory-journal.ts';

import { CANONICAL_BOOKING_SOURCE, renewCanonicalSourceCoverage } from './canonical-source.ts';
import { createCanonicalSourceClient } from './canonical-source-client.ts';
import { createCanonicalSourceStore } from './canonical-source-store.ts';
import { canonicalPollingEnabled } from './canonical-revision-scheduler.ts';
import { shiftIsoDay } from '../sca-quotes-types.ts';

type Environment = Record<string, string | undefined>;
type Result = { phase: 'source'; status: string } | Awaited<ReturnType<typeof runBookingInventoryCycle>> | { phase: 'window'; status: 'blocked' | 'needs-review' | 'superseded' };
export const CALDERWOOD_INVENTORY_PILOT = Object.freeze({ property: 'HELMTEST-calderwood',
  connection: 'calderwood-hosted-inventory', generation: 1, start: '2027-04-10', end: '2027-04-13', source: 'synthetic-canonical' });
export function inventoryPollingEnabled(env: Environment) {
  return env.CHANNEX_CALDERWOOD_INVENTORY_ENABLED === 'true' && env.CHANNEX_WORKER_MODE === 'isolated-staging'
    && !env.VERCEL_ENV && env.CHANNEX_STAGING_DB_PROJECT_REF === 'jgkblfozftcvymvwhhii'
    && env.CHANNEX_STAGING_DB_URL === 'https://jgkblfozftcvymvwhhii.supabase.co';
}
export function createInventoryCycleRunner(env: Environment, fetcher: typeof fetch = fetch) {
  if (!inventoryPollingEnabled(env) || !env.CHANNEX_STAGING_API_KEY?.trim() || !env.CHANNEX_STAGING_DB_SERVICE_KEY?.trim()) {
    throw Error('Explicit isolated inventory worker configuration required');
  }
  const automaticSource = env.CHANNEX_CALDERWOOD_SOURCE_COVERAGE_ENABLED === 'true';
  if (automaticSource && !canonicalPollingEnabled(env)) throw Error('Canonical polling required for automatic source coverage');
  const mode = env.CHANNEX_CALDERWOOD_INVENTORY_WINDOW ?? 'fixed-pilot';
  if (!['fixed-pilot', 'configured-window', 'rolling-year'].includes(mode)) throw Error('Unknown inventory window mode');
  const property = env.CHANNEX_INVENTORY_HELM_PROPERTY ?? CALDERWOOD_INVENTORY_PILOT.property;
  if (!/^HELMTEST-[a-z0-9-]{1,100}$/.test(property)) throw Error('Explicit fictional staging property required');
  // Import and midnight-window SQL are still limited to the original rehearsal.
  if (property !== CALDERWOOD_INVENTORY_PILOT.property && (automaticSource || mode !== 'configured-window')) {
    throw Error('Additional staging properties require a reviewed configured window and synthetic source');
  }
  return async (signal: AbortSignal): Promise<Result> => {
    const boundedFetch: typeof fetch = (input, init) => {
      signal.throwIfAborted();
      return fetcher(input, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(20000),
        ...(init?.signal ? [init.signal] : [])]) });
    };
    const p = CALDERWOOD_INVENTORY_PILOT, m = CALDERWOOD_STAGING;
    const store = createBookingInventoryConsumerStore(env.CHANNEX_STAGING_DB_URL!, env.CHANNEX_STAGING_DB_SERVICE_KEY!, property, boundedFetch);
    let state = parseBookingInventoryState(await store.read(), property);
    const assertRoute = () => {
      const c = state.configuration;
      if ((automaticSource && (c.connection !== p.connection || c.generation !== p.generation || c.listing !== m.roomTypeId)) ||
          c.requiredSources.length !== 1 || c.requiredSources[0] !== (automaticSource ? CANONICAL_BOOKING_SOURCE : p.source) || state.inputs.authority !== 'helm' ||
          (mode === 'fixed-pilot' && (c.start !== p.start || c.end !== p.end))) throw Error('Inventory pilot configuration changed');
    };
    assertRoute();
    // A paused worker with no coverage work has no reason to read a route or contact Channex.
    if (!automaticSource && !bookingInventorySnapshot(state, Date.now())) return { phase: 'plan', status: 'blocked' };
    const sourceTarget = mode === 'rolling-year' ? rollingInventoryWindow(Date.now()) : state.configuration;
    const sourceCoverage = automaticSource ? bookingInventoryCoverage(state, sourceTarget.start, sourceTarget.end, Date.now()) : null;
    const needsSourceCoverage = automaticSource && (!sourceCoverage || sourceCoverage.some(c => c.freshUntil <= Date.now() + 300000));
    if (!state.configuration.publishEnabled && !needsSourceCoverage) return { phase: 'plan', status: 'blocked' };
    const route = await createInventoryRouteReader(env.CHANNEX_STAGING_DB_URL!, env.CHANNEX_STAGING_DB_SERVICE_KEY!, boundedFetch)(state);
    if (automaticSource && (route.propertyId !== m.propertyId || route.roomTypeId !== m.roomTypeId || route.ratePlanId !== m.ratePlanId)) {
      throw Error('Canonical source remains limited to the reviewed Calderwood staging mapping');
    }
    if (needsSourceCoverage) {
      if (!state.inputs.plan) return { phase: 'source', status: 'blocked' };
      const buffer = state.inputs.plan.turnover_buffer_days;
      const verified = await renewCanonicalSourceCoverage(createCanonicalSourceClient(env.CHANNEX_STAGING_API_KEY!, boundedFetch),
        createCanonicalSourceStore(env.CHANNEX_STAGING_DB_URL!, env.CHANNEX_STAGING_DB_SERVICE_KEY!, boundedFetch),
        { start: shiftIsoDay(sourceTarget.start, -buffer), end: shiftIsoDay(sourceTarget.end, buffer) });
      if (!verified.complete) return { phase: 'source', status: verified.status };
      state = parseBookingInventoryState(await store.read(), property); assertRoute(); bindInventoryRoute(route, state);
    }
    const client = new ChannexAvailabilityClient(env.CHANNEX_STAGING_API_KEY!, {
      environment: route.environment, helmProperty: route.helmProperty, connection: route.connection, generation: route.generation,
      propertyId: route.propertyId, roomTypeId: route.roomTypeId, propertyTitle: route.propertyTitle,
    }, boundedFetch);
    if (mode === 'rolling-year') {
      await recordInventoryCommand(store.journal, { kind: 'expire', now: Date.now() });
      state = parseBookingInventoryState(await store.read(), property); assertRoute(); bindInventoryRoute(route, state);
      const decision = await advanceInventoryWindow(store, state, Date.now());
      if (decision.status === 'unsettled') return { phase: 'reconcile', ...await reconcileBookingInventoryOnce(store.journal, client, decision.id) };
      if (!['current', 'advanced'].includes(decision.status)) return { phase: 'window', status: decision.status === 'needs-review' ? 'needs-review' : decision.status === 'superseded' ? 'superseded' : 'blocked' };
      state = parseBookingInventoryState(await store.read(), property); assertRoute(); bindInventoryRoute(route, state);
      if (inventoryWindowDecision(state, Date.now()).status !== 'current') return { phase: 'plan', status: 'blocked' };
    }
    const c = state.configuration;
    // Only the explicitly configured complete-source verifier can renew coverage.
    // Publish authority remains independent, including after successful certification.
    if (!c.publishEnabled || !bookingInventorySnapshot(state, Date.now())) return { phase: 'plan', status: 'blocked' };
    // Also retain the stopped rate/default and exact occupancy guards used by ingestion.
    const isolated = await readIsolatedChannex(env.CHANNEX_STAGING_API_KEY!, { from: c.start, to: c.end }, propertyMapping(route), boundedFetch);
    if (isolated.days.some(d => d.stopSell !== true || Object.values(d).some(v => v === null))) {
      throw Error('Complete stopped staging calendar required');
    }
    return runBookingInventoryCycle(store, client);
  };
}
export async function runInventoryScheduler(input: {
  cycle: (signal: AbortSignal) => Promise<Result>; signal: AbortSignal; once?: boolean; now?: () => number;
  log: (entry: { event: 'canonical-inventory-cycle'; at: string; failures: number; phase: string; status: string }) => void;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}) {
  let failures = 0, cycles = 0;
  const wait = input.wait ?? ((ms, signal) => sleep(ms, undefined, { signal }));
  while (!input.signal.aborted) {
    let result: { phase: string; status: string };
    try {
      result = await input.cycle(AbortSignal.any([input.signal, AbortSignal.timeout(120000)]));
      failures = ['failed', 'needs-review', 'incomplete', 'mismatch', 'expired', 'disabled', 'source-not-configured'].includes(result.status) ? failures + 1 : 0;
    } catch (error) {
      if (input.signal.aborted) break;
      failures++; result = error instanceof InventoryHistoryCapacityError
        ? { phase: 'history', status: 'needs-review' } : { phase: 'cycle', status: 'failed' };
    }
    cycles++;
    try { input.log({ event: 'canonical-inventory-cycle', at: new Date((input.now ?? Date.now)()).toISOString(), failures, ...result }); }
    catch { /* Logging cannot trigger another write. */ }
    if (input.once || input.signal.aborted) break;
    const delay = failures ? Math.min(60000 * 2 ** Math.min(failures - 1, 4), 900000)
      : ['submitted', 'pending', 'uncertain'].includes(result.status) ? 10000 : 60000;
    try { await wait(delay, input.signal); }
    catch { if (!input.signal.aborted) throw Error('Inventory scheduler wait failed'); }
  }
  return { cycles, failed: failures > 0, canSendMessages: false as const };
}
