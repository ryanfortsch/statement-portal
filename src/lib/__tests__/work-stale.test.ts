/**
 * The Work board: a staff login opens on its own week, and owners can review
 * slips nobody has touched in 90 days (src/lib/work-stale.ts,
 * src/lib/work-board-view.ts). The review is an owner decision: nothing here
 * closes a slip on its own, and the guards at the bottom keep it that way.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { STALE_SLIP_DAYS, groupStaleSlips, isSlipStale, slipLastTouchDay, type StaleCandidate } from '../work-stale.ts';
import { defaultWorkFilter, workMyWeek, workThisWeek } from '../work-board-view.ts';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const TODAY = '2026-10-18';

function slip(over: Partial<StaleCandidate> = {}): StaleCandidate {
  return {
    id: 's1',
    property_id: '21_horton',
    status: 'open',
    created_at: '2026-06-01T14:00:00Z',
    claimed_at: null,
    snoozed_at: null,
    snoozed_until: null,
    owner_last_contacted_at: null,
    last_verified_open_at: null,
    scheduled_date: null,
    ...over,
  };
}

describe('what a person touching a slip looks like', () => {
  test('filed in June and never touched since: stale', () => {
    assert.equal(STALE_SLIP_DAYS, 90);
    assert.equal(isSlipStale(slip(), TODAY), true);
  });
  test('the window edge: 90 days back is not yet stale, 91 is', () => {
    // 2026-07-20 is exactly 90 days before 2026-10-18
    assert.equal(isSlipStale(slip({ created_at: '2026-07-20T14:00:00Z' }), TODAY), false);
    assert.equal(isSlipStale(slip({ created_at: '2026-07-19T14:00:00Z' }), TODAY), true);
  });
  test('a comment, a claim, a snooze, an owner email or a verify each count', () => {
    const recent = '2026-10-01T12:00:00Z';
    assert.equal(isSlipStale(slip(), TODAY, { lastCommentAt: recent }), false, 'comment');
    for (const k of ['claimed_at', 'snoozed_at', 'owner_last_contacted_at', 'last_verified_open_at'] as const) {
      assert.equal(isSlipStale(slip({ [k]: recent }), TODAY), false, k);
    }
  });
  test('a scheduled date inside the window or ahead keeps it', () => {
    assert.equal(isSlipStale(slip({ scheduled_date: '2026-11-02' }), TODAY), false);
    assert.equal(isSlipStale(slip({ scheduled_date: '2026-09-01' }), TODAY), false);
    assert.equal(isSlipStale(slip({ scheduled_date: '2026-05-01' }), TODAY), true);
  });
  test('updated_at is not a person: a machine write never refreshes a slip', () => {
    const withMachineWrite = { ...slip(), updated_at: '2026-10-14T09:00:00Z' } as StaleCandidate;
    assert.equal(slipLastTouchDay(withMachineWrite), '2026-06-01');
  });
});

describe('never stale', () => {
  test('in progress, scheduled, done or dismissed', () => {
    for (const status of ['in_progress', 'scheduled', 'done', 'dismissed']) {
      assert.equal(isSlipStale(slip({ status }), TODAY), false, status);
    }
  });
  test('riding a live Field packet', () => {
    assert.equal(isSlipStale(slip(), TODAY, { onLivePacket: true }), false);
  });
  test('snoozed to a later day', () => {
    assert.equal(isSlipStale(slip({ snoozed_until: '2026-12-01' }), TODAY), false);
  });
});

describe('groupStaleSlips', () => {
  test('by home in the order given, oldest touch first, fresh slips left out', () => {
    const groups = groupStaleSlips(
      [
        slip({ id: 'a', property_id: 'b_home', created_at: '2026-05-01T12:00:00Z' }),
        slip({ id: 'b', property_id: 'a_home', created_at: '2026-04-01T12:00:00Z' }),
        slip({ id: 'c', property_id: 'b_home', created_at: '2026-03-01T12:00:00Z' }),
        slip({ id: 'd', property_id: 'a_home', created_at: '2026-10-10T12:00:00Z' }),
      ],
      TODAY,
      { lastCommentAt: () => null, onLivePacket: () => false },
    );
    assert.deepEqual(groups.map((g) => g.propertyId), ['a_home', 'b_home']);
    assert.deepEqual(groups[1].slips.map((s) => s.id), ['c', 'a']);
    assert.deepEqual(groups[0].slips.map((s) => s.id), ['b']);
  });
});

describe('My week, and who opens on it', () => {
  const mine = { status: 'open' as const, priority: 'normal' as const, created_at: '2026-10-01', assigned_to_email: 'delaney@risingtidestr.com' };
  test("mine and due this week: the home tile's rule (work-week.ts), overdue included, undated is backlog", () => {
    assert.equal(workMyWeek({ ...mine, scheduled_date: '2026-10-10' }, mine.assigned_to_email, TODAY), true, 'overdue');
    assert.equal(workMyWeek({ ...mine, scheduled_date: '2026-10-24' }, mine.assigned_to_email, TODAY), true, 'sixth day out');
    assert.equal(workMyWeek({ ...mine, scheduled_date: '2026-10-25' }, mine.assigned_to_email, TODAY), false, 'next week');
    assert.equal(workMyWeek({ ...mine, scheduled_date: null }, mine.assigned_to_email, TODAY), false, 'undated');
    assert.equal(workThisWeek({ ...mine, due_date: '2026-10-19' }, TODAY), true, 'a task due tomorrow');
  });
  test('not mine is never on my week, and no session has no week', () => {
    assert.equal(workMyWeek({ ...mine, scheduled_date: TODAY }, 'ryan@risingtidestr.com', TODAY), false);
    assert.equal(workMyWeek({ ...mine, assigned_to_email: null, scheduled_date: TODAY }, '', TODAY), false);
  });
  test('the board and the home tile read one week', () => {
    const view = read('src/lib/work-board-view.ts');
    assert.ok(view.includes("import { dueThisWeek } from './work-week.ts';"));
    assert.ok(view.includes('return dueThisWeek(workDate(item), today);'));
    const home = read('src/app/page.tsx');
    assert.ok(home.includes('workWeekEnd(today)'), 'the home tile counts with work-week.ts');
  });
  test('a staff login opens on My week, an owner on All', () => {
    assert.equal(defaultWorkFilter('staff'), 'my-week');
    assert.equal(defaultWorkFilter('owner'), 'all');
    assert.equal(defaultWorkFilter(null), 'all');
  });
});

describe('an owner decision, not a cron', () => {
  test('both actions are owner-only and the dismiss re-applies the rule', () => {
    const src = read('src/app/work/organize-actions.ts');
    const load = src.slice(src.indexOf('export async function loadStaleSlips'), src.indexOf('export async function dismissStaleSlips'));
    const dismiss = src.slice(src.indexOf('export async function dismissStaleSlips'));
    assert.ok(load.includes('await ownerOrError()') && dismiss.includes('await ownerOrError()'));
    assert.ok(src.includes('return { email: await requireOwnerEmail() };'));
    assert.ok(dismiss.indexOf('isSlipStale(') > 0 && dismiss.indexOf('isSlipStale(') < dismiss.indexOf(".update({ status: 'dismissed'"));
    assert.ok(dismiss.includes(".eq('status', 'open')"), 'a slip someone picked up meanwhile is not closed');
  });
  test('no cron dismisses slips', () => {
    const cronDir = new URL('../../app/api/cron/', import.meta.url);
    for (const d of readdirSync(cronDir)) {
      let src = '';
      try { src = readFileSync(new URL(`${d}/route.ts`, cronDir), 'utf8'); } catch { continue; }
      assert.ok(!src.includes('dismissStaleSlips') && !src.includes('work-stale'), `${d} must not sweep slips`);
    }
  });
  test('the board: role default from the page, the menu entry only for owners, the total in the header', () => {
    const page = read('src/app/work/page.tsx');
    assert.ok(page.includes('defaultFilter={defaultWorkFilter(role)}'));
    assert.ok(page.includes("isOwner={role === 'owner'}"));
    const client = read('src/app/work/QueueClient.tsx');
    assert.ok(client.includes('<OrganizeButton onReviewStale={isOwner ? openStaleReview : undefined} />'));
    assert.ok(client.includes('if (nextFilter === defaultFilter) params.delete'), 'All on a staff login is spelled out in the URL');
    assert.ok(client.includes('of {onSlips ? workSlips.length : tasks.length} shown'));
  });
});
