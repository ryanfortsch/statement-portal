/**
 * Round-13 guards that live in IO code, read from the source (the shape
 * shoot-offer-optin.test.ts uses). Break one and watch it fail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
const fnBody = (src: string, header: string) => {
  const start = src.indexOf(header);
  assert.ok(start >= 0, `${header} is in the file`);
  const next = src.indexOf('\nexport ', start + header.length);
  return src.slice(start, next < 0 ? undefined : next);
};

test('an inquiry from /book never links a guest record; confirming it does', () => {
  // Anyone can send a /book inquiry naming any email. Linked at create, the
  // sender's fields merged onto a real guest's record.
  const src = read('src/lib/bookings-write.ts');
  const create = fnBody(src, 'export async function createBooking(');
  assert.ok(/if \(linksGuest\(row\.status\)\) await linkGuestSafe\(row\)/.test(create), 'createBooking links only real stays');
  assert.ok(!/row\.status !== 'block'\) await linkGuestSafe/.test(create), 'the old any-status link is back');
  const move = fnBody(src, 'export async function moveBooking(');
  assert.ok(/!linksGuest\(before\.status\) && linksGuest\(row\.status\)\) await linkGuestSafe\(row\)/.test(move), 'a confirmed request links on promotion');
  assert.ok(/function linksGuest\(status: string\): boolean \{\s*return status === 'confirmed' \|\| status === 'completed';/.test(src));
  const link = src.slice(src.indexOf('async function linkGuestSafe('), src.indexOf('// ── create'));
  assert.ok(/guestTyped: row\.source === 'direct_booking'/.test(link), 'a /book row is guest-typed');
});

test('the staycapeann.com bridge links its guest without writing onto a matched record', () => {
  const src = read('src/lib/pms-bridge.ts');
  const after = src.slice(src.indexOf('async function afterCreate('));
  const upsert = after.slice(after.indexOf('await upsertGuestForBooking({'), after.indexOf('});', after.indexOf('await upsertGuestForBooking({')));
  assert.ok(/guestTyped: true/.test(upsert));
  const identity = read('src/lib/guests-identity.ts');
  assert.ok(/mergeGuestFields\(guest, booking, \{ isProxyEmail, guestTyped: !!booking\.guestTyped \}\)/.test(identity), 'upsertGuestForBooking passes guestTyped to the merge');
});

test('a feed cancel takes the stay\'s parked and scheduled messages with it', () => {
  const src = read('src/lib/ical-sync.ts');
  const i = src.indexOf(".from('automation_sends')");
  assert.ok(i > 0, 'ical-sync cancels automation_sends');
  const block = src.slice(src.lastIndexOf('const pausedStays', i), i + 400);
  assert.ok(block.includes('plan.cancelNow'), 'the loop covers the feed cancels');
  assert.ok(block.includes("status: 'cancelled'"));
  assert.ok(block.includes(".in('status', ['scheduled', 'awaiting_approval'])"), 'only unsent rows are cancelled');
});

test('the OTA paste text is released only through the same dispatch decision the send makes', () => {
  const src = read('src/lib/automations.ts');
  const body = fnBody(src, 'export async function otaPasteText(');
  const decide = body.indexOf('decideDispatch(');
  const ret = body.indexOf('text: rendered.text');
  assert.ok(decide > 0, 'otaPasteText calls decideDispatch');
  assert.ok(ret < 0 || decide < ret, 'the unmasked text is returned only after the decision');
});

test('the calendar drawer saves only the fields the operator touched', () => {
  // A range save once copied the first night's Closed, minimum and note
  // onto every night: closed nights reopened, notes erased.
  const src = read('src/app/channels/calendar/MultiCalendarGrid.tsx');
  const submit = src.slice(src.indexOf('const submitPrice = () => {'), src.indexOf('const submitBlock = () => {'));
  for (const [key, field] of [['nightlyDollars', 'nightly'], ['minNights', 'min'], ['closed', 'closed'], ['note', 'note']]) {
    assert.ok(new RegExp(`${key}: touched\\.has\\('${field}'\\) \\? \\w+ : undefined`).test(submit), `${key} is sent only when touched`);
  }
});

test("a Guesty-run home's Guesty row is not retired by hand", () => {
  const actions = read('src/app/channels/listings/actions.ts');
  const toggle = fnBody(actions, 'export async function toggleListingActive(');
  const refuse = toggle.indexOf("its Guesty row retires at the flip");
  const retire = toggle.indexOf('await retireFeedHolds(');
  assert.ok(refuse > 0 && retire > refuse, 'the refusal runs before any hold is retired');
  const page = read('src/app/channels/listings/page.tsx');
  assert.ok(/active && !helmRun \?/.test(page), 'the page offers no Retire button on a Guesty-run home');
});

test('/book serves and accepts inquiries only for bookable homes', () => {
  for (const p of ['src/app/book/[propertyId]/page.tsx', 'src/app/book/[propertyId]/actions.ts']) {
    const src = read(p);
    assert.ok(/isPublicBookable\(property, new Set\(Object\.keys\(PROPERTIES\)\)\)/.test(src), `${p} gates on isPublicBookable`);
    assert.ok(!/!property\.is_active\)/.test(src), `${p} still gates on is_active alone`);
  }
});
