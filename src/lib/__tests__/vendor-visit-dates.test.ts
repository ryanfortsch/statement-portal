/**
 * Reading the day out of a trade vendor's text (docs/vendor-visit-holds.md).
 * The rule under every case: an unclear date is a question for the operator,
 * never a guess. 2026-10-18 is a Sunday.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { etDateOf, fmtClock, readOfferWindows, readVisitDate, readVisitTime, type VisitDateRead } from '../vendor-visit-dates.ts';

const TODAY = '2026-10-18';
// The text Dotti drafted for Tom Mackey Plumbing on 2026-10-18.
const OFFER =
  'Hi Tom, 73 Rocky Neck is open Wed 10/21 after 11 AM to Thu 10/22 by 3 PM; Mon 10/26 to Thu 10/29; or Mon 11/2 to Thu 11/12. Which works for the toilets and the shower valve?';
const WINDOWS = readOfferWindows(OFFER, TODAY);

function day(r: VisitDateRead): string {
  assert.equal(r.kind, 'date', `expected a day, got ${JSON.stringify(r)}`);
  const d = r as Extract<VisitDateRead, { kind: 'date' }>;
  return d.start === d.end ? d.start : `${d.start}..${d.end}`;
}

function asks(r: VisitDateRead): Extract<VisitDateRead, { kind: 'ask' }> {
  assert.equal(r.kind, 'ask', `expected a question, got ${JSON.stringify(r)}`);
  return r as Extract<VisitDateRead, { kind: 'ask' }>;
}

const withOffer = (text: string) => readVisitDate(text, { today: TODAY, windows: WINDOWS, hasOffer: true });
const cold = (text: string) => readVisitDate(text, { today: TODAY });

describe('our offer, read back as windows', () => {
  test('the drafted text is three windows, times and all', () => {
    assert.deepEqual(WINDOWS, [
      { start: '2026-10-21', end: '2026-10-22' },
      { start: '2026-10-26', end: '2026-10-29' },
      { start: '2026-11-02', end: '2026-11-12' },
    ]);
  });
});

describe('a day the vendor names', () => {
  test('"Tuesday 10/27 at 1 works" is Tue Oct 27 at 1 PM', () => {
    const r = withOffer('Tuesday 10/27 at 1 works');
    assert.equal(day(r), '2026-10-27');
    assert.deepEqual(r.kind === 'date' && r.time, { start: '13:00', end: null, label: 'at 1 PM' });
  });

  test('a later bare weekday refers back to the date it matches', () => {
    assert.equal(day(withOffer('Tuesday 10/27 at 1 works. See you Tuesday!')), '2026-10-27');
  });

  test('every way of writing the day', () => {
    assert.equal(day(cold('10/27')), '2026-10-27');
    assert.equal(day(cold('Oct 27th works for me')), '2026-10-27');
    assert.equal(day(cold('October 27')), '2026-10-27');
    assert.equal(day(cold('the 27th of October')), '2026-10-27');
    assert.equal(day(withOffer('the 27th at 9am')), '2026-10-27');
    assert.equal(day(withOffer('tomorrow at 8 works')), '2026-10-19');
    assert.equal(day(cold('10/27/26')), '2026-10-27');
    assert.equal(day(cold('Tue, Oct 27')), '2026-10-27');
    assert.equal(day(cold('10/27 (Tue) works')), '2026-10-27');
  });

  test('a January date written in October is next January', () => {
    assert.equal(day(cold('1/5 works')), '2027-01-05');
  });

  test('a weekday with no date: the coming one, unless the windows say otherwise', () => {
    assert.equal(day(cold('Tuesday works')), '2026-10-20', 'no offer: the coming Tuesday');
    assert.equal(day(withOffer('Thursday works')), '2026-10-22', 'the only Thursday we offered that is also the coming one');
    const q = asks(withOffer('Tuesday works'));
    assert.deepEqual(q.candidates, ['2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10'], 'Tuesday could be any of these: ask');
    assert.equal(q.reason, '"Tuesday" could be more than one Tuesday you offered');
  });

  test('a weekday named on that same weekday could be today or next week: ask', () => {
    const q = asks(readVisitDate('Sunday works', { today: TODAY }));
    assert.deepEqual(q.candidates, ['2026-10-18', '2026-10-25']);
  });

  test('"next Tuesday" is a question unless the windows settle it', () => {
    assert.deepEqual(asks(cold('next Tuesday at 1')).candidates, ['2026-10-20', '2026-10-27']);
  });
});

describe('a run of days', () => {
  test('ranges written every way', () => {
    assert.equal(day(withOffer('Tue and Wed 10/27-28')), '2026-10-27..2026-10-28');
    assert.equal(day(withOffer('10/27 to 10/29')), '2026-10-27..2026-10-29');
    assert.equal(day(withOffer('11/2-11/4 works')), '2026-11-02..2026-11-04');
    assert.equal(day(withOffer('Mon 10/26 through Wed 10/28')), '2026-10-26..2026-10-28');
    assert.equal(day(withOffer('10/27 and 10/28')), '2026-10-27..2026-10-28');
  });

  test('longer than one visit is a question', () => {
    assert.match(asks(withOffer('11/2 to 11/12 works')).reason, /longer than one visit/);
  });
});

describe('an unclear day is a question, never a guess', () => {
  test('the weekday and the date disagree: both readings are offered', () => {
    const q = asks(withOffer('Tuesday 10/28 at 1'));
    assert.match(q.reason, /Wednesday/);
    assert.deepEqual(q.candidates, ['2026-10-27', '2026-10-28']);
  });

  test('two days joined by "or"', () => {
    const q = asks(withOffer('10/27 or 10/28'));
    assert.deepEqual(q.candidates, ['2026-10-27', '2026-10-28']);
    assert.equal(q.reason, 'two or more days offered: Tue Oct 27 or Wed Oct 28');
  });

  test('a week, not a day', () => {
    const q = asks(withOffer('next week sometime'));
    assert.ok(q.dateless);
    assert.equal(q.reason, '"next week" names no day');
  });

  test('a yes with no day, after we offered several', () => {
    const q = asks(withOffer('Yes that works'));
    assert.ok(q.dateless);
    assert.equal(q.reason, 'a yes with no day named');
    assert.deepEqual(q.candidates, ['2026-10-21', '2026-10-26', '2026-11-02']);
  });

  test('a yes with no day, after we offered exactly one, is that day', () => {
    const one = readOfferWindows('Can you come Wed 10/21 after 11?', TODAY);
    assert.equal(day(readVisitDate('Sounds good', { today: TODAY, windows: one, hasOffer: true })), '2026-10-21');
  });

  test('more than six months out', () => {
    assert.match(asks(cold('6/1 works')).reason, /six months/);
  });
});

describe('not a visit at all', () => {
  test('a day turned down is dropped; the other day stands', () => {
    assert.equal(day(withOffer("can't do Tuesday, Wednesday 10/28 works")), '2026-10-28');
    assert.equal(day(withOffer("Tuesday 10/27 doesn't work but 10/28 does")), '2026-10-28');
  });

  test('every day turned down', () => {
    assert.deepEqual(withOffer("I can't do Tuesday"), { kind: 'none', why: 'declined' });
    assert.deepEqual(withOffer('10/27 is no good for me'), { kind: 'none', why: 'declined' });
  });

  test('"no problem" is not a refusal', () => {
    assert.equal(day(withOffer('no problem, 10/27 at 1:30 works')), '2026-10-27');
  });

  test('past days and past tense', () => {
    assert.deepEqual(withOffer('Invoice for 10/15 attached'), { kind: 'none', why: 'past' });
    assert.deepEqual(withOffer('I was there Tuesday'), { kind: 'none', why: 'past' });
    assert.deepEqual(withOffer('last Tuesday was fine'), { kind: 'none', why: 'past' });
  });

  test('no day and no yes', () => {
    assert.equal(withOffer('Running 10 min late').kind, 'none');
    assert.equal(withOffer('Ok let me check and get back to you').kind, 'none');
    assert.equal(withOffer('Ok').kind, 'none', 'an acknowledgement is not an acceptance');
    assert.equal(cold('sounds good').kind, 'none', 'a yes to nothing we offered');
    assert.equal(cold('Tuesday').kind, 'none', 'a bare weekday with no scheduling words and no offer');
  });

  test('numbers that are not dates', () => {
    assert.equal(withOffer('Text the 24/7 line if it leaks again').kind, 'none');
    assert.equal(withOffer('The 2nd floor toilet is fixed').kind, 'none');
    assert.equal(withOffer('That took 1/2 hour').kind, 'none');
  });

  test('"sun", "sat", "wed" and "mon" in lowercase are words, not days', () => {
    const q = asks(withOffer('the sun is out, see you tues at 1'));
    assert.ok(!q.candidates.includes('2026-10-25'), 'no Sunday read out of "sun"');
  });
});

describe('the time, the way a trade says it', () => {
  test('bare hours: 1 to 6 is afternoon, 7 to 11 is morning', () => {
    assert.equal(readVisitTime('at 1').start, '13:00');
    assert.equal(readVisitTime('at 6').start, '18:00');
    assert.equal(readVisitTime('at 7').start, '07:00');
    assert.equal(readVisitTime('at 11').start, '11:00');
    assert.equal(readVisitTime('around 12').start, '12:00');
  });

  test('am, pm, colons, qualifiers and ranges', () => {
    assert.deepEqual(readVisitTime('8am'), { start: '08:00', end: null, label: 'at 8 AM' });
    assert.deepEqual(readVisitTime('at 7:30'), { start: '07:30', end: null, label: 'at 7:30 AM' });
    assert.deepEqual(readVisitTime('after 11'), { start: '11:00', end: null, label: 'after 11 AM' });
    assert.deepEqual(readVisitTime('by 3pm'), { start: null, end: '15:00', label: 'by 3 PM' });
    assert.deepEqual(readVisitTime('between 10 and 12'), { start: '10:00', end: '12:00', label: '10 AM to noon' });
    assert.deepEqual(readVisitTime('first thing in the morning'), { start: null, end: '12:00', label: 'morning' });
    assert.equal(readVisitTime('noon works').start, '12:00');
  });

  test('a count is not a clock', () => {
    assert.equal(readVisitTime('at 2 toilets').start, null);
    assert.equal(readVisitTime('about 3 hours').start, null);
  });

  test('labels', () => {
    assert.equal(fmtClock('13:00'), '1 PM');
    assert.equal(fmtClock('12:00'), 'noon');
    assert.equal(fmtClock('09:30'), '9:30 AM');
  });
});

describe('Eastern dates', () => {
  test('an evening text in UTC is still the Eastern day it was sent', () => {
    assert.equal(etDateOf('2026-10-19T02:30:00Z'), '2026-10-18');
    assert.equal(etDateOf('2026-10-19T04:30:00Z'), '2026-10-19');
  });

  test('"tomorrow" is the day after the message, not after the server', () => {
    const sentSundayEvening = etDateOf('2026-10-19T01:00:00Z');
    assert.equal(day(readVisitDate('tomorrow at 9 works', { today: sentSundayEvening })), '2026-10-19');
  });
});
