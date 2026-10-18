/**
 * Every irreversible action the audit listed asks once, naming the count or
 * the effect (audit 2026-10-17, Part 5, reports 08 and 11).
 *
 * The wording lives in irreversible-confirms.ts and is checked here; each
 * control is then read from its source to be sure the question is still
 * wired to it. A confirm dropped from one of these files is a one-tap cancel
 * of real stays, door codes, prices or a guest's card.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  balanceChargeConfirm,
  cancelStayConfirm,
  clearRatesConfirm,
  feedStopConfirm,
  massCancelConfirm,
  releaseClosureConfirm,
  revokeCodeConfirm,
} from '../irreversible-confirms.ts';
import { houseDay, houseRange } from '../house-date.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

describe('the house date', () => {
  test('reads a calendar day without a zone moving it', () => {
    assert.equal(houseDay('2026-10-16'), 'Fri, Oct 16');
    assert.equal(houseDay('2026-10-16T23:30:00-04:00'), 'Fri, Oct 16');
    assert.equal(houseRange('2026-12-31', '2027-01-02'), 'Thu, Dec 31 to Sat, Jan 2');
    assert.equal(houseDay(''), '');
    assert.equal(houseDay('soon'), 'soon');
  });
});

describe('the questions', () => {
  test('a feed stop names the closures it cancels, or that Booking.com keeps them', () => {
    assert.equal(
      feedStopConfirm('retire', 'Airbnb', 3, false),
      'Retire the Airbnb feed? Helm stops reading it. This cancels its 3 imported closures, and those nights reopen.',
    );
    assert.match(feedStopConfirm('clear_url', 'VRBO', 1, false), /^Save the VRBO feed with no URL\?.*1 imported closure,/);
    assert.match(feedStopConfirm('retire', 'VRBO', 0, false), /no imported closures to cancel/);
    assert.match(feedStopConfirm('retire', 'Booking.com', 2, true), /2 closures stay closed until you release each one/);
  });

  test('a mass-cancel release says how many, and where they go', () => {
    assert.equal(
      massCancelConfirm('Airbnb', 4, false),
      'Cancel the 4 held stays on the Airbnb feed now? They leave the turnover rail and the cleaner schedule, and their nights reopen.',
    );
    assert.match(massCancelConfirm('Booking.com', 1, true), /^Cancel the 1 held closure on the Booking.com feed now\? Their nights reopen/);
    assert.match(massCancelConfirm('VRBO', 0, false), /^Cancel every held stay/);
  });

  test('a release, a cancel and a revoke name the stay in the house date', () => {
    assert.match(releaseClosureConfirm('2026-10-16', '2026-10-19'), /Fri, Oct 16 to Mon, Oct 19/);
    assert.equal(
      cancelStayConfirm({ isBlock: false, guestName: 'Taylor', checkIn: '2026-10-16', checkOut: '2026-10-19' }),
      "Cancel Taylor's stay, Fri, Oct 16 to Mon, Oct 19? Those nights open again in Helm, and the stay leaves the turnover rail.",
    );
    assert.match(cancelStayConfirm({ isBlock: true, guestName: null, checkIn: '2026-10-16', checkOut: '2026-10-19' }), /^Release this hold/);
    assert.match(revokeCodeConfirm('Taylor', '2026-10-16', '2026-10-19'), /^Revoke Taylor's door code \(Fri, Oct 16 to Mon, Oct 19\)\? It comes off the lock/);
  });

  test('clear range counts the overrides it deletes, PriceLabs seeds called out', () => {
    const days = [
      { date: '2026-10-20', source: 'operator' },
      { date: '2026-10-21', source: 'seed' },
      { date: '2026-10-22', source: 'pricelabs' },
      { date: '2026-11-01', source: 'operator' },
    ];
    assert.equal(
      clearRatesConfirm('2026-10-20', '2026-10-31', days, '2026-10-18'),
      "Clear 3 overrides from Tue, Oct 20 to Sat, Oct 31, 2 of them seeded from PriceLabs? The plan's own rate and rules return on those nights.",
    );
    assert.match(clearRatesConfirm('2026-12-01', '2026-12-05', days, '2026-10-18'), /There are no overrides/);
    // A range starting before what the panel loaded cannot be counted.
    assert.match(clearRatesConfirm('2026-10-01', '2026-10-25', days, '2026-10-18'), /^Clear every override/);
  });

  test('the balance charge names the amount and whose card', () => {
    assert.equal(balanceChargeConfirm('$1,250.00', 'Taylor Reed'), "Charge $1,250.00 to Taylor Reed's saved card now?");
    assert.equal(balanceChargeConfirm('$80.00', ''), "Charge $80.00 to the guest's saved card now?");
  });
});

describe('each control still asks', () => {
  test('listings: retire and the blanked URL', () => {
    const page = read('src/app/channels/listings/page.tsx');
    assert.ok(page.includes("confirm={listing.is_active ? feedStopConfirm('retire'"), 'feed retire lost its confirm');
    assert.ok(page.includes("confirm={feedStopConfirm('retire', 'Guesty'"), 'Guesty retire lost its confirm');
    assert.ok(page.includes("clearedConfirm={feedStopConfirm('clear_url'"), 'blank URL save lost its confirm');
    const form = read('src/app/channels/listings/FeedUrlForm.tsx');
    assert.ok(form.includes('if (!value && !window.confirm(clearedConfirm)) e.preventDefault();'));
  });

  test('hub: These cancellations are real, and Release', () => {
    const hub = read('src/app/channels/[propertyId]/page.tsx');
    assert.ok(hub.includes('confirm={massCancelConfirm(label, held, bcom)}'));
    assert.ok(hub.includes('confirm={releaseClosureConfirm(r.check_in, r.check_out)}'));
  });

  test('booking record: Cancel stay asks, and a reason is required', () => {
    const page = read('src/app/channels/bookings/[id]/page.tsx');
    assert.ok(page.includes('confirm={cancelStayConfirm('));
    assert.match(page, /<input name="reason" type="text" required/);
    const actions = read('src/app/channels/bookings/[id]/actions.ts');
    const fn = actions.slice(actions.indexOf('export async function cancelBookingWithReason'));
    assert.ok(!fn.slice(0, 600).includes("?? 'operator'"), "the reason defaults to 'operator' again");
    assert.ok(fn.slice(0, 600).includes('if (!reason'));
  });

  test("door codes, rates, and a guest's card", () => {
    const codes = read('src/app/properties/[id]/GuestCodesPanel.tsx');
    assert.ok(codes.includes('window.confirm(revokeCodeConfirm(b.guest_name, b.check_in, b.check_out))'));
    const rates = read('src/app/properties/[id]/RatesPanel.tsx');
    assert.ok(rates.includes('clearRatesConfirm(') && rates.includes('if (!window.confirm(msg)) e.preventDefault();'));
    const charges = read('src/app/payments/balance-charges/page.tsx');
    assert.equal(charges.split('confirm={balanceChargeConfirm(').length - 1, 2, 'both charge buttons ask');
  });
});
