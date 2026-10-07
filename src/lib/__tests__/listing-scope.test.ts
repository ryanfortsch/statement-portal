/**
 * Which homes' OTAs read Helm's export, and whose closures are Guesty's
 * echoes (lib/listing-scope.ts). The importer drops a home's direct-feed
 * closures while Guesty runs it and no OTA on it is ticked as importing
 * Helm; the dedupe runs Helm-run rules from that tick.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { exportLiveSince, guestyEchoPropertyIds, importFeedStateOf, ownedByFeed, type ListingScopeRow } from '../listing-scope.ts';

const l = (property_id: string, channel: string, patch: Partial<ListingScopeRow> = {}): ListingScopeRow => ({
  property_id,
  channel,
  is_active: true,
  export_subscribed: false,
  export_subscribed_at: null,
  ...patch,
});
const guesty = (...ids: string[]) => ids.map((id) => ({ id, calendar_authority: 'guesty' }));
const helm = (...ids: string[]) => ids.map((id) => ({ id, calendar_authority: 'helm' }));

describe('guestyEchoPropertyIds', () => {
  test('every home Guesty runs drops its closures, with or without an aggregate row (as on main)', () => {
    const rows = [l('21_horton', 'guesty'), l('21_horton', 'airbnb'), l('84_thatcher', 'airbnb')];
    assert.deepEqual([...guestyEchoPropertyIds(rows, guesty('21_horton', '84_thatcher'))].sort(), ['21_horton', '84_thatcher']);
  });

  test('a home Helm runs never drops them', () => {
    assert.deepEqual([...guestyEchoPropertyIds([l('65_calderwood', 'airbnb')], helm('65_calderwood'))], []);
  });

  test('from the first tick of an OTA importing Helm, closures are read even while Guesty still runs the home', () => {
    const rows = [l('21_horton', 'guesty'), l('21_horton', 'vrbo', { export_subscribed: true, export_subscribed_at: '2026-10-01T12:00:00Z' })];
    assert.deepEqual([...guestyEchoPropertyIds(rows, guesty('21_horton'))], []);
  });

  test('a retired ticked row, or a ticked Guesty row itself, does not count as a tick', () => {
    assert.deepEqual([...guestyEchoPropertyIds([l('b', 'vrbo', { is_active: false, export_subscribed: true })], guesty('b'))], ['b']);
    assert.deepEqual([...guestyEchoPropertyIds([l('c', 'guesty', { export_subscribed: true })], guesty('c'))], ['c']);
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

describe('importFeedStateOf and ownedByFeed: a stay on a feed Helm no longer reads can be cancelled', () => {
  const feedRow = { source: 'ical_import', channel_listing_id: 'L1' };
  const listing = (patch: Record<string, unknown> = {}) => ({ channel: 'vrbo', is_active: true, ical_import_enabled: true, ical_import_url: 'https://vrbo.example/ical', ...patch });
  test('where a row stands', () => {
    assert.equal(importFeedStateOf({ source: 'manual', channel_listing_id: null }, null), 'none');
    assert.equal(importFeedStateOf(feedRow, listing()), 'read');
    assert.equal(importFeedStateOf(feedRow, listing({ channel: 'guesty' })), 'aggregate');
    for (const p of [{ is_active: false }, { ical_import_enabled: false }, { ical_import_url: null }]) {
      assert.equal(importFeedStateOf(feedRow, listing(p)), 'unread', JSON.stringify(p));
    }
    assert.equal(importFeedStateOf(feedRow, null), 'unread', 'its feed row was deleted');
    assert.equal(importFeedStateOf({ ...feedRow, channel_listing_id: null }, null), 'unread');
    assert.equal(importFeedStateOf(feedRow, 'failed'), 'unknown');
  });
  test('the feed owns what it still reads, and a failed read refuses', () => {
    assert.equal(ownedByFeed('read', {}), true);
    assert.equal(ownedByFeed('unknown', {}), true);
    assert.equal(ownedByFeed('aggregate', {}), false);
    assert.equal(ownedByFeed('none', {}), false);
  });
  test("a stay on a retired feed is the operator's to cancel; an OTA closure there is released from the hub", () => {
    assert.equal(ownedByFeed('unread', { hold_kind: null }), false);
    assert.equal(ownedByFeed('unread', { hold_kind: 'ota' }), true);
  });
});
