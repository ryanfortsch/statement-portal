/**
 * Vendor visit holds, the rules (docs/vendor-visit-holds.md): which home a
 * vendor's text names, which slips the visit covers, and which nights the
 * hold closes. The hold never covers a guest's night.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkApproveInput,
  chooseVisitSlips,
  matchVisitProperty,
  nightFactsFrom,
  planVisitHold,
  proposalGate,
  vendorSlipLabel,
  vendorVisitNote,
  type HoldPlanInput,
  type NightFact,
  type VisitSlipInput,
} from '../vendor-visit-core.ts';
import { isOwnerNight } from '../owner-hold-checkouts.ts';
import { addDays } from '../vendor-visit-dates.ts';

const ROSTER = [
  { id: '73_rocky_neck', name: '73 Rocky Neck', listing_match: 'stay at rocky neck' },
  { id: '53_rocky_neck', name: '53 Rocky Neck', listing_match: null },
  { id: '53_rocky_neck_2', name: '53 Rocky Neck, Downstairs', listing_match: null },
  { id: '21_horton', name: '21 Horton', listing_match: null },
  { id: '20_hammond', name: '20 Hammond', listing_match: null },
  { id: '20_enon', name: '20 Enon', listing_match: null },
];

describe('which home the text names', () => {
  test('a date is never a house number', () => {
    // The cleaner matcher's bare-number rule reads "21" as 21 Horton.
    assert.equal(matchVisitProperty('Wed 10/21 after 11 works', ROSTER), null);
    assert.equal(matchVisitProperty('Tuesday 10/27 at 1 works', ROSTER), null);
    assert.equal(matchVisitProperty('20 works for me', ROSTER), null);
  });

  test('a number and a street word, or the listing name', () => {
    assert.equal(matchVisitProperty('73 Rocky Neck is open Wed 10/21 after 11 AM', ROSTER)?.id, '73_rocky_neck');
    assert.equal(matchVisitProperty('I can be at 21 Horton at 9', ROSTER)?.id, '21_horton');
    assert.equal(matchVisitProperty('the Stay at Rocky Neck place', ROSTER)?.id, '73_rocky_neck');
  });

  test('a sub-unit wins only when its own word is there', () => {
    assert.equal(matchVisitProperty('53 Rocky Neck', ROSTER)?.id, '53_rocky_neck');
    assert.equal(matchVisitProperty('53 rocky neck downstairs', ROSTER)?.id, '53_rocky_neck_2');
  });

  test('two homes is no home', () => {
    assert.equal(matchVisitProperty('20 Hammond and 20 Enon', ROSTER), null);
  });
});

const slip = (over: Partial<VisitSlipInput> & { id: string; title: string }): VisitSlipInput => ({
  category: 'maintenance',
  status: 'open',
  run_scope: 'pro',
  ...over,
});

describe('which slips the visit covers', () => {
  const slips: VisitSlipInput[] = [
    slip({ id: 'toilets', title: 'Upstairs toilets run and rock' }),
    slip({ id: 'valve', title: 'Master shower valve drips', run_scope: 'handyman' }),
    slip({ id: 'spigot', title: 'Spigot shutoffs', run_scope: null }),
    slip({ id: 'tp', title: 'Restock: toilet paper', category: 'inventory' }),
    slip({ id: 'window', title: 'Bedroom window will not latch' }),
    slip({ id: 'taken', title: 'Kitchen sink drain', status: 'scheduled', assigned_to_label: 'Vendor: 128 Plumbing', scheduled_date: '2026-10-30' }),
    slip({ id: 'done', title: 'Toilet seat', status: 'done' }),
    slip({ id: 'owner', title: 'Owner to approve a new water heater', owner_action_required: true }),
    slip({ id: 'desk', title: 'Update the toilet note in the listing', category: 'rising_tide' }),
  ];
  const chosen = chooseVisitSlips(slips, { category: 'plumbing', vendorName: 'Tom Mackey Plumbing' });
  const by = new Map(chosen.map((c) => [c.id, c]));

  test('a pro-lane slip about the trade is ticked', () => {
    assert.equal(by.get('toilets')?.ticked, true);
    assert.equal(by.get('toilets')?.lane, 'pro');
  });

  test('the trade\'s work in another lane is listed, not ticked', () => {
    assert.equal(by.get('valve')?.ticked, false);
    assert.equal(by.get('spigot')?.ticked, false);
    assert.equal(by.get('owner')?.ticked, false);
  });

  test('another trade\'s pro slip is listed, not ticked', () => {
    assert.equal(by.get('window')?.matchesTrade, false);
    assert.equal(by.get('window')?.ticked, false);
  });

  test('a slip someone else already has says who, and is not ticked', () => {
    assert.equal(by.get('taken')?.ticked, false);
    assert.match(by.get('taken')?.note ?? '', /128 Plumbing.*Oct 30/);
  });

  test('restocks, desk work and closed slips never list', () => {
    for (const id of ['tp', 'desk', 'done']) assert.ok(!by.has(id), id);
  });

  test('ticked first', () => {
    assert.equal(chosen[0].id, 'toilets');
  });

  test('the label is the one the work-order "Mark scheduled" writes', () => {
    assert.equal(vendorSlipLabel(' Tom Mackey Plumbing '), 'Vendor: Tom Mackey Plumbing');
  });
});

describe('the night facts, from bookings and the mirror', () => {
  const facts = nightFactsFrom(
    [
      { check_in: '2026-10-20', check_out: '2026-10-22', status: 'confirmed' },
      { check_in: '2026-10-25', check_out: '2026-10-27', status: 'block', ical_uid: 'abc@guesty.com_x', hold_kind: null },
      // Guesty's advance-notice artifact is not a hold.
      { check_in: '2026-10-28', check_out: '2026-10-29', status: 'block', ical_uid: '6a0c1d_an_2026-10-28_2026-10-28@guesty.com_1' },
    ],
    [
      { date: '2026-10-23', status: 'unavailable', block_type: 'm', block_reason: 'Owner block', block_note: 'Owner use' },
      { date: '2026-10-24', status: 'booked', block_type: null },
    ],
    '2026-10-19',
    '2026-10-28',
  );
  test('a stay: arrival, guest nights, departure', () => {
    assert.deepEqual(facts.get('2026-10-20'), { guest: true, arrival: true, departure: false, held: null, ownerHeld: false });
    assert.equal(facts.get('2026-10-21')?.guest, true);
    assert.deepEqual(facts.get('2026-10-22'), { guest: false, arrival: false, departure: true, held: null, ownerHeld: false });
  });
  test('holds, the owner\'s named', () => {
    assert.equal(facts.get('2026-10-23')?.ownerHeld, true);
    assert.ok(facts.get('2026-10-25')?.held);
    assert.equal(facts.get('2026-10-25')?.ownerHeld, false);
  });
  test('a night the mirror shows booked is a guest\'s even with no booking row', () => {
    assert.equal(facts.get('2026-10-24')?.guest, true);
  });
  test('an advance-notice artifact is an open night', () => {
    assert.deepEqual(facts.get('2026-10-28'), { guest: false, arrival: false, departure: false, held: null, ownerHeld: false });
  });
});

const OPEN: NightFact = { guest: false, arrival: false, departure: false, held: null, ownerHeld: false };

function plan(nights: Record<string, Partial<NightFact>>, over: Partial<HoldPlanInput> = {}) {
  const map = new Map<string, NightFact>();
  for (let d = '2026-10-26'; d <= '2026-10-29'; d = addDays(d, 1)) map.set(d, { ...OPEN, ...(nights[d] ?? {}) });
  return planVisitHold({
    start: '2026-10-27',
    end: '2026-10-27',
    time: { start: '13:00', end: null },
    nights: map,
    checkoutTime: '11:00',
    checkinTime: '16:00',
    holdNightBefore: false,
    vendorName: 'Tom Mackey Plumbing',
    windows: [{ start: '2026-10-26', end: '2026-10-29' }],
    ...over,
  });
}

describe('which nights the hold closes', () => {
  test('an open day: the night of the visit', () => {
    const p = plan({});
    assert.deepEqual(p.holdNights, ['2026-10-27']);
    assert.deepEqual(p.warnings, []);
    assert.equal(p.outsideOffer, false);
  });

  test('a guest arriving that afternoon: no hold, and the vendor must be done first', () => {
    const p = plan({ '2026-10-27': { guest: true, arrival: true } });
    assert.deepEqual(p.holdNights, []);
    assert.deepEqual(p.guestNights, ['2026-10-27']);
    assert.match(p.warnings.join(' '), /A guest arrives Tue Oct 27 at 4 PM: Tom Mackey Plumbing has to be done before then/);
  });

  test('a guest mid-stay: no hold, said plainly', () => {
    const p = plan({ '2026-10-27': { guest: true } });
    assert.deepEqual(p.holdNights, []);
    assert.match(p.warnings.join(' '), /A guest is in the house the night of Tue Oct 27/);
  });

  test('an owner hold is left alone and named', () => {
    const p = plan({ '2026-10-27': { held: 'the calendar is blocked that night (Owner use)', ownerHeld: true } });
    assert.deepEqual(p.holdNights, []);
    assert.equal(p.alreadyHeld.length, 1);
    assert.match(p.warnings.join(' '), /The owner has the home Tue Oct 27/);
  });

  test('a guest leaving that morning, and the vendor coming before checkout', () => {
    const p = plan({ '2026-10-26': { guest: true }, '2026-10-27': { departure: true } }, { time: { start: '09:00', end: null } });
    assert.deepEqual(p.holdNights, ['2026-10-27']);
    assert.match(p.warnings.join(' '), /A guest checks out Tue Oct 27 at 11 AM; Tom Mackey Plumbing comes at 9 AM/);
    assert.equal(p.nightBefore.offered, false, 'the night before is a guest\'s');
  });

  test('an early arrival with the night before open: offered, suggested, and held only when ticked', () => {
    const early = { time: { start: '08:00', end: null } };
    assert.deepEqual(plan({}, early).nightBefore, { date: '2026-10-26', offered: true, suggested: true });
    assert.deepEqual(plan({}, early).holdNights, ['2026-10-27']);
    assert.deepEqual(plan({}, { ...early, holdNightBefore: true }).holdNights, ['2026-10-26', '2026-10-27']);
  });

  test('no time given: the night before is offered, not suggested', () => {
    assert.deepEqual(plan({}, { time: { start: null, end: null } }).nightBefore, { date: '2026-10-26', offered: true, suggested: false });
  });

  test('an afternoon visit does not offer the night before', () => {
    assert.equal(plan({}).nightBefore.offered, false);
    assert.deepEqual(plan({}, { holdNightBefore: true }).holdNights, ['2026-10-27'], 'a tick cannot add a night that was not offered');
  });

  test('a multi-day visit holds each open night and skips the rest', () => {
    const p = plan({ '2026-10-28': { held: 'the calendar is blocked that night' } }, { end: '2026-10-29' });
    assert.deepEqual(p.holdNights, ['2026-10-27', '2026-10-29']);
  });

  test('a night the calendar did not answer for is never held', () => {
    const map = new Map<string, NightFact>([['2026-10-26', OPEN]]);
    const p = planVisitHold({ start: '2026-10-27', end: '2026-10-27', time: { start: null, end: null }, nights: map, checkoutTime: '11:00', checkinTime: '16:00', holdNightBefore: false, vendorName: 'V', windows: [] });
    assert.deepEqual(p.holdNights, []);
    assert.match(p.warnings.join(' '), /could not be read/);
    assert.equal(p.outsideOffer, null);
  });

  test('outside the windows we offered', () => {
    const p = plan({}, { windows: [{ start: '2026-11-02', end: '2026-11-12' }] });
    assert.equal(p.outsideOffer, true);
    assert.match(p.warnings.join(' '), /outside the windows you offered/);
  });

  test('never a guest night, on any calendar', () => {
    // Deterministic pseudo-random calendars: whatever the mix of guests,
    // holds and open nights, and whatever the operator ticks, the plan
    // closes open nights only.
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 500; i++) {
      const map = new Map<string, NightFact>();
      for (let d = '2026-10-25'; d <= '2026-11-02'; d = addDays(d, 1)) {
        const r = rand();
        map.set(d, r < 0.35 ? { ...OPEN, guest: true, arrival: rand() < 0.3 } : r < 0.5 ? { ...OPEN, held: 'held', ownerHeld: rand() < 0.5 } : { ...OPEN, departure: rand() < 0.2 });
      }
      const start = addDays('2026-10-26', Math.floor(rand() * 4));
      const end = addDays(start, Math.floor(rand() * 4));
      const p = planVisitHold({
        start,
        end,
        time: { start: rand() < 0.5 ? '08:00' : null, end: null },
        nights: map,
        checkoutTime: '11:00',
        checkinTime: '16:00',
        holdNightBefore: rand() < 0.5,
        vendorName: 'V',
        windows: [],
      });
      for (const n of p.holdNights) {
        const f = map.get(n) as NightFact;
        assert.ok(!f.guest && !f.held, `held ${n} on calendar ${i}`);
      }
    }
  });
});

describe('the approve gate', () => {
  const ok = { propertyId: '73_rocky_neck', start: '2026-10-27', end: '2026-10-27', startTime: '13:00', endTime: null, slipIds: [], holdNightBefore: false };
  test('a complete input passes', () => {
    assert.equal(checkApproveInput(ok, '2026-10-18'), null);
  });
  test('no home, no day, a past day, too long, a bad time', () => {
    assert.match(checkApproveInput({ ...ok, propertyId: '' }, '2026-10-18') ?? '', /home/);
    assert.match(checkApproveInput({ ...ok, start: '', end: '' }, '2026-10-18') ?? '', /day/);
    assert.match(checkApproveInput(ok, '2026-10-28') ?? '', /has passed/);
    assert.match(checkApproveInput({ ...ok, end: '2026-11-12' }, '2026-10-18') ?? '', /at most 7 days/);
    assert.match(checkApproveInput({ ...ok, startTime: '1pm' }, '2026-10-18') ?? '', /clock time/);
  });
  test('only a pending card can be approved; a decided one is stale', () => {
    assert.equal(proposalGate({ status: 'pending' }), null);
    assert.deepEqual(proposalGate({ status: 'approved' }), { stale: true, reason: 'This card was already decided.' });
    assert.deepEqual(proposalGate({ status: 'superseded' }), { stale: true, reason: 'This card was already decided.' });
    assert.equal(proposalGate({ status: 'approving' })?.stale, false);
  });
});

describe('the note on the hold', () => {
  test('names the vendor and the card, and never reads as an owner stay', () => {
    const note = vendorVisitNote('0d4c2e9a-1111-2222-3333-444455556666', 'Owner Services Co');
    assert.equal(note, 'Helm vendor visit: Services Co (vv:0d4c2e9a)');
    assert.equal(isOwnerNight({ block_type: 'm', block_reason: 'Maintenance', block_note: note }), false);
  });
});
