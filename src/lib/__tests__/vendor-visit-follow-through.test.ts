import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseVisitSlips, planVisitHold, type VendorVisitRow, type VisitSlipInput } from '../vendor-visit-core.ts';
import { offeredVisitDeadline, visitTiming, visitWorkIsComplete, visitSelectionIsClosed } from '../vendor-visit-follow-through.ts';
import { loadVisitQueue } from '../vendor-visit-queue.ts';
import { completeVendorVisit } from '../vendor-visit-complete.ts';

const now = new Date('2026-10-30T23:00:00Z'); // 7 PM Eastern
const proposal = (extra: Partial<VendorVisitRow> = {}): VendorVisitRow => ({
  id: 'visit', status: 'pending', source: 'vendor', trade_vendor_id: 'vendor', vendor_name: 'Example Plumbing',
  property_id: 'home', property_basis: 'offer', visit_date: '2026-10-30', visit_end_date: '2026-10-30',
  message_at: '2026-10-30T17:00:00Z', message_body: 'Yup', offer_at: '2026-10-30T16:55:00Z',
  offer_text: 'Can you get to 12 Example Road before our guests arrive at 4 PM today?',
  scheduled_slip_ids: [], last_error: null, hold_result: null, ...extra,
} as VendorVisitRow);
const job = (extra: Partial<VisitSlipInput> = {}): VisitSlipInput => ({
  id: 'toilet', property_id: 'home', title: 'Repair upstairs toilet', status: 'done', category: 'maintenance', run_scope: 'pro',
  assigned_to_label: 'Vendor: Example Plumbing', scheduled_date: '2026-10-30', completed_at: '2026-10-30T19:00:00Z', ...extra,
});

test('a single-day offer supplies the deadline missing from a one-word confirmation', () => {
  assert.equal(offeredVisitDeadline(proposal()), '16:00');
  assert.equal(offeredVisitDeadline(proposal({ offer_text: 'Can you come today by 3 PM?' })), '15:00');
  assert.equal(offeredVisitDeadline(proposal({ offer_text: 'Come today at 1 PM' })), null);
  assert.equal(offeredVisitDeadline(proposal({ offer_text: 'Oct 30 to Nov 3, before 4 PM' })), null);
  assert.equal(offeredVisitDeadline(proposal({ property_basis: 'operator' })), null);
  assert.equal(offeredVisitDeadline(proposal({ visit_date: '2026-10-31' })), null);
});

test('passed times change the action on the same day, using Eastern time', () => {
  assert.equal(visitTiming('2026-10-30', null, ['16:00'], now).elapsed, true);
  assert.equal(visitTiming('2026-10-30', null, ['16:00'], new Date('2026-10-30T19:59:00Z')).elapsed, false);
  assert.equal(visitTiming('2026-10-30', null, ['16:00'], new Date('2026-10-30T20:00:00Z')).elapsed, true);
  assert.equal(visitTiming('2026-10-30', '2026-10-31', ['16:00'], now).elapsed, false);
  assert.equal(visitTiming('2026-10-29', null, [], now).elapsed, true);
  assert.equal(visitTiming('2026-10-30', null, [], now).elapsed, false, 'an unknown time is not evidence of completion');
  assert.equal(visitTiming(null, null, [], now).elapsed, false);
  assert.equal(visitTiming('2026-11-02', null, ['16:00'], new Date('2026-11-02T20:30:00Z')).elapsed, false, 'standard time after DST');
});

test('past nights cannot be offered or held, even if checked by an old client', () => {
  const open = { guest: false, held: null, arrival: false, departure: false, ownerHeld: false };
  const plan = planVisitHold({ today: '2026-10-30', start: '2026-10-30', end: '2026-10-30',
    time: { start: null, end: null }, nights: new Map([['2026-10-29', open], ['2026-10-30', open]]),
    checkoutTime: '11:00', checkinTime: '16:00', holdNightBefore: true, vendorName: 'Example', windows: [] });
  assert.deepEqual(plan.holdNights, ['2026-10-30']);
  assert.equal(plan.nightBefore.offered, false);
});

test('the plumber does not get unrelated pro work or a title matched through a pasted source', () => {
  const picked = chooseVisitSlips([
    job({ status: 'open' }),
    job({ id: 'fire', status: 'open', title: 'Replace fire extinguishers', assigned_to_label: null }),
    job({ id: 'lights', status: 'open', title: 'Replace bathroom lights', assigned_to_label: null, description: 'Guest mentioned the toilet and lights.' }),
  ], { category: 'plumbing', vendorName: 'Example Plumbing' });
  assert.deepEqual(picked.map(s => s.id), ['toilet']);
});

test('recorded completion removes the obsolete visit only with matching vendor, day and home', () => {
  assert.equal(visitWorkIsComplete(proposal(), [job()], 'plumbing'), true);
  for (const other of [job({ property_id: 'other' }), job({ assigned_to_label: 'Vendor: Other' }), job({ scheduled_date: '2026-10-29' }),
    job({ completed_at: '2026-10-29T19:00:00Z' }), job({ status: 'dismissed' }), job({ status: 'open' })]) {
    assert.equal(visitWorkIsComplete(proposal(), [other], 'plumbing'), false);
  }
  assert.equal(visitWorkIsComplete(proposal(), [job(), job({ id: 'another', status: 'open', assigned_to_label: null })], 'plumbing'), false);
  assert.equal(visitWorkIsComplete(proposal({ last_error: 'Partial save' }), [job()], 'plumbing'), false);
  assert.equal(visitWorkIsComplete(proposal({ source: 'owner' }), [job()], 'plumbing'), false);
  assert.equal(visitWorkIsComplete(proposal({ status: 'approving' }), [job()], 'plumbing'), false);
});

test('every explicit link must be complete, and reopening makes the reminder actionable again', () => {
  const row = proposal({ scheduled_slip_ids: ['toilet', 'sink'] });
  assert.equal(visitWorkIsComplete(row, [job()], 'plumbing'), false);
  assert.equal(visitWorkIsComplete(row, [job(), job({ id: 'sink' })], 'plumbing'), true);
  assert.equal(visitWorkIsComplete(row, [job(), job({ id: 'sink', status: 'open' })], 'plumbing'), false);
});

test('an old Approve cannot schedule closed jobs; a calendar-only visit is still allowed', () => {
  assert.equal(visitSelectionIsClosed(['toilet'], 'home', [job()]), true);
  assert.equal(visitSelectionIsClosed(['toilet'], 'home', []), true);
  assert.equal(visitSelectionIsClosed(['toilet'], 'home', [job({ status: 'open' })]), false);
  assert.equal(visitSelectionIsClosed(['toilet'], 'home', [job({ property_id: 'other', status: 'open' })]), true);
  assert.equal(visitSelectionIsClosed([], 'home', [job()]), false);
});

// A stateful database stand-in: filters, paging and conditional writes run
// against rows, including failures after work is saved. No external IO.
type Row = Record<string, any>;
function database(tables: Record<string, Row[]>, failure?: (table: string, op: string, patch: Row) => boolean) {
  const writes: { table: string; patch: Row }[] = [];
  const db = { from(table: string) {
    let op = 'select', patch: Row = {}, single = false, start = 0, end = 999;
    const filters: ((r: Row) => boolean)[] = [];
    const b: any = {
      select() { return b; }, order() { return b; },
      in(k: string, values: unknown[]) { filters.push(r => values.includes(r[k])); return b; },
      eq(k: string, value: unknown) { filters.push(r => r[k] === value); return b; },
      range(a: number, z: number) { start = a; end = z; return b; },
      maybeSingle() { single = true; return b; },
      update(p: Row) { op = 'update'; patch = p; return b; },
      then(resolve: any, reject: any) {
        if (failure?.(table, op, patch)) return Promise.resolve({ data: null, error: { message: 'synthetic failure' } }).then(resolve, reject);
        const rows = (tables[table] ?? []).filter(r => filters.every(f => f(r))).slice(start, end + 1);
        if (op === 'update') { writes.push({ table, patch }); for (const r of rows) Object.assign(r, patch); }
        return Promise.resolve({ data: single ? rows[0] ?? null : rows.map(r => ({ ...r })), error: null }).then(resolve, reject);
      },
    }; return b;
  } };
  return { db: db as never, writes };
}

test('cards and badge share the queue, including work beyond the first database page', async () => {
  const slips = Array.from({ length: 1001 }, (_, i) => job({ id: `old-${i}`, scheduled_date: '2025-01-01' }));
  slips.push(job());
  const { db } = database({ vendor_visit_proposals: [proposal()], trade_vendors: [{ id: 'vendor', category: 'plumbing' }], work_slips: slips });
  assert.equal((await loadVisitQueue(db)).rows.length, 0);
  slips.push(job({ id: 'active', status: 'open', assigned_to_label: null }));
  assert.equal((await loadVisitQueue(db)).rows.length, 1);
});

test('an unread work list fails rather than hiding cards', async () => {
  const { db } = database({ vendor_visit_proposals: [proposal()], trade_vendors: [{ id: 'vendor', category: 'plumbing' }] }, t => t === 'work_slips');
  await assert.rejects(loadVisitQueue(db), /Visit work/);
});

test('Already done closes exactly the selected jobs and visit, preserves prior completion dates', async () => {
  const rows = { vendor_visit_proposals: [proposal()], work_slips: [job({ status: 'open', completed_at: null }), job({ id: 'done' }), job({ id: 'unselected', status: 'open' })] };
  const { db, writes } = database(rows);
  const result = await completeVendorVisit(db, 'visit', ['toilet', 'done'], 'operator@example.test', now);
  assert.equal(result.ok, true);
  assert.equal(rows.vendor_visit_proposals[0].status, 'handled');
  assert.equal(rows.work_slips[0].status, 'done');
  assert.equal(rows.work_slips[0].completed_at, now.toISOString());
  assert.equal(rows.work_slips[1].completed_at, '2026-10-30T19:00:00Z');
  assert.equal(rows.work_slips[2].status, 'open');
  assert.deepEqual([...new Set(writes.map(w => w.table))].sort(), ['vendor_visit_proposals', 'work_slips']);
});

test('closing just the visit does not change any work', async () => {
  const rows = { vendor_visit_proposals: [proposal()], work_slips: [job({ status: 'open' })] };
  const { db, writes } = database(rows);
  assert.equal((await completeVendorVisit(db, 'visit', [], 'operator@example.test', now)).ok, true);
  assert.deepEqual(writes.map(w => w.table), ['vendor_visit_proposals', 'vendor_visit_proposals']);
  assert.equal(rows.work_slips[0].status, 'open');
});

test('wrong-home, dismissed, duplicate and owner-work selections are refused before any write', async () => {
  for (const [row, jobs, selected] of [
    [proposal(), [job({ property_id: 'elsewhere' })], ['toilet']],
    [proposal(), [job({ status: 'dismissed' })], ['toilet']],
    [proposal(), [job()], ['toilet', 'toilet']],
    [proposal({ source: 'owner' }), [job()], ['toilet']],
  ] as [VendorVisitRow, VisitSlipInput[], string[]][]) {
    const { db, writes } = database({ vendor_visit_proposals: [row], work_slips: jobs });
    assert.equal((await completeVendorVisit(db, 'visit', selected, 'operator@example.test', now)).ok, false);
    assert.deepEqual(writes, []);
  }
});

test('another operator already deciding the card prevents work writes', async () => {
  const { db, writes } = database({ vendor_visit_proposals: [proposal({ status: 'approving' })], work_slips: [job({ status: 'open' })] });
  const result = await completeVendorVisit(db, 'visit', ['toilet'], 'operator@example.test', now);
  assert.equal(result.ok, false);
  assert.deepEqual(writes, []);
});

test('failure after saving work keeps the visit visible; retry is safe', async () => {
  const rows = { vendor_visit_proposals: [proposal()], work_slips: [job({ status: 'open', completed_at: null })] };
  let fail = true;
  const { db } = database(rows, (t, op, p) => fail && t === 'vendor_visit_proposals' && op === 'update' && p.status === 'handled');
  const result = await completeVendorVisit(db, 'visit', ['toilet'], 'operator@example.test', now);
  assert.equal(result.ok, false);
  assert.equal(rows.vendor_visit_proposals[0].status, 'pending');
  assert.equal(visitWorkIsComplete(rows.vendor_visit_proposals[0], rows.work_slips, 'plumbing'), false);
  assert.equal(rows.work_slips[0].status, 'done');
  fail = false;
  assert.equal((await completeVendorVisit(db, 'visit', ['toilet'], 'operator@example.test', new Date('2026-10-31T00:00:00Z'))).ok, true);
  assert.equal(rows.work_slips[0].completed_at, now.toISOString());
});
