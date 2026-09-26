/**
 * Round-16 guards that live in IO code and pages, read from the source (the
 * shape shoot-offer-optin.test.ts uses). Break one and watch it fail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test('every Helm sale path reads the stays a buffer can reach from, not only the overlapping ones', () => {
  const bridge = read('src/lib/pms-bridge.ts');
  assert.ok(bridge.includes('holdsInWindow(property.id, shiftIsoDay(start, -TURNOVER_BUFFER_MAX_DAYS), shiftIsoDay(end, 1 + TURNOVER_BUFFER_MAX_DAYS))'), 'availability');
  assert.ok(bridge.includes('holdsInWindow(property.id, shiftIsoDay(args.checkIn, -TURNOVER_BUFFER_MAX_DAYS), shiftIsoDay(args.checkOut, TURNOVER_BUFFER_MAX_DAYS))'), 'quote and create');
  assert.ok(!bridge.includes('holdsInWindow(property.id, args.checkIn, args.checkOut)'), 'the overlap-only read is back');
  const quote = read('src/app/channels/calendar/calendar-actions.ts');
  assert.ok(quote.includes('listBookingsForProperty(propertyId, shiftIsoDay(input.checkIn, -TURNOVER_BUFFER_MAX_DAYS), shiftIsoDay(input.checkOut, TURNOVER_BUFFER_MAX_DAYS))'));
  const form = read('src/app/channels/bookings/new/page.tsx');
  assert.ok(form.includes('listBookingsForProperty(property.id, shiftIsoDay(checkIn, -TURNOVER_BUFFER_MAX_DAYS), shiftIsoDay(checkOut, TURNOVER_BUFFER_MAX_DAYS))'));
});

test('the new-booking form says the database refuses only what it refuses', () => {
  const form = read('src/app/channels/bookings/new/page.tsx');
  assert.ok(/check && check\.conflicting\.length > 0 && !isBlock && !bcomHandEntry && \(/.test(form));
  assert.ok(!/check\.range && !check\.range\.available && !isBlock && !bcomHandEntry/.test(form), 'a rule-shut night is not an overlap');
  assert.ok(form.includes('booking window or turnover buffer'));
});

test('the Listing section names no reader that does not read it', () => {
  const page = read('src/app/properties/[id]/page.tsx');
  assert.ok(!page.includes('what staycapeann.com and the guest AI read'));
  const panel = read('src/app/properties/[id]/ListingPanel.tsx');
  assert.ok(!panel.includes('This record feeds staycapeann.com, the guest AI and automations'));
});

test('a hold in the tick-to-flip window is not told to live in Helm only', () => {
  const action = read('src/app/channels/calendar/calendar-actions.ts');
  assert.ok(/\.eq\('export_subscribed', true\)\s*\.neq\('channel', 'guesty'\)/.test(action));
  const grid = read('src/app/channels/calendar/MultiCalendarGrid.tsx');
  assert.ok(grid.includes('{!p.helmRun && !p.exportTicked && ('));
  for (const p of ['src/app/channels/calendar/page.tsx', 'src/app/channels/[propertyId]/calendar/page.tsx', 'src/app/channels/[propertyId]/page.tsx']) {
    assert.ok(read(p).includes('exportTicked:'), `${p} sets exportTicked`);
  }
});

test('the revert copy says what happens to automations', () => {
  assert.ok(read('src/app/channels/[propertyId]/page.tsx').includes('Message automations pause while Guesty runs the home'));
});
