/**
 * Operator copy prints the house date ("Fri, Oct 16"), never a raw ISO day
 * (walk of 2026-10-18: the packet page's "before 2026-10-16 check-in", the
 * cleaner-schedule proposals' "until 2026-10-18"). Reads each renderer's
 * source for the pattern that printed the raw day.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

test('the packet page stop line', () => {
  const page = read('src/app/fieldwork/packets/[id]/page.tsx');
  assert.ok(!page.includes('`before ${s.next_checkin'), 'the stop line prints the raw check-in day again');
  assert.ok(!page.includes('`after ${s.prior_checkout'), 'the stop line prints the raw checkout day again');
  assert.ok(page.includes('houseDay(s.next_checkin)') && page.includes('houseDay(s.prior_checkout)'));
});

test('the cleaner-schedule proposals, in both places they print', () => {
  for (const p of ['src/app/turnovers/schedule/page.tsx', 'src/app/cleaner-messaging/ScheduleDigestCard.tsx']) {
    const src = read(p);
    assert.ok(!src.includes('`until ${p.adjusted_check_out}`'), `${p} prints the raw adjusted checkout`);
    assert.ok(src.includes('`until ${houseDay(p.adjusted_check_out)}`'), p);
  }
  assert.ok(!read('src/app/turnovers/schedule/page.tsx').includes('(stay {p.stay_check_in}'));
});

test('the reminders panels and the booking record header', () => {
  const panel = read('src/components/ProactiveRemindersPanel.tsx');
  assert.ok(!panel.includes('`runs until ${r.end_date}`'));
  const guest = read('src/app/messaging/RemindersSection.tsx');
  assert.ok(!guest.includes('here until {r.check_out}'));
  assert.ok(!guest.includes('{r.check_in}→{r.check_out}'));
  const booking = read('src/app/channels/bookings/[id]/page.tsx');
  assert.ok(!booking.includes('description={`${booking.check_in} to ${booking.check_out}'));
});

test('the Work board, the Channels inquiry rows and the Forecast banner (walk of 2026-10-18)', () => {
  const board = read('src/app/work/QueueClient.tsx');
  assert.ok(!board.includes('`Due ${task.due_date}`'), 'an Office to-do prints its raw due date again');
  assert.ok(!board.includes('`Scheduled ${slip.scheduled_date}`'), 'a slip prints its raw scheduled date again');
  assert.ok(board.includes('`Due ${houseDay(task.due_date)}`'));
  const channels = read('src/app/channels/page.tsx');
  assert.ok(!channels.includes('{b.check_in} → {b.check_out}'), 'a Channels row prints the raw ISO range again');
  assert.ok(channels.includes('houseRange(b.check_in, b.check_out)'));
  const forecast = read('src/app/forecast/page.tsx');
  assert.ok(!forecast.includes('<strong>{operatingLatestDate}</strong>'), 'the Action needed banner prints the raw date again');
  assert.ok(forecast.includes('houseDay(operatingLatestDate)') && forecast.includes('houseDay(latestDate)'));
});

test('/cost-analysis lands on Actuals once /forecast has streamed in', () => {
  assert.ok(read('src/app/cost-analysis/page.tsx').includes("redirect('/forecast#actuals')"));
  assert.ok(read('src/app/forecast/ActualsSection.tsx').includes('id="actuals"'));
  assert.ok(read('src/app/forecast/page.tsx').includes('<HashOpenScript />'), 'nothing scrolls to #actuals after the skeleton');
});
