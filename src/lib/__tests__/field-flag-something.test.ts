import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canFlagAnyHome } from '../field-types.ts';

// One "Flag something" form on the contractor portal (audit Phase 3, Field):
// it replaced /field/report and the property board's own filing form, which
// were two doors with two gates (and only one of them idempotent) to the
// same work slip.

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test('the board grant opens any home only on an account that can use it', () => {
  const base = { status: 'active' as const, agreement_signed_at: '2026-10-01', w9_on_file: true };
  assert.equal(canFlagAnyHome({ ...base, work_board_access: true }), true);
  assert.equal(canFlagAnyHome({ ...base, work_board_access: false }), false);
  assert.equal(canFlagAnyHome({ ...base, status: 'paused', work_board_access: true }), false);
  assert.equal(canFlagAnyHome({ ...base, w9_on_file: false, work_board_access: true }), false);
});

test('one door: the tab strip, the old route and the board all lead to /field/flag', () => {
  const nav = read('src/app/field/FieldNav.tsx');
  assert.ok(nav.includes("href: '/field/flag',") && nav.includes("label: 'Flag something',"));
  const shell = read('src/app/field/FieldShell.tsx');
  assert.ok(shell.includes('const showFlag = !!shellContractor && (!isCreative || showPropertyWork);'));
  assert.ok(read('src/app/field/report/page.tsx').includes("redirect('/field/flag')"));
  const board = read('src/app/field/property-work/page.tsx');
  assert.ok(board.includes('href="/field/flag"'), 'the board links the one form');
  assert.doesNotMatch(read('src/app/field/property-work/BoardControls.tsx'), /createBoardSlip|BoardNewSlip/);
  assert.doesNotMatch(read('src/app/field/actions.ts'), /export async function createBoardSlip/, 'the unguarded filing action is gone');
  assert.doesNotMatch(read('src/app/field/page.tsx'), /\/field\/report/);
});

test('the server re-checks the window or the grant, and both paths keep the idempotency key', () => {
  const actions = read('src/app/field/actions.ts');
  const report = actions.slice(actions.indexOf('export async function reportFieldWorkSlip'), actions.indexOf('async function fileBoardFlag'));
  assert.ok(report.includes('const visits = await loadRecentVisits(contractor.id);'), 'the window is read on the server');
  assert.ok(report.includes('canFlagAnyHome(contractor)'), 'the grant is read on the server');
  assert.ok(report.indexOf('const prior = await findFieldReport(') < report.indexOf('loadRecentVisits'), 'a retry is answered before any gate');
  assert.ok(report.includes('id: submissionId,'), 'a visit report is keyed by its attempt');
  const board = actions.slice(actions.indexOf('async function fileBoardFlag'), actions.indexOf('/** Gate for the property-work board'));
  assert.ok(board.includes('id: args.submissionId,'), 'an any-home flag is keyed by its attempt too');
  assert.ok(board.includes('parseReceiptDollars(args.expenseRaw)'), 'its receipt takes the one cap');
});
