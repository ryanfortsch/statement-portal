/**
 * Unticking "Statement sent" unfreezes a statement, and it has one door.
 *
 * close_tasks.email_sent_at is what every payout writer reads before it
 * moves an owner's numbers (statement-finality.ts). #1439 built the audited
 * way to clear it, unmarkStatementSentAction, which files a post_send_write
 * flag on the statement before clearing, and then never called it: the
 * checkbox kept going through the bare close-task upsert, so one unlogged
 * click disarmed every guard. That upsert also sent the tab's whole copy of
 * the row, so a tick on ANY close-out box in a stale tab could write a sent
 * statement's stamp back to null.
 *
 * The first half tests the write shape. The rest reads the source, the way
 * shoot-offer-optin.test.ts does, because what has to stay put is which
 * function one checkbox calls: one line in a 4,800-line page, and losing it
 * compiles cleanly and looks like it works.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closeTaskPatchRow, closeTaskWriteRefusal } from '../close-task-write.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

/** One block of source: from the line holding `opener` to its closing brace at the same indent. */
function block(src: string, opener: string): string {
  const start = src.indexOf(opener);
  assert.ok(start >= 0, `not found: ${opener}`);
  const lineStart = src.lastIndexOf('\n', start) + 1;
  const indent = /^ */.exec(src.slice(lineStart, start))![0];
  const end = src.indexOf(`\n${indent}}\n`, start);
  assert.ok(end > start, `no closing brace for: ${opener}`);
  return src.slice(start, end);
}

/** The argument text of every call to `fn`, matched by balanced parentheses. */
function callsTo(src: string, fn: string): string[] {
  const out: string[] = [];
  for (let at = src.indexOf(`${fn}(`); at >= 0; at = src.indexOf(`${fn}(`, at + 1)) {
    let depth = 0;
    let i = at + fn.length;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')' && --depth === 0) break;
    }
    out.push(src.slice(at + fn.length + 1, i));
  }
  return out;
}

const PERIOD = 'period-uuid';
const PROPERTY = '21_horton';
const STAMP = '2026-09-26T14:00:00.000Z';

describe('a close-out tick writes only what it changed', () => {
  test('the row is its keys plus the changed field, nothing else', () => {
    assert.deepEqual(
      closeTaskPatchRow(PERIOD, PROPERTY, { owner_transfer_done_at: STAMP }),
      { owner_transfer_done_at: STAMP, period_id: PERIOD, property_id: PROPERTY },
    );
  });

  test('a stale tab cannot carry the sent stamp or the Drive link along with another tick', () => {
    const otherTicks: Record<string, unknown>[] = [
      { email_template: 'touch_base' },
      { email_include_work_slips: true },
      { email_include_handled: false },
      { email_drafted_at: null },
      { owner_transfer_done_at: STAMP },
      { mgmt_sweep_done_at: null },
    ];
    for (const patch of otherTicks) {
      const row = closeTaskPatchRow(PERIOD, PROPERTY, patch);
      const field = Object.keys(patch)[0];
      assert.ok(!('email_sent_at' in row), `a ${field} tick carried email_sent_at`);
      assert.ok(!('statement_drive_url' in row), `a ${field} tick carried statement_drive_url`);
    }
  });

  test('an unset field is left out, not sent', () => {
    assert.deepEqual(
      closeTaskPatchRow(PERIOD, PROPERTY, { email_sent_at: undefined, notes: 'n' }),
      { notes: 'n', period_id: PERIOD, property_id: PROPERTY },
    );
  });

  test('a patch cannot point the write at another row', () => {
    const row = closeTaskPatchRow(PERIOD, PROPERTY, { period_id: 'other', property_id: '3_south_st', notes: 'n' });
    assert.equal(row.period_id, PERIOD);
    assert.equal(row.property_id, PROPERTY);
  });
});

describe('the bare upsert cannot unfreeze', () => {
  test('clearing the sent stamp is refused', () => {
    for (const cleared of [null, '', undefined]) {
      assert.ok(
        closeTaskWriteRefusal({ period_id: PERIOD, property_id: PROPERTY, email_sent_at: cleared }),
        `email_sent_at: ${String(cleared)} went through the bare upsert`,
      );
    }
  });

  test('stamping it, and clearing any other box, goes through', () => {
    for (const fields of [
      { email_sent_at: STAMP },
      { owner_transfer_done_at: null },
      { mgmt_sweep_done_at: null },
      { email_drafted_at: null },
      { email_template: 'monthly' },
    ]) {
      assert.equal(closeTaskWriteRefusal({ period_id: PERIOD, property_id: PROPERTY, ...fields }), null);
    }
  });
});

describe('the checkbox goes through the audited door', () => {
  const page = read('src/app/statements/page.tsx');
  const actions = read('src/app/statements/actions.ts');

  test('the Statement sent box is wired to markStatementSent', () => {
    assert.match(
      page,
      /label="Statement sent"\s*done=\{!!task\?\.email_sent_at\}\s*onToggle=\{\(next\) => markStatementSent\(p, next\)\}/,
      'the "Statement sent" checkbox no longer goes through markStatementSent',
    );
  });

  test('unticking confirms, then calls unmarkStatementSentAction', () => {
    const untick = block(block(page, 'async function markStatementSent('), 'if (!next) {');
    const asked = untick.indexOf('confirm(');
    const unmarked = untick.indexOf('unmarkStatementSentAction(');
    assert.ok(unmarked >= 0, 'the untick no longer calls unmarkStatementSentAction: unfreezing would leave no trace');
    assert.ok(asked >= 0 && asked < unmarked, 'the untick must confirm before it unfreezes');
    assert.ok(!untick.includes('saveCloseTaskField('), 'the untick goes through saveCloseTaskField, the path with no audit row');
    // Local state follows the server's answer, never leads it.
    assert.ok(
      untick.indexOf('.ok)') >= 0 && untick.indexOf('.ok)') < untick.indexOf('setCloseTasks('),
      'the untick updates local state before it knows the unmark landed',
    );
  });

  test('nothing on the page clears the sent stamp through saveCloseTaskField', () => {
    const sentWrites = callsTo(page, 'saveCloseTaskField').filter(args => args.includes('email_sent_at'));
    assert.ok(sentWrites.length > 0, 'expected the tick-on stamp to go through saveCloseTaskField');
    for (const args of sentWrites) {
      assert.match(args, /email_sent_at:\s*new Date\(\)\.toISOString\(\)/, `saveCloseTaskField(${args}) can clear the stamp`);
    }
  });

  test('close-out saves write the patch, not the tab copy of the row, and say when they fail', () => {
    const upserts = callsTo(page, 'upsertCloseTask');
    assert.ok(upserts.length > 0, 'expected saveCloseTaskField to call upsertCloseTask');
    for (const args of upserts) {
      assert.ok(args.startsWith('closeTaskPatchRow('), `upsertCloseTask(${args}) writes more than the changed field`);
    }
    assert.ok(block(page, 'async function saveCloseTaskField(').includes('alert('), 'a failed close-out save is silent again');
  });

  test('the upsert refuses the clear and returns its error', () => {
    const upsert = block(actions, 'export async function upsertCloseTask(');
    assert.ok(upsert.includes('closeTaskWriteRefusal('), 'upsertCloseTask no longer refuses to clear email_sent_at');
    assert.ok(!upsert.includes('Promise<void>'), 'upsertCloseTask returns nothing again: a failed tick would look saved');
    assert.match(upsert, /const \{ error \} = await supabaseAdmin\.from\('close_tasks'\)\.upsert\(/, 'the upsert error is dropped again');
  });

  test('the audited door files its flag before it clears, and never blind-upserts', () => {
    const unmark = block(actions, 'export async function unmarkStatementSentAction(');
    const flagged = unmark.indexOf(".from('data_gaps').insert(");
    const cleared = unmark.indexOf('.update({ email_sent_at: null })');
    assert.ok(flagged >= 0 && cleared >= 0 && flagged < cleared, 'the audit flag must be written before the stamp is cleared');
    assert.ok(!unmark.includes('.upsert('), 'an upsert here would blank the sibling stamps');
  });
});
