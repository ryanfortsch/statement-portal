import { createClient } from '@supabase/supabase-js';
import { parseBookingInventoryState, type BookingInventoryConsumerStore } from './booking-inventory-consumer.ts';
import { replayInventoryJournal } from './inventory-journal.ts';

/** Restricted database edge. No initialization, cron, credentials fallback or provider IO. */
export function createBookingInventoryConsumerStore(url: string, key: string, property: string,
  fetcher: typeof fetch = fetch): BookingInventoryConsumerStore {
  if (typeof window !== 'undefined' || url !== 'https://jgkblfozftcvymvwhhii.supabase.co' || !key || !property.trim()) {
    throw new Error('Explicit isolated staging storage and property required');
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher } });
  const read = async () => {
    const { data, error } = await db.rpc('helm_booking_inventory_read', { p_property: property });
    if (error || !data) throw new Error('Booking inventory state unavailable');
    return parseBookingInventoryState(data, property);
  };
  return { property, read,
    async advanceWindow(expected, start, end, journal) {
      const normalized = replayInventoryJournal(journal).journal;
      if (normalized.commands.length !== expected.journalVersion + 1 ||
          normalized.commands.at(-1)?.kind !== 'retire-pending') throw Error('Expected one window retirement');
      const { data, error } = await db.rpc('helm_booking_inventory_window_advance', { p_property: property,
        expected_capture: expected.captureVersion, expected_configuration: expected.configurationVersion,
        expected_plan: expected.planVersion, expected_journal: expected.journalVersion, expected_inputs: expected.inputs,
        next_start: start, next_end: end, next_journal: normalized });
      if (error || typeof data !== 'boolean') throw Error('Window save uncertain; reread before planning');
      return data;
    },
    async commit(expected, journal, freshUntil, digest) {
      const normalized = replayInventoryJournal(journal).journal;
      if (normalized.commands.length !== expected.journalVersion + 1) throw new Error('Expected one inventory command');
      const { data, error } = await db.rpc('helm_booking_inventory_plan_commit', { p_property: property,
        expected_capture: expected.captureVersion, expected_configuration: expected.configurationVersion,
        expected_plan: expected.planVersion, expected_journal: expected.journalVersion, expected_inputs: expected.inputs,
        next_journal: normalized, fresh_until: freshUntil, desired_digest: digest });
      if (error || typeof data !== 'boolean') throw new Error('Inventory plan save uncertain; reread before retry or dispatch');
      return data;
    },
    journal: {
      async read() { const s = await read(); return { version: s.journalVersion, journal: s.journal }; },
      async append(expectedVersion, journal) {
        const normalized = replayInventoryJournal(journal).journal;
        if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || normalized.commands.length !== expectedVersion + 1) {
          throw new Error('Expected one inventory command');
        }
        const { data, error } = await db.rpc('helm_booking_inventory_journal_append', {
          p_property: property, expected_journal: expectedVersion, next_journal: normalized });
        if (error || typeof data !== 'boolean') throw new Error('Inventory journal save uncertain; do not dispatch');
        return data;
      },
    },
  };
}
