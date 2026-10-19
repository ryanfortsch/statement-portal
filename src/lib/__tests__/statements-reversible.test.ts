/**
 * Reversibility on /statements is said and kept.
 *
 * About twenty native dialogs asked in twenty voices; Resolve, Not revenue
 * and Dismiss had no undo and left no trace on the page; ticking Withhold
 * Owner Reserve moved $2,000 on one click; Process & Upload replaced a
 * statement without saying so; Finalize warned about less than Draft All.
 * This reads the source, the way statement-unmark-sent.test.ts does,
 * because each of these is one line that compiles cleanly without it.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

/** Source with comments blanked, so a comment that names confirm() is not a call. */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** One block of source: from the line holding `opener` to its closing brace at the same indent. */
function block(src: string, opener: string): string {
  const start = src.indexOf(opener);
  assert.ok(start >= 0, `not found: ${opener}`);
  const lineStart = src.lastIndexOf('\n', start) + 1;
  const indent = /^ */.exec(src.slice(lineStart, start))![0];
  const end = src.indexOf(`\n${indent}}`, start);
  assert.ok(end > start, `no closing brace for: ${opener}`);
  return src.slice(start, end);
}

/** The ask({...}) call that guards a verb, found by its confirm label. */
function askFor(src: string, confirmLabel: string): string {
  const at = src.indexOf(`confirmLabel: '${confirmLabel}'`);
  assert.ok(at >= 0, `no confirm labelled "${confirmLabel}"`);
  const start = src.lastIndexOf('ask({', at);
  const end = src.indexOf('})', at);
  return src.slice(start, end);
}

const page = read('src/app/statements/page.tsx');

describe('one confirm style', () => {
  test('no native confirm, prompt or alert on the page or its card components', () => {
    for (const file of [
      'src/app/statements/page.tsx',
      'src/app/statements/upload/page.tsx',
      'src/components/BankDepositReview.tsx',
      'src/components/ReceiptCapture.tsx',
      'src/components/PeriodNotesCard.tsx',
      'src/components/CleaningEventCredit.tsx',
    ]) {
      const src = code(read(file));
      for (const native of [/(^|[^.\w])confirm\(/m, /(^|[^.\w])prompt\(/m, /(^|[^.\w])alert\(/m]) {
        assert.ok(!native.test(src), `${file} calls a native dialog (${native})`);
      }
    }
  });

  test('the modal is the app-wide one, mounted once in the root providers', () => {
    // Both pages ask through useConfirm(); the provider lives in Providers
    // (the root layout), so a second, page-level provider is not needed.
    assert.match(read('src/components/Providers.tsx'), /<ConfirmProvider>\{children\}<\/ConfirmProvider>/);
    assert.match(page, /const \{ ask[^}]*\} = useConfirm\(\);/);
    assert.match(read('src/app/statements/upload/page.tsx'), /const \{ ask \} = useConfirm\(\);/);
  });

  test('the freeze override asks through the page modal when given one', () => {
    const freeze = read('src/lib/freeze-confirm.ts');
    assert.match(freeze, /confirmOverride\(frozen\.error, ask\)/);
    // Every freeze-aware call on the page passes the modal.
    for (const call of page.match(/(jsonWithFreezeRetry|formWithFreezeRetry)\([\s\S]*?\);/g) || []) {
      assert.match(call, /, ask\);$/, `a freeze-aware call on the page uses the native confirm: ${call.slice(0, 80)}`);
    }
  });
});

describe('the irreversible verbs say so', () => {
  test('Remove from statement, Void and Replace statement carry "cannot be undone"', () => {
    assert.match(askFor(page, 'Remove from statement'), /irreversible: true/);
    assert.match(askFor(read('src/components/ReceiptCapture.tsx'), 'Void receipt'), /irreversible: true/);
    const upload = read('src/app/statements/upload/page.tsx');
    assert.match(upload, /confirmLabel: current\?\.exists === true \? 'Replace statement' : 'Process anyway',\s*tone: 'danger',\s*irreversible: true,/);
    assert.match(read('src/components/ConfirmDialog.tsx'), /This cannot be undone\./);
  });

  test('ticking Owner Reserve asks once and names the amount', () => {
    const row = block(page, 'function ReserveHoldbackRow(');
    const asked = row.indexOf('await ask({');
    const saved = row.indexOf('void persist(amt)');
    assert.ok(asked >= 0 && saved > asked, 'the reserve tick saves before it asks');
    assert.match(row, /title: `Withhold \$\{fmt\(amt\)\} from/);
  });

  test('Finalize warns with the same list Draft All does', () => {
    assert.match(block(page, 'async function draftAll('), /const problems = monthProblems\(\);/);
    const finalize = page.slice(page.indexOf("title: `Finalize ${monthLong(selectedMonth)}?`") - 900, page.indexOf("title: `Finalize ${monthLong(selectedMonth)}?`"));
    assert.match(finalize, /const problems = monthProblems\(\);/, 'Finalize no longer reads the Draft All list');
    const list = block(page, 'function monthProblems(');
    for (const item of ['open flag', 'awaiting review', 'not yet on a statement', 'not reconciled']) {
      assert.ok(list.includes(item), `monthProblems no longer names: ${item}`);
    }
  });
});

describe('undo where undo moves no money', () => {
  test('a resolved flag can be reopened, by a status flip that runs before the freeze', () => {
    const route = read('src/app/api/resolve-gap/route.ts');
    const reopen = block(route, "if (resolution === 'reopen') {");
    assert.match(reopen, /\.from\('data_gaps'\)/);
    for (const forbidden of ['writeStatementTotals', "from('reservations')", "from('property_statements')", 'owner_payout']) {
      assert.ok(!reopen.includes(forbidden), `reopen touches ${forbidden}`);
    }
    assert.ok(route.indexOf("resolution === 'reopen'") < route.indexOf('assertStatementWritable('), 'reopen sits behind the freeze check');
    assert.match(page, /body: JSON\.stringify\(\{ gap_id: g\.id, resolution: 'reopen' \}\)/);
    assert.match(page, /`Show resolved \(\$\{resolvedGaps\.length \+ offStripeStays\.length\}\)`/);
  });

  test('a paid off-Stripe ruling is history, not undo', () => {
    assert.match(page, /Undoing it would move the payout again, so it is not offered here\./);
  });

  test('a dismissed bank row can be put back in the queue, with no recompute', () => {
    const route = read('src/app/api/bank-deposits/[id]/route.ts');
    const restore = block(route, "if (action === 'restore') {");
    assert.match(restore, /existing\.status !== 'dismissed'/);
    assert.match(restore, /status: 'pending'/);
    assert.ok(!restore.includes('recomputeStatementTotals') && !restore.includes('writeStatementTotals'), 'restore recomputes a statement');
    assert.match(read('src/app/statements/actions.ts'), /\.in\('status', \['pending', 'attributed', 'dismissed'\]\)/);
    const review = read('src/components/BankDepositReview.tsx');
    assert.match(review, /body: JSON\.stringify\(\{ action: 'restore' \}\)/);
    assert.match(review, /Dismissed &middot; \{dismissed\.length\}/);
  });
});
