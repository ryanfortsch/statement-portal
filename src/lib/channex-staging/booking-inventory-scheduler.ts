/** Expiring publisher on the existing isolated worker; fixed pilot by default. */
import { setTimeout as sleep } from 'node:timers/promises';
import { CALDERWOOD_STAGING, readCalderwoodChannex } from '../calderwood-readonly/channex.ts';
import { ChannexAvailabilityClient } from './availability-client.ts';
import { createBookingInventoryConsumerStore } from './booking-inventory-consumer-store.ts';
import { bookingInventorySnapshot, parseBookingInventoryState } from './booking-inventory-consumer.ts';
import { runBookingInventoryCycle, reconcileBookingInventoryOnce } from './booking-inventory-cycle.ts';
import { advanceInventoryWindow, inventoryWindowDecision } from './booking-inventory-window.ts';
import { recordInventoryCommand } from './inventory-journal.ts';

type Environment = Record<string, string | undefined>;
type Result = Awaited<ReturnType<typeof runBookingInventoryCycle>> | { phase: 'window'; status: 'blocked' | 'needs-review' | 'superseded' };
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
  const mode = env.CHANNEX_CALDERWOOD_INVENTORY_WINDOW ?? 'fixed-pilot';
  if (!['fixed-pilot', 'rolling-year'].includes(mode)) throw Error('Unknown inventory window mode');
  return async (signal: AbortSignal): Promise<Result> => {
    const boundedFetch: typeof fetch = (input, init) => {
      signal.throwIfAborted();
      return fetcher(input, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(20000),
        ...(init?.signal ? [init.signal] : [])]) });
    };
    const p = CALDERWOOD_INVENTORY_PILOT, m = CALDERWOOD_STAGING;
    const store = createBookingInventoryConsumerStore(env.CHANNEX_STAGING_DB_URL!, env.CHANNEX_STAGING_DB_SERVICE_KEY!, p.property, boundedFetch);
    let state = parseBookingInventoryState(await store.read(), p.property);
    const assertRoute = () => {
      const c = state.configuration;
      if (c.connection !== p.connection || c.generation !== p.generation || c.listing !== m.roomTypeId ||
          c.requiredSources.length !== 1 || c.requiredSources[0] !== p.source || state.inputs.authority !== 'helm' ||
          (mode === 'fixed-pilot' && (c.start !== p.start || c.end !== p.end))) throw Error('Inventory pilot configuration changed');
    };
    assertRoute();
    const client = new ChannexAvailabilityClient(env.CHANNEX_STAGING_API_KEY!, {
      environment: 'staging', helmProperty: p.property, connection: p.connection, generation: p.generation,
      propertyId: m.propertyId, roomTypeId: m.roomTypeId, propertyTitle: '65 Calderwood - Isolated Staging',
    }, boundedFetch);
    if (mode === 'rolling-year') {
      await recordInventoryCommand(store.journal, { kind: 'expire', now: Date.now() });
      state = parseBookingInventoryState(await store.read(), p.property); assertRoute();
      const decision = await advanceInventoryWindow(store, state, Date.now());
      if (decision.status === 'unsettled') return { phase: 'reconcile', ...await reconcileBookingInventoryOnce(store.journal, client, decision.id) };
      if (!['current', 'advanced'].includes(decision.status)) return { phase: 'window', status: decision.status === 'needs-review' ? 'needs-review' : decision.status === 'superseded' ? 'superseded' : 'blocked' };
      state = parseBookingInventoryState(await store.read(), p.property); assertRoute();
      if (inventoryWindowDecision(state, Date.now()).status !== 'current') return { phase: 'plan', status: 'blocked' };
    }
    const c = state.configuration;
    // Coverage is owner-reviewed and expires within one hour. Never renew it here.
    if (!c.publishEnabled || !bookingInventorySnapshot(state, Date.now())) return { phase: 'plan', status: 'blocked' };
    // Also retain the stopped rate/default and exact occupancy guards used by ingestion.
    const isolated = await readCalderwoodChannex(env.CHANNEX_STAGING_API_KEY!, { from: c.start, to: c.end }, boundedFetch);
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
      failures = ['failed', 'needs-review', 'incomplete'].includes(result.status) ? failures + 1 : 0;
    } catch {
      if (input.signal.aborted) break;
      failures++; result = { phase: 'cycle', status: 'failed' };
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
