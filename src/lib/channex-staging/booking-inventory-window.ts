/** One-day rolling-window boundary. No source renewal, initial enablement or IO. */
import { shiftIsoDay, todayInEastern } from '../sca-quotes-types.ts';
import { bookingInventoryCoverage, type BookingInventoryState, type BookingInventoryConsumerStore } from './booking-inventory-consumer.ts';
import { replayInventoryJournal, type InventoryCommand } from './inventory-journal.ts';

export function rollingInventoryWindow(now: number) {
  if (!Number.isSafeInteger(now) || now < 0) throw Error('Invalid inventory clock');
  const start = todayInEastern(new Date(now));
  // The existing rule permits today + 365. The exclusive endpoint is +366.
  return { start, end: shiftIsoDay(start, 366) };
}
export function inventoryWindowDecision(state: BookingInventoryState, now: number) {
  const target = rollingInventoryWindow(now), c = state.configuration;
  if (!c.publishEnabled || state.inputs.authority !== 'helm' || state.inputs.plan?.booking_window_days !== 365 ||
      !state.captureEnabled || state.captureVersion === 0) return { status: 'blocked' as const };
  if (c.start === target.start && c.end === target.end) return bookingInventoryCoverage(state, target.start, target.end, now)
    ? { status: 'current' as const, ...target } : { status: 'blocked' as const };
  // Expansion from the three-night fixture and recovery after a longer outage
  // require a new reviewed baseline; never silently skip unobserved days.
  if (c.start !== shiftIsoDay(target.start, -1) || c.end !== shiftIsoDay(target.end, -1)) {
    return { status: 'needs-review' as const };
  }
  if (!bookingInventoryCoverage(state, target.start, target.end, now)) return { status: 'blocked' as const };
  const { journal, queue } = replayInventoryJournal(state.journal);
  const unsettled = queue.list().find(j => !['pending', 'verified', 'superseded'].includes(j.status));
  if (unsettled) return { status: 'unsettled' as const, id: unsettled.id };
  const command: InventoryCommand = { kind: 'retire-pending', connection: c.connection, property: state.property, generation: c.generation };
  const next = { ...journal, commands: [...journal.commands, command] };
  replayInventoryJournal(next); // Also refuses generation skew and exhausted history.
  return { status: 'advance' as const, ...target, journal: next };
}
export async function advanceInventoryWindow(store: BookingInventoryConsumerStore, state: BookingInventoryState, now: number) {
  const decision = inventoryWindowDecision(state, now);
  if (decision.status !== 'advance') return decision;
  if (!store.advanceWindow) return { status: 'blocked' as const };
  const saved = await store.advanceWindow({ captureVersion: state.captureVersion, configurationVersion: state.configurationVersion,
    planVersion: state.planVersion, journalVersion: state.journalVersion, inputs: state.inputs },
    decision.start, decision.end, decision.journal);
  // Always reread after a successful commit before planning: the new edge may
  // contain a closure absent from the old window's query.
  return { status: saved ? 'advanced' as const : 'superseded' as const };
}
