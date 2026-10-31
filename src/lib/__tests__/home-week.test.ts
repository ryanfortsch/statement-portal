import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  addDays,
  countLater,
  dayName,
  groupByDay,
  inWeek,
  weekEyebrow,
  weekWindow,
  workDay,
  workDateLabel,
  WEEK_DAYS,
} from '../home-week.ts';
import { workWeekEnd } from '../work-week.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

/** A Friday. The window runs through Thursday, Nov 5, across the month end
 *  and the end of daylight time (Nov 1, 2026). */
const TODAY = '2026-10-30';

describe('This week is seven days from today', () => {
  test('the window is today through the sixth day after', () => {
    assert.equal(WEEK_DAYS, 7);
    assert.deepEqual(weekWindow(TODAY), { from: '2026-10-30', to: '2026-11-05' });
    assert.equal(weekWindow(TODAY).to, workWeekEnd(TODAY), 'the same week as Open work · this week and the board');
    assert.ok(inWeek('2026-10-30', TODAY));
    assert.ok(inWeek('2026-11-05', TODAY));
    assert.ok(!inWeek('2026-11-06', TODAY));
    assert.ok(!inWeek('2026-10-29', TODAY));
    assert.ok(!inWeek(null, TODAY));
    assert.ok(inWeek('2026-11-05T09:00:00', TODAY), 'a timestamp reads as its day');
  });

  test('days cross a month end and the DST change without moving', () => {
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-10-30', 6), '2026-11-05');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-11-01', -1), '2026-10-31');
  });

  test('a day is Today, Tomorrow, then its weekday', () => {
    assert.equal(dayName('2026-10-30', TODAY), 'Today');
    assert.equal(dayName('2026-10-31', TODAY), 'Tomorrow');
    assert.equal(dayName('2026-11-01', TODAY), 'Sunday');
    assert.equal(dayName('2026-11-05', TODAY), 'Thursday');
  });

  test('the eyebrow says the count and the last day', () => {
    assert.equal(weekEyebrow(3, TODAY), '3 through Thu, Nov 5');
  });
});

describe('the list is day by day, in the order a day is lived', () => {
  const items = [
    { id: 'slip-later', kind: 'slip', date: '2026-11-06', time: null }, // past the window
    { id: 'task-sun', kind: 'task', date: '2026-11-01', time: null },
    { id: 'walk-sun', kind: 'walk', date: '2026-11-01', time: null },
    { id: 'mtg-sun-untimed', kind: 'meeting', date: '2026-11-01', time: null },
    { id: 'mtg-sun-3pm', kind: 'meeting', date: '2026-11-01', time: '15:00:00' },
    { id: 'mtg-sun-9am', kind: 'meeting', date: '2026-11-01', time: '09:30:00' },
    { id: 'slip-sun', kind: 'slip', date: '2026-11-01', time: null },
    { id: 'walk-today', kind: 'walk', date: '2026-10-30', time: null },
    { id: 'walk-yesterday', kind: 'walk', date: '2026-10-29', time: null }, // before the window
  ] as const;

  test('days ascend, empty days are left out, and what is outside the window is dropped', () => {
    const days = groupByDay([...items], TODAY);
    assert.deepEqual(days.map((d) => d.date), ['2026-10-30', '2026-11-01']);
    assert.deepEqual(days.map((d) => d.name), ['Today', 'Sunday']);
    assert.equal(days[0].isToday, true);
    assert.equal(days[1].isToday, false);
    assert.equal(days[0].dateText, 'Fri, Oct 30');
    assert.deepEqual(days[0].items.map((i) => i.id), ['walk-today']);
  });

  test('a clock first, then the walk, an untimed meeting, the to-do, the slip', () => {
    const sunday = groupByDay([...items], TODAY)[1];
    assert.deepEqual(
      sunday.items.map((i) => i.id),
      ['mtg-sun-9am', 'mtg-sun-3pm', 'walk-sun', 'mtg-sun-untimed', 'task-sun', 'slip-sun'],
    );
  });

  test('nothing this week is an empty list, not a day with nothing', () => {
    assert.deepEqual(groupByDay([{ kind: 'walk', date: '2026-11-20', time: null }], TODAY), []);
  });

  test('walks past the window are counted, never silently gone', () => {
    assert.equal(countLater([{ date: '2026-11-06' }, { date: '2026-11-20' }, { date: '2026-11-05' }, { date: null }], TODAY), 2);
  });
});

describe('which day a piece of work lands on', () => {
  test('a slip takes the earliest of its scheduled visit and its follow-up inside the window, and says which', () => {
    assert.deepEqual(workDay({ scheduled: '2026-11-03', followUp: '2026-11-02' }, TODAY), { date: '2026-11-02', kind: 'follow_up' });
    assert.deepEqual(workDay({ scheduled: '2026-11-01', followUp: '2026-11-02' }, TODAY), { date: '2026-11-01', kind: 'scheduled' });
  });

  test('a date already past does not pull the slip out of the week', () => {
    assert.deepEqual(workDay({ scheduled: '2026-10-20', followUp: '2026-11-04' }, TODAY), { date: '2026-11-04', kind: 'follow_up' });
  });

  test('no date this week means no day', () => {
    assert.equal(workDay({ scheduled: '2026-10-20', followUp: null }, TODAY), null);
    assert.equal(workDay({ due: '2026-11-12' }, TODAY), null);
    assert.equal(workDay({}, TODAY), null);
  });

  test('a to-do lands on its due date, and each clock has its word', () => {
    assert.deepEqual(workDay({ due: '2026-10-30' }, TODAY), { date: '2026-10-30', kind: 'due' });
    assert.equal(workDateLabel('due'), 'Due');
    assert.equal(workDateLabel('follow_up'), 'Follow up');
    assert.equal(workDateLabel('scheduled'), 'Scheduled');
  });
});

describe('the home feed renders This week through this module', () => {
  test('walks, meetings and dated work fold into one list; the two old cards are gone', () => {
    const feed = read('src/components/ForMeFeed.tsx');
    assert.ok(feed.includes('const weekDays = groupByDay(weekEntries, weekToday);'), 'grouped by day here');
    assert.ok(feed.includes('<ThisWeekDay key={d.date} day={d} />'), 'one block per day');
    assert.ok(feed.includes("...(workMode === 'assigned' ? workFiltered : []).flatMap("), 'the unassigned backlog is nobody\'s week');
    assert.ok(feed.includes('countLater(plannedWalks.map((w) => ({ date: w.plannedFor })), weekToday)'), 'walks past the window are counted');
    assert.ok(!feed.includes('title="Planned walks"'), 'no separate walks card');
    assert.ok(!feed.includes('title="Meetings"'), 'no separate meetings card');
  });

  test('meetings are read for the whole window, owners every one and staff their own', () => {
    const feed = read('src/components/ForMeFeed.tsx');
    assert.ok(feed.includes('loadMeetingCards(new Date(), { days: WEEK_DAYS })'), 'owners: every meeting, seven days');
    assert.ok(feed.includes('loadMeetingCards(new Date(), { createdBy: email, days: WEEK_DAYS })'), 'staff: the ones they logged, seven days');
    const meetings = read('src/lib/meetings.ts');
    assert.ok(meetings.includes('opts.days'), 'the loader takes the window');
  });
});
