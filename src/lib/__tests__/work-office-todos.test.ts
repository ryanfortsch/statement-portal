/**
 * Slips and office to-dos: two tables, one way of working.
 *
 * The UI/UX audit of 2026-10-17 found task and slip were two parallel
 * systems that looked like one: different priority scales (the bulk bar
 * quietly rewrote Normal to "medium" for tasks), different status sets,
 * a task page that saved nothing until "Save changes" while a slip saves
 * each field on its own, "Archived" as a status a person could pick and
 * never find again, and nothing on any page saying which one to file.
 *
 * Phase 3 kept the tables and made the difference one sentence: a slip
 * belongs to a house, an office to-do does not. Each guard below holds a
 * choice made in a different file, so this reads the source and asserts
 * each one is still there.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  OFFICE_TODOS_LABEL,
  OFFICE_TODO_LABEL,
  TASK_CLOSED_STATUSES,
  TASK_PICKER_STATUSES,
  TASK_STATUS_LABELS,
  WORK_PRIORITIES,
  WORK_PRIORITY_LABELS,
} from '../work-types.ts';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

/** Comments say what used to be true; only the code has to be clean. */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const WORK_FILES = [
  'src/app/work/QueueClient.tsx',
  'src/app/work/actions.ts',
  'src/app/work/tasks/[id]/TaskDetail.tsx',
  'src/lib/work-types.ts',
];

describe('one priority scale', () => {
  test('slips and to-dos share Low / Normal / High', () => {
    assert.deepEqual(WORK_PRIORITIES, ['low', 'normal', 'high']);
    assert.deepEqual(WORK_PRIORITIES.map((p) => WORK_PRIORITY_LABELS[p]), ['Low', 'Normal', 'High']);
    const types = read('src/lib/work-types.ts');
    assert.match(types, /export type WorkSlipPriority = WorkPriority;/);
    assert.match(types, /export type TaskPriority = WorkPriority;/);
  });

  test('no Work code writes or offers "medium"', () => {
    for (const f of WORK_FILES) {
      assert.ok(!/['"]medium['"]/.test(code(read(f))), `${f} still says 'medium'`);
    }
    assert.match(read('src/app/work/actions.ts'), /priority: args\.priority \?\? 'normal'/);
  });

  test('the migration adds normal after medium, so high still sorts first', () => {
    const files = readdirSync(new URL('../../../supabase/migrations/', import.meta.url));
    const add = files.find((f) => f.endsWith('_task_priority_normal.sql'));
    const rows = files.find((f) => f.endsWith('_task_priority_normal_rows.sql'));
    assert.ok(add && rows, 'both halves of the task priority migration are checked in');
    assert.ok(add! < rows!, 'the enum value is added before the rows use it');
    assert.match(read(`supabase/migrations/${add}`), /add value if not exists 'normal' after 'medium'/);
    const rewrite = read(`supabase/migrations/${rows}`);
    assert.match(rewrite, /set default 'normal'/);
    assert.match(rewrite, /set priority = 'normal' where priority = 'medium'/);
  });
});

describe('an office to-do is closed the way a slip is', () => {
  test('the status chips offer no closed state; Wrap up closes', () => {
    for (const s of TASK_CLOSED_STATUSES) assert.ok(!TASK_PICKER_STATUSES.includes(s), `${s} is a pickable status`);
    assert.equal(TASK_STATUS_LABELS.archived, 'Dismissed');
    const page = code(read('src/app/work/tasks/[id]/TaskDetail.tsx'));
    assert.ok(page.includes('TASK_PICKER_STATUSES.map'), 'the status chips render the picker list');
    assert.ok(!/<option value="archived"/.test(page), 'Archived is not an option');
    assert.ok(page.includes("'Mark Done'"), 'Mark Done is on the page');
    assert.ok(/saveField\('status', TASK_DISMISSED_STATUS\)/.test(page), 'Dismiss writes the dismissed status');
  });

  test('every field saves on its own; there is no form-wide save', () => {
    const page = code(read('src/app/work/tasks/[id]/TaskDetail.tsx'));
    assert.ok(!page.includes('Save changes'), 'the form-wide Save changes button is gone');
    assert.ok(!page.includes('<fieldset'), 'no fieldset wraps the fields into one form');
    for (const field of ['priority', 'status', 'due_date', 'assigned_to_email']) {
      assert.ok(page.includes(`saveField('${field}'`), `${field} saves on its own gesture`);
    }
    assert.ok(page.includes('DESCRIPTION_AUTOSAVE_MS'), 'the description saves as you type');
  });

  test('delete asks once, in words, on the page', () => {
    const page = code(read('src/app/work/tasks/[id]/TaskDetail.tsx'));
    const handler = page.slice(page.indexOf('function handleDelete()'), page.indexOf('const propertyNames'));
    assert.ok(handler.length > 0, 'handleDelete is where it was');
    assert.ok(!handler.includes('confirm('), 'no native confirm stands in front of delete');
    assert.ok(page.includes('This cannot be undone.'), 'the confirm says it is for good');
    assert.ok(page.includes('Delete for good'), 'the second tap is named');
  });

  test('comments carry short names and the back link restores the to-do tab', () => {
    const page = code(read('src/app/work/tasks/[id]/TaskDetail.tsx'));
    assert.ok(page.includes('displayNameForEmail(c.author_email)'), 'comments print the short name');
    assert.ok(/<BackToBoardLink fallbackHref="\/work\?tab=tasks" tab="tasks"/.test(page));
  });
});

describe('the board says which is which', () => {
  test('the tab, the create button and the row tag say office to-do', () => {
    assert.equal(OFFICE_TODOS_LABEL, 'Office to-dos');
    assert.equal(OFFICE_TODO_LABEL, 'Office to-do');
    const board = code(read('src/app/work/QueueClient.tsx'));
    assert.ok(board.includes('label={OFFICE_TODOS_LABEL}'), 'the board tab is Office to-dos');
    assert.ok(!/label="Tasks"/.test(board), 'no tab called Tasks');
    assert.ok(board.includes('+ To-do'), 'the create button says To-do');
    assert.ok(read('src/components/ForMeFeed.tsx').includes("'Work slip' : OFFICE_TODO_LABEL"), 'the home feed tags a to-do as one');
  });

  test('a new to-do asks for no house', () => {
    const board = code(read('src/app/work/QueueClient.tsx'));
    const modal = board.slice(board.indexOf('function TaskModal('), board.indexOf('function ModalShell('));
    assert.ok(modal.length > 0, 'TaskModal is where it was');
    for (const gone of ['Scope', 'Properties', 'Hold ⌘', 'Tags']) {
      assert.ok(!modal.includes(gone), `the to-do form still asks for ${gone}`);
    }
  });

  test('the bulk bar refuses a mixed selection instead of mapping values', () => {
    const board = code(read('src/app/work/QueueClient.tsx'));
    const run = board.slice(board.indexOf('function runBulk('), board.indexOf('const propertyMap'));
    assert.ok(/if \(slipIds\.length > 0 && taskIds\.length > 0\) return;/.test(run), 'runBulk stops on a mixed selection');
    assert.ok(!run.includes("=== 'normal' ?"), 'no priority is rewritten on the way to tasks');
    assert.ok(board.includes('Pick slips or office to-dos, not both.'), 'the bar says why in one line');
  });
});
