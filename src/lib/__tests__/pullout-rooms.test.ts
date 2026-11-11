/**
 * Pullouts by room (Delaney, 2026-11-10): 17 Beach has a full-size sofa bed
 * in the main house's living room and another in the guest house. A sofa
 * bed written on a room puts the Pullout Bed + Linens card in the deck, and
 * the card names every one, so the inspector checks both.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pulloutCardNote, pulloutRoomsFrom, withSheetsLine } from '../pullout-beds.ts';
import { roomSofaBeds, tvLines } from '../property-rooms-shared.ts';

test('a sofa bed reads from the bed sizes a room carries', () => {
  assert.deepEqual(roomSofaBeds({ details: { beds: [{ size: 'queen', count: 1 }, { size: 'full sofa bed', count: 1 }] } }), ['full sofa bed']);
  assert.deepEqual(roomSofaBeds({ details: { beds: [{ size: 'sleeper', count: 2 }] } }), ['2x sleeper']);
  assert.deepEqual(roomSofaBeds({ details: { beds: [{ size: 'king', count: 1 }] } }), []);
  assert.deepEqual(roomSofaBeds({ details: {} }), []);
});

test('two sofa-bed rooms put both on the card, each with its own sheets', () => {
  const rooms = pulloutRoomsFrom([
    { name: 'Main house living room', details: { beds: [{ size: 'full sofa bed', count: 1 }], sofa_linens: 'closet by the kitchen' } },
    { name: 'Primary bedroom', details: { beds: [{ size: 'king', count: 1 }] } },
    { name: 'Guest house living room', details: { beds: [{ size: 'sofa bed', count: 1 }] } },
  ]);
  assert.equal(rooms.length, 2);
  const card = pulloutCardNote({ hasPullout: true, linensLocation: null, requests: [], rooms });
  assert.ok(card);
  assert.equal(card.level, 'info');
  assert.match(card.note, /2 pullouts here/);
  assert.match(card.note, /Main house living room: full sofa bed\. Its sheets: closet by the kitchen/);
  assert.match(card.note, /Guest house living room: sofa bed$/m);
  // The live sheets swap keeps every room line.
  const swapped = withSheetsLine(card.note, 'hall closet');
  assert.match(swapped, /Guest house living room/);
  assert.match(swapped, /Sheets: hall closet$/);
});

test('one pullout and no rooms reads as it always has', () => {
  const card = pulloutCardNote({ hasPullout: true, linensLocation: 'drawers under the TV', requests: [] });
  assert.equal(card?.note, 'Sheets: drawers under the TV');
});

test('TVs list by room with their remotes', () => {
  assert.deepEqual(
    tvLines([
      { name: 'Living room', details: { tv: 'Samsung Smart TV', tv_remote: 'Samsung remote, 2 AAA' } },
      { name: 'Kitchen', details: {} },
      { name: 'Primary bedroom', details: { tv: 'Samsung Smart TV' } },
    ]),
    ['Living room: Samsung Smart TV · remote: Samsung remote, 2 AAA', 'Primary bedroom: Samsung Smart TV'],
  );
});
