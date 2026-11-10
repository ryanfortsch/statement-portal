import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RETIRED_WORK_FILTERS } from '../work-board-view.ts';

const board = readFileSync('src/app/work/QueueClient.tsx', 'utf8');

test('the More select holds four filters', () => {
  const select = board.slice(board.indexOf('aria-label="More work filters"'), board.indexOf('</select>'));
  const options = [...select.matchAll(/<option value="([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(options.sort(), ['blocked', 'no-coordinator', 'owner-action', 'snoozed']);
});

test('a retired filter URL maps to the view that covers it', () => {
  assert.deepEqual({ ...RETIRED_WORK_FILTERS }, { 'my-week': 'my-next', high: 'next', 'due-today': 'next' });
  assert.ok(board.includes('if (Object.hasOwn(RETIRED_WORK_FILTERS, value)) return RETIRED_WORK_FILTERS[value];'));
});

test('the views Home links to by name still light a pill', () => {
  const home = readFileSync('src/components/ForMeFeed.tsx', 'utf8') + readFileSync('src/components/HomeSignals.tsx', 'utf8');
  for (const id of ['mine', 'week', 'unclaimed', 'overdue']) {
    if (!home.includes(`/work?filter=${id}`)) continue;
    assert.ok(id === 'overdue' ? board.includes('label="Overdue"') : board.includes(`{ id: '${id}', label:`), id);
  }
});

test('Plan now shares the Organize watcher and says what it planned', () => {
  const rail = readFileSync('src/app/work/RunsRail.tsx', 'utf8');
  const code = rail.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(code.includes('usePassWatch()') && board.includes('usePassWatch()'), 'one watcher for both buttons');
  assert.ok(code.includes('await planPendingCount()'), 'the planner polls its own count');
  assert.ok(!/check back|triaging|no one decided/i.test(code), 'developer words are back');
  assert.ok(code.includes('`Planned ${runs(res.created)}.`'));
  assert.ok(code.includes("const HANDYMAN_LANE_HREF = '/work?filter=all&lane=handyman';"));
  assert.ok(!code.includes('Waiting for enough work or an empty day'), 'the backlog is one count, not a list of homes');
  assert.ok(board.includes('if (lane && slipLane(w) !== lane) return false;'), 'the board reads ?lane=');
});
