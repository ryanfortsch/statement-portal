/**
 * Channels, UX audit 2026-11-07 (appendix 04, findings 2, 4 and 6):
 * - the hub's Message handover link reads a per-home registry, not one house;
 * - a home has one calendar: the hub's, with Set a range under it, and the
 *   old per-home grid route only redirects there;
 * - the fleet index has one primary verb and no Upcoming list.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { messageHandoverHref } from '../message-handover.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const HUB = 'src/app/channels/[propertyId]/page.tsx';

test('the handover link is per home and stays owners only', () => {
  assert.equal(messageHandoverHref('65_calderwood'), '/channels/65_calderwood/message-preparation');
  assert.equal(messageHandoverHref('21_horton'), null);
  assert.equal(messageHandoverHref('constructor'), null, 'an Object.prototype key is not a home');
  const hub = read(HUB);
  assert.ok(!hub.includes("propertyId === '65_calderwood'"), 'the hub names one house again');
  assert.ok(hub.includes('{owner && handoverHref && <Link href={handoverHref}'), 'the handover link lost its owner gate');
});

test('a home has one calendar, on the hub', () => {
  const hub = read(HUB);
  assert.ok(!hub.includes('/calendar?month='), 'the hub links a second calendar');
  assert.ok(hub.includes('<CalendarRangeTools'), 'Set a range left the hub');
  // The calendar is a read surface: it is not folded behind the runbook.
  const at = hub.indexOf('<div id="calendar">');
  const before = hub.slice(hub.lastIndexOf('<section', at), at);
  assert.ok(!before.includes('runbook &&'), 'the hub calendar hides behind the cutover runbook again');
  const old = read('src/app/channels/[propertyId]/calendar/page.tsx');
  assert.ok(old.includes('redirect(') && old.includes('#calendar'), 'the old month grid route must redirect to the hub calendar');
  assert.ok(!old.includes('<PropertyMonthCalendar'), 'the old route renders a calendar again');
  const action = read('src/app/channels/calendar/calendar-actions.ts');
  assert.ok(action.includes('redirect(`/channels/${propertyId}?${q.toString()}#bulk`)'), 'Set a range lands back on the hub');
  for (const p of ['src/app/channels/page.tsx', 'src/app/channels/calendar/MultiCalendarGrid.tsx', 'src/app/channels/bookings/[id]/page.tsx', 'src/lib/cutover.ts']) {
    assert.ok(!/channels\/\$\{[^}]+\}\/calendar/.test(read(p)), `${p} still links the retired month grid`);
  }
});

test('the fleet index has one primary verb and no Upcoming list', () => {
  const page = read('src/app/channels/page.tsx');
  assert.equal(page.split('style={primaryButtonStyle}').length - 1, 1, 'one primary verb on /channels');
  assert.ok(page.includes('<Link href="/channels/calendar" style={primaryButtonStyle}>Multi-calendar'), 'Multi-calendar is the primary verb');
  assert.ok(!page.includes('UpcomingBlock') && !page.includes('listUpcomingBookings'), 'the Upcoming list came back');
  for (const block of ['<InquiriesBlock', '<ConflictsBlock', '<CoverageGrid', '<RecentRunsBlock']) {
    assert.ok(page.includes(block), `${block} left /channels`);
  }
});
