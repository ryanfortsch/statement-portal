/**
 * One ledger under every inbox queue (audit 2026-11-07): Follow-up history
 * folded into Decided recently. A handled card and what it filed are one
 * row with Undo; a sent reply joins only for what it filed, without Undo;
 * the Team inbox's two audiences never cross. And no page mounts a second
 * history again.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mergeDecidedLedger, hasFiled, type DecidedRow, type LedgerFollowup } from '../../components/messaging/card/decided-ledger.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const outcomes = (title: string) => ({ work: [{ id: `slip-${title}`, title, status: 'open', assignee: 'Unassigned', scheduledDate: '', completedAt: '', error: '' }], notes: [], error: '' });
const followup = (id: string, at: string, extra: Partial<LedgerFollowup> = {}): LedgerFollowup => ({
  id, who: 'Synthetic guest', property: 'Synthetic home', sourceText: 'Synthetic words', resolvedAt: at, replyStatus: 'approved', outcomes: outcomes(id), ...extra,
});
const decided = (id: string, at: string, extra: Partial<DecidedRow> = {}): DecidedRow => ({ id, status: 'manual_sent', name: 'Synthetic guest', at, ...extra });

test('a handled card and what it filed are one row, and keep Undo', () => {
  const rows = mergeDecidedLedger([decided('a', '2026-11-08T10:00:00Z')], [followup('a', '2026-11-08T10:00:00Z', { replyStatus: 'manual_sent' })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].undoable, undefined);
  assert.equal(rows[0].outcomes?.work[0].title, 'a');
});

test('a sent reply joins for what it filed, without Undo, newest first', () => {
  const rows = mergeDecidedLedger([decided('a', '2026-11-08T10:00:00Z')], [followup('b', '2026-11-08T12:00:00Z')]);
  assert.deepEqual(rows.map((r) => r.id), ['b', 'a']);
  assert.equal(rows[0].undoable, false);
  assert.equal(rows[0].status, 'approved');
  assert.equal(rows[0].quote, 'Synthetic words');
});

test('the Team inbox matches by audience as well as id', () => {
  const rows = mergeDecidedLedger(
    [decided('same', '2026-11-08T10:00:00Z', { audience: 'cleaner' })],
    [followup('same', '2026-11-08T09:00:00Z', { audience: 'contractor' })],
  );
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.audience === 'cleaner')?.outcomes, undefined);
});

test('nothing filed draws no Filed line', () => {
  assert.equal(hasFiled(undefined), false);
  assert.equal(hasFiled({ work: [], notes: [], error: '' }), false);
  assert.equal(hasFiled(outcomes('x')), true);
});

test('no inbox mounts a second history', () => {
  assert.ok(!existsSync(new URL('../../components/RecentMessageOutcomes.tsx', import.meta.url)), 'Follow-up history is gone');
  for (const page of ['src/app/messaging/page.tsx', 'src/app/owner-messaging/page.tsx', 'src/app/messaging/team/page.tsx']) {
    const src = read(page);
    assert.ok(!src.includes('RecentMessageOutcomes') && !src.includes('Follow-up history'), `${page} prints a second ledger`);
    assert.ok(src.includes('loadFollowupFeed('), `${page}: the ledger carries what each message filed`);
  }
  const ledger = read('src/components/messaging/card/DecidedRecently.tsx');
  assert.ok(ledger.includes('mergeDecidedLedger(items, live.items)'), 'the shared card merges, not one queue');
});
