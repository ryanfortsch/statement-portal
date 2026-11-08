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
