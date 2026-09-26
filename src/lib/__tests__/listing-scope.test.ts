/**
 * Which homes' OTAs read Helm's export, and whose closures are Guesty's
 * echoes (lib/listing-scope.ts). The importer drops a home's direct-feed
 * closures only while it rides Guesty's aggregate feed AND no OTA on it is
 * ticked as importing Helm; the dedupe runs Helm-run rules from that tick.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { exportLiveSince, guestyEchoPropertyIds, type ListingScopeRow } from '../listing-scope.ts';

const l = (property_id: string, channel: string, patch: Partial<ListingScopeRow> = {}): ListingScopeRow => ({
  property_id,
  channel,
  is_active: true,
  export_subscribed: false,
  export_subscribed_at: null,
  ...patch,
});

describe('guestyEchoPropertyIds', () => {
  test('a fleet home on the aggregate feed drops its closures; a home with no aggregate row does not', () => {
    const rows = [l('21_horton', 'guesty'), l('21_horton', 'airbnb'), l('65_calderwood', 'airbnb'), l('65_calderwood', 'booking_com')];
    assert.deepEqual([...guestyEchoPropertyIds(rows)], ['21_horton']);
  });

  test('from the first tick of an OTA importing Helm, closures are read even with the aggregate row still active', () => {
    const rows = [l('21_horton', 'guesty'), l('21_horton', 'vrbo', { export_subscribed: true, export_subscribed_at: '2026-10-01T12:00:00Z' })];
    assert.deepEqual([...guestyEchoPropertyIds(rows)], []);
  });

  test("a retired aggregate row, a retired ticked row, and a ticked Guesty row itself do not count", () => {
    assert.deepEqual([...guestyEchoPropertyIds([l('a', 'guesty', { is_active: false })])], []);
    assert.deepEqual([...guestyEchoPropertyIds([l('b', 'guesty'), l('b', 'vrbo', { is_active: false, export_subscribed: true })])], ['b']);
    assert.deepEqual([...guestyEchoPropertyIds([l('c', 'guesty', { export_subscribed: true })])], ['c']);
  });
});

describe('exportLiveSince', () => {
  test('the earliest tick among active non-Guesty rows', () => {
    const m = exportLiveSince([
      l('h', 'airbnb', { export_subscribed: true, export_subscribed_at: '2026-10-02T00:00:00Z' }),
      l('h', 'vrbo', { export_subscribed: true, export_subscribed_at: '2026-10-01T09:00:00+00:00' }),
      l('h', 'booking_com', { export_subscribed: false, export_subscribed_at: '2026-09-01T00:00:00Z' }),
    ]);
    assert.equal(m.get('h'), '2026-10-01T09:00:00+00:00');
  });

  test('a ticked row with no timestamp still marks the home live', () => {
    const m = exportLiveSince([l('h', 'airbnb', { export_subscribed: true })]);
    assert.equal(m.has('h'), true);
    assert.equal(m.get('h'), null);
  });
});
