/**
 * The 4 x 6 trash-day fridge card, pinned.
 *
 * Three things have to hold:
 *
 *  1. Every sentence on the card is civic.ts's or the row's. The card lays
 *     the set-out out as two dated lines and prints nothing else of its own.
 *  2. A home never gets a guessed day. Rockport has no carts; a split
 *     Gloucester street waits for the DPW call.
 *  3. The curb return survives: Sec. 5-66(q), $400 per occurrence.
 *
 * Plus the two wiring facts that fail silently: the proxy must let the
 * Puppeteer renderer reach the per-home page (or the PDF is the sign-in
 * page), and must keep the fleet-wide page gated.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { cartSetOutFor } from '../civic.ts';
import { trashNoticeFor, isTrashNoticeHome, TRASH_NOTICE_COLUMNS } from '../trash-notice.ts';
import type { HelmPropertyRow } from '../properties.ts';

/** Minimal property row. Only the fields the notice reads matter. */
function prop(over: Partial<HelmPropertyRow>): HelmPropertyRow {
  return {
    id: 'test',
    name: 'Test',
    title: null,
    address: '',
    city: 'Gloucester, MA',
    trash_day: null,
    recycling_day: null,
    trash_notes: null,
    parking_regulations: null,
    is_active: true,
    kind: 'managed',
    ...over,
  } as HelmPropertyRow;
}

test('the dated set-out names the night before and keeps the curb return', () => {
  const friday = cartSetOutFor('Gloucester', 'Friday')!;
  assert.equal(friday.day, 'Friday');
  assert.equal(friday.outNight, 'Thursday');
  // Monday wraps to Sunday night, not to nothing.
  assert.equal(cartSetOutFor('Gloucester', 'Monday')!.outNight, 'Sunday');

  // The nudge: the bag reaches the cart and the cart reaches the curb.
  assert.match(friday.outLine, /bring the trash down/i);
  assert.match(friday.outLine, /curb/);
  assert.match(friday.outLine, /lids closed/);
  // Sec. 5-66(q). Never drop it. "Once emptied" rides in the step label.
  assert.match(friday.backLine, /bring the carts back in/i);
  assert.equal(friday.backWhen, 'once emptied');

  // House style.
  for (const s of [friday.outLine, friday.backLine]) assert.doesNotMatch(s, /—/);
});

test('a home where we roll the carts asks the guest only to fill them', () => {
  // 16 Waterman. The guest still brings the trash down; the curb is ours.
  const ours = cartSetOutFor('Gloucester', 'Tuesday', { cartsHandledByUs: true })!;
  assert.equal(ours.outNight, 'Monday');
  assert.match(ours.outLine, /bring the trash down/i);
  assert.match(ours.outLine, /lids closed/);
  assert.match(ours.outLine, /We roll the carts to the curb/);
  assert.doesNotMatch(ours.outLine, /and roll/, 'the guest is never asked to roll them');
  assert.match(ours.backLine, /We bring the carts back in/);
  assert.equal(ours.backWhen, null);

  const r = trashNoticeFor(prop({ id: '16_waterman', name: '16 Waterman', address: '16 Waterman Road', carts_handled_by_us: true }));
  assert.ok(r.ok);
  assert.equal(r.notice.cartsHandledByUs, true);
  assert.equal(r.notice.day, 'Tuesday');
  assert.match(r.notice.outLine, /We roll the carts/);
  // The default is the guest's job, and a missing column reads as false.
  const plain = trashNoticeFor(prop({ address: '16 Waterman Road' }));
  assert.ok(plain.ok && plain.notice.cartsHandledByUs === false);
  assert.match(plain.ok ? plain.notice.outLine : '', /and roll the carts to the curb/);
});

test('the set-out is Gloucester only and needs a real weekday', () => {
  assert.equal(cartSetOutFor('Rockport', 'Friday'), null, 'Rockport has no carts to roll');
  assert.equal(cartSetOutFor('Beverly', 'Friday'), null, 'Beverly runs its own program');
  assert.equal(cartSetOutFor('Gloucester', null), null);
  assert.equal(cartSetOutFor('Gloucester', 'NA'), null);
});

test('a Gloucester home on a single-day street gets a card from the street list', () => {
  const r = trashNoticeFor(prop({ id: '21_horton', name: '21 Horton', address: '21 Horton Street', title: 'Stay at Horton' }));
  assert.ok(r.ok);
  assert.equal(r.notice.daySource, 'street');
  assert.equal(r.notice.outNight, dayBefore(r.notice.day));
  assert.equal(r.notice.displayName, 'Stay at Horton');
  assert.equal(r.notice.location, null);
});

test('an operator-set day wins and is labelled as the row', () => {
  // 84 Thatcher: Thatcher Road is split on the DPW list; Dotti confirmed
  // Friday with DPW on 2026-10-02 and it lives on the row.
  const r = trashNoticeFor(prop({ id: '84_thatcher', name: '84 Thatcher', address: '84 Thatcher Road', trash_day: 'Friday' }));
  assert.ok(r.ok);
  assert.equal(r.notice.day, 'Friday');
  assert.equal(r.notice.outNight, 'Thursday');
  assert.equal(r.notice.daySource, 'row');
  // Falls back to the internal name when there is no guest-facing title.
  assert.equal(r.notice.displayName, '84 Thatcher');
});

test('a split street with no row day gets no card, and says to phone DPW', () => {
  const r = trashNoticeFor(prop({ id: '84_thatcher', name: '84 Thatcher', address: '84 Thatcher Road' }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.skip.reason, /978-325-5600/);
    assert.match(r.skip.reason, /No collection day/);
  }
});

test('a Rockport home never gets a cart card', () => {
  const r = trashNoticeFor(prop({ id: '3_south_st', name: '3 South', address: '3 South Street', city: 'Rockport, MA', trash_day: 'Friday' }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.skip.reason, /Gloucester only/);
  // And the fleet filter agrees, so the print page never even asks.
  assert.equal(isTrashNoticeHome(prop({ city: 'Rockport, MA' })), false);
  assert.equal(isTrashNoticeHome(prop({ city: 'Gloucester, MA', is_active: false })), false);
  assert.equal(isTrashNoticeHome(prop({ city: 'Gloucester, MA', kind: 'hq', is_active: false })), false);
  assert.equal(isTrashNoticeHome(prop({ city: 'Gloucester, MA' })), true);
});

test('where the carts live rides through in the operator\'s words, trimmed', () => {
  const r = trashNoticeFor(
    prop({ id: '225_washington', name: '225 Washington', address: '225 Washington Street', trash_day: 'Wednesday', trash_notes: '  The carts live at the end of the driveway.  ' }),
  );
  assert.ok(r.ok);
  assert.equal(r.notice.location, 'The carts live at the end of the driveway.');
  assert.equal(r.notice.day, 'Wednesday');
  assert.equal(r.notice.outNight, 'Tuesday');
  // A blank note is no location, not an empty line on the card.
  const blank = trashNoticeFor(prop({ address: '21 Horton Street', trash_notes: '   ' }));
  assert.ok(blank.ok && blank.notice.location === null);
});

test('the columns the pages select cover everything the notice reads', () => {
  for (const col of ['id', 'name', 'title', 'address', 'city', 'trash_day', 'recycling_day', 'trash_notes', 'carts_handled_by_us', 'parking_regulations', 'is_active', 'kind']) {
    assert.ok(TRASH_NOTICE_COLUMNS.split(',').map((c) => c.trim()).includes(col), col);
  }
});

test('the proxy lets the renderer reach the per-home page and keeps the fleet page gated', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const proxy = readFileSync(path.join(here, '..', '..', 'proxy.ts'), 'utf8');
  const m = proxy.match(/const PROPERTY_DELIVERABLE_RE = (\/.*\/);/);
  assert.ok(m, 'PROPERTY_DELIVERABLE_RE must still be a literal regex in proxy.ts');
  const re = new Function(`return ${m[1]}`)() as RegExp;
  assert.equal(re.test('/properties/21_horton/trash-notice'), true);
  assert.equal(re.test('/properties/trash-notices'), false, 'the fleet-wide page is for staff');
  assert.equal(re.test('/properties/21_horton/edit'), false);
});

function dayBefore(day: string): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[(days.indexOf(day) + 6) % 7];
}
