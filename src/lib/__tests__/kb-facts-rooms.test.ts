/**
 * What /api/kb-facts tells the guest AI about a home's rooms and systems
 * (2026-11-10). Two rules are load-bearing:
 *
 * - A room's quirks and notes never leave Helm. property_rooms is RLS-locked
 *   because they carry access context; guestRoomFacts names what may go.
 * - No credential rides the feed: thermostat_code sits next to heating on
 *   the Facts tab, and the door, gate, garage and lock codes are issued per
 *   stay. The route's source is read so a widened select fails here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { guestRoomFact, guestRoomFacts } from '../kb-facts-rooms.ts';

const room = (over: Record<string, unknown> = {}) => ({
  name: 'Living room',
  room_type: 'living' as const,
  guest_summary: null,
  details: {},
  ...over,
});

test('quirks and notes never reach the guest payload', () => {
  const out = guestRoomFact(room({
    details: {
      tv: '55in Samsung',
      quirks: ['lockbox code 4821 under the mat'],
      notes: 'owner keeps the closet code 9090',
    },
  }) as never);
  const sent = JSON.stringify(out);
  assert.ok(!sent.includes('4821'));
  assert.ok(!sent.includes('9090'));
  assert.ok(!('quirks' in out));
  assert.ok(!('notes' in out));
});

test('beds, sofa beds, TV and remote come through as written', () => {
  const out = guestRoomFact(room({
    details: {
      beds: [{ size: 'full sofa bed', count: 1 }, { size: 'twin', count: 2 }],
      sofa_linens: 'hall closet, top shelf',
      tv: '55in Samsung',
      tv_remote: 'Samsung remote, 2 AAA',
      amenities: ['mini-split', '  '],
    },
    guest_summary: '  Opens onto the deck. ',
  }) as never);
  assert.deepEqual(out.beds, ['1x full sofa bed', '2x twin']);
  assert.deepEqual(out.sofa_beds, ['full sofa bed']);
  assert.equal(out.sofa_linens, 'hall closet, top shelf');
  assert.equal(out.tv_remote, 'Samsung remote, 2 AAA');
  assert.deepEqual(out.amenities, ['mini-split']);
  assert.equal(out.guest_summary, 'Opens onto the deck.');
});

test('a room with nothing a guest could be told is left out', () => {
  const out = guestRoomFacts([
    room({ name: 'Garage', room_type: 'garage', details: { quirks: ['door sticks'] } }),
    room({ name: 'Bedroom 1', room_type: 'bedroom', details: { beds: [{ size: 'queen', count: 1 }] } }),
  ] as never);
  assert.deepEqual(out.map((r) => r.name), ['Bedroom 1']);
});

const route = readFileSync(new URL('../../app/api/kb-facts/route.ts', import.meta.url), 'utf8');

test('the feed selects no credential column', () => {
  for (const col of ['thermostat_code', 'smart_lock_code', 'gate_code', 'garage_code', 'alarm_code', 'key_code_location', 'supply_closet']) {
    assert.ok(!new RegExp(`\\b${col}\\b`).test(route.replace(/\/\/.*$/gm, '')), `kb-facts must not read ${col}`);
  }
});

test('rooms reach the payload only through guestRoomFacts', () => {
  assert.match(route, /rooms: guestRoomFacts\(/);
});
