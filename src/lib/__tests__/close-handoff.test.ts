/**
 * The month-close handoff.
 *
 * The rule that sets every deadline (three days before the first of the
 * next month), the window the digest and the feed nag in, and the guards
 * that keep the handoff away from the money: an item reaches a statement
 * only through /api/receipts, filing and dismissing are owner moves, and
 * none of the new code writes a receipt, a repair event or a statement.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HANDOFF_KINDS,
  daysBetween,
  dueWording,
  firstNameFromEmail,
  groupByProperty,
  handoffDueDate,
  handoffMonths,
  inNagWindow,
  isHandoffKind,
  isMonth,
  monthLabel,
  nextMonth,
  prevMonth,
  summarize,
  type HandoffItem,
} from '../close-handoff.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const item = (over: Partial<HandoffItem>): HandoffItem => ({
  id: 'x', month: '2026-10', property_id: '20_hammond', kind: 'repair', description: 'Fixed the disposal',
  vendor: 'Paone', amount: 185, charge_date: '2026-10-14', file_path: null, status: 'open',
  created_by: 'delaney@risingtidestr.com', created_at: '2026-10-14T15:00:00Z', sent_at: null,
  resolved_at: null, resolved_by: null, resolution_note: null, receipt_id: null, ...over,
});

describe('the deadline', () => {
  test('is three days before the first of the next month', () => {
    assert.equal(handoffDueDate('2026-10'), '2026-10-29');
    assert.equal(handoffDueDate('2026-12'), '2026-12-29');
    assert.equal(handoffDueDate('2026-02'), '2026-02-26');
    assert.equal(handoffDueDate('2028-02'), '2028-02-27', 'a leap February');
  });

  test('reads naturally on either side of the day', () => {
    assert.equal(dueWording('2026-10', '2026-10-20'), 'due Thu, Oct 29');
    assert.equal(dueWording('2026-10', '2026-10-28'), 'due tomorrow');
    assert.equal(dueWording('2026-10', '2026-10-29'), 'due today');
    assert.equal(dueWording('2026-10', '2026-10-30'), '1 day past due');
    assert.equal(dueWording('2026-10', '2026-11-02'), '4 days past due');
  });

  test('month arithmetic crosses the year', () => {
    assert.equal(nextMonth('2026-12'), '2027-01');
    assert.equal(prevMonth('2027-01'), '2026-12');
    assert.equal(monthLabel('2026-10'), 'October 2026');
    assert.equal(daysBetween('2026-10-29', '2026-11-01'), 3);
    assert.equal(daysBetween('2026-11-01', '2026-10-29'), -3);
    assert.equal(isMonth('2026-13'), false);
    assert.equal(isMonth('2026-10'), true);
  });
});

describe('what the page shows and when the nag runs', () => {
  test('the previous month stays on the page through the close window', () => {
    assert.deepEqual(handoffMonths('2026-11-03'), ['2026-10', '2026-11']);
    assert.deepEqual(handoffMonths('2026-11-10'), ['2026-10', '2026-11']);
    assert.deepEqual(handoffMonths('2026-11-11'), ['2026-11']);
    assert.deepEqual(handoffMonths('2027-01-05'), ['2026-12', '2027-01']);
  });

  test('the digest and the feed start a week before the due date and stop when the month leaves the page', () => {
    assert.equal(inNagWindow('2026-10', '2026-10-21'), false, 'eight days out is quiet');
    assert.equal(inNagWindow('2026-10', '2026-10-22'), true, 'seven days out nags');
    assert.equal(inNagWindow('2026-10', '2026-10-29'), true);
    assert.equal(inNagWindow('2026-10', '2026-11-10'), true, 'still the close window');
    assert.equal(inNagWindow('2026-10', '2026-11-11'), false);
    assert.equal(inNagWindow('2026-11', '2026-10-25'), false, 'a future month never nags');
  });
});

describe('summaries', () => {
  test('counts by status and the dollars still waiting', () => {
    const s = summarize([
      item({ status: 'open', amount: 185 }),
      item({ id: 'b', status: 'sent', amount: 40.5 }),
      item({ id: 'c', status: 'filed', amount: 99, receipt_id: 'r1' }),
      item({ id: 'd', status: 'dismissed', amount: null, kind: 'cleaning_issue' }),
      item({ id: 'e', status: 'open', amount: null, kind: 'cleaning_issue' }),
    ]);
    assert.deepEqual(s, { open: 2, sent: 1, filed: 1, dismissed: 1, pending: 3, pendingAmount: 225.5 });
  });

  test('groups by home, newest first, in first-seen order', () => {
    const g = groupByProperty([
      item({ id: 'a', property_id: '20_hammond', created_at: '2026-10-01T00:00:00Z' }),
      item({ id: 'b', property_id: '3_south_st', created_at: '2026-10-02T00:00:00Z' }),
      item({ id: 'c', property_id: '20_hammond', created_at: '2026-10-03T00:00:00Z' }),
    ]);
    assert.deepEqual([...g.keys()], ['20_hammond', '3_south_st']);
    assert.deepEqual(g.get('20_hammond')!.map((i) => i.id), ['c', 'a']);
  });

  test('vocabulary', () => {
    assert.deepEqual(HANDOFF_KINDS.map((k) => k.id), ['repair', 'card_charge', 'cleaning_issue']);
    assert.equal(HANDOFF_KINDS.find((k) => k.id === 'cleaning_issue')!.money, false);
    assert.equal(isHandoffKind('card_charge'), true);
    assert.equal(isHandoffKind('receipt'), false);
    assert.equal(firstNameFromEmail('delaney@risingtidestr.com'), 'Delaney');
    assert.equal(firstNameFromEmail(null), 'someone');
  });
});

describe('the handoff never touches the money itself', () => {
  const newFiles = [
    'src/lib/close-handoff.ts',
    'src/lib/close-handoff-db.ts',
    'src/app/api/close-handoff/route.ts',
    'src/app/api/close-handoff/[id]/route.ts',
    'src/app/api/close-handoff/[id]/url/route.ts',
    'src/app/fieldwork/close/page.tsx',
    'src/app/fieldwork/close/CloseHandoffBoard.tsx',
    'src/components/HandoffFileQueue.tsx',
  ];

  test('no new file writes a receipt, a repair event, a statement or a payout', () => {
    for (const f of newFiles) {
      const src = read(f);
      for (const forbidden of ["from('property_receipts')", "from('repair_events')", "from('property_statements')", 'owner_payout', 'writeStatementTotals']) {
        assert.ok(!src.includes(forbidden), `${f} must not touch ${forbidden}`);
      }
    }
  });

  test('an owner files an item by posting it to the one receipt writer', () => {
    const src = read('src/components/HandoffFileQueue.tsx');
    assert.ok(src.includes("fetch('/api/receipts', { method: 'POST', body: fd })"), 'File as receipt must go through /api/receipts');
    assert.ok(src.includes("fd.append('acknowledge_warnings', 'true')"), 'and honour its needs_confirm round trip');
    assert.ok(src.includes("action: 'filed', receipt_id: receiptId"), 'then record the receipt id on the item');
    assert.ok(src.includes("fetch('/api/period-notes'"), 'a cleaning issue becomes a period note');
  });

  test('filing and dismissing are owner moves even though the page is open to staff', () => {
    const src = read('src/app/api/close-handoff/[id]/route.ts');
    assert.ok(src.includes("const OWNER_ACTIONS = new Set(['dismiss', 'filed']);"));
    assert.ok(src.includes("if (OWNER_ACTIONS.has(action) && !me.owner) return NextResponse.json({ error: 'owners only' }, { status: 403 });"));
    assert.ok(src.includes("roleForEmail(email) === 'owner'"), 'the role comes from helm-access, not a guess');
  });

  test('the statement card shows the queue beside its own receipt button', () => {
    const page = read('src/app/statements/page.tsx');
    assert.ok(page.includes("import { HandoffFileQueue } from '@/components/HandoffFileQueue';"));
    assert.ok(page.includes('<HandoffFileQueue propertyId={prop.property_id} propertyName={prop.property_name} month={month} onFiled={onRefresh} />'));
  });

  test('the page is reachable by staff: in the Field tabs and the atlas without an owner flag', () => {
    const tabs = read('src/components/FieldTabs.tsx');
    assert.ok(tabs.includes("close: '/fieldwork/close'"));
    assert.ok(tabs.includes("{ id: 'close', label: 'Close handoff' }"));
    const atlas = read('src/lib/helm-modules.ts');
    const start = atlas.indexOf("id: 'close-handoff'");
    assert.ok(start > 0, 'the atlas must list the page');
    const block = atlas.slice(start, atlas.indexOf('},', start));
    assert.ok(block.includes("href: '/fieldwork/close'"));
    assert.ok(!block.includes("access: 'owner'"), 'staff must be able to open it');
    const migration = read('supabase/migrations/20261014130000_close_handoff_items.sql');
    assert.ok(migration.includes("check (status in ('open', 'sent', 'filed', 'dismissed'))"));
    assert.ok(migration.includes('enable row level security'));
  });

  test('the morning digest and the home feed read the same window', () => {
    const notify = read('src/lib/field-notify.ts');
    assert.ok(notify.includes('inNagWindow('), 'the digest line is gated by the nag window');
    assert.ok(notify.includes('handoffOpen'), 'and counts toward whether the digest sends at all');
    const feed = read('src/components/ForMeFeed.tsx');
    assert.ok(feed.includes('loadCloseHandoffQueue('), 'the feed has a close handoff card');
    assert.ok(feed.includes("roleForEmail(email) === 'owner'"), 'that reads differently for an owner and for staff');
  });
});
