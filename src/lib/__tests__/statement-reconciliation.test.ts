import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileStatement, type ReconciliationInput } from '../statement-reconciliation.ts';

type Res = ReconciliationInput['reservations'][number];
type Ev = ReconciliationInput['cleaningEvents'][number];

const airbnb = (code: string, amt: number, over: Partial<Res> = {}): Res => ({
  confirmation_code: code, guest_name: code, platform: 'Airbnb', check_out: '2026-08-12',
  guesty_rental_income: amt, adjusted_revenue: amt, stripe_fee: 0, bank_match_status: 'matched', ...over,
});
const manual = (code: string, pdf: number, helm: number, fee: number, over: Partial<Res> = {}): Res => ({
  confirmation_code: code, guest_name: code, platform: 'Manual', check_out: '2026-08-20',
  guesty_rental_income: pdf, adjusted_revenue: helm, stripe_fee: fee, bank_match_status: 'matched', ...over,
});
const bank = (amount: number, invoice: number | null = amount): Ev =>
  ({ source: invoice === null ? 'bank' : 'corroborated', amount, credit_amount: null, invoice_no: invoice === null ? null : `INV-${amount}`, invoice_amount: invoice });

function base(over: Partial<ReconciliationInput> = {}): ReconciliationInput {
  const reservations = [airbnb('A1', 1000), airbnb('A2', 500), manual('M1', 2000, 1850, 78.4)];
  return {
    month: '2026-08',
    statement: {
      rental_revenue: 3350, management_fee: 837.5, cleaning_total: 600, repairs_total: 0,
      add_ons_revenue: 0, attributed_debits_total: 0, reserve_holdback: 0, owner_payout: 1912.5,
      num_stays: 3, nights_booked: 9, has_bank_csv: true,
      pdf_stay_count: 3,
      pdf_stays: [
        { code: 'A1', check_out: '2026-08-12', rental_income: 1000 },
        { code: 'A2', check_out: '2026-08-12', rental_income: 500 },
        { code: 'M1', check_out: '2026-08-20', rental_income: 2000 },
      ],
    },
    reservations,
    cleaningEvents: [bank(300), bank(300)],
    gaps: [],
    driftCodes: [],
    splitCodes: new Set(),
    excused: { splitElsewhere: new Set(), cancelled: new Set(), sliceHere: new Set() },
    feeds: { stripe: 'ok', invoices: 'ok' },
    feedsKnown: true,
    recomputed: { rental_revenue: 3350, management_fee: 837.5, cleaning_total: 600, owner_payout: 1912.5, num_stays: 3, nights_booked: 9 },
    ...over,
  };
}
const laneOf = (r: ReturnType<typeof reconcileStatement>, key: string) => r.lanes.find(l => l.key === key)!;

test('a statement whose every lane agrees is reconciled, with nothing blocking', () => {
  const r = reconcileStatement(base());
  assert.equal(r.reconciled, true, r.blocking.join(' | '));
  assert.deepEqual(r.blocking, []);
  for (const k of ['stays', 'gross', 'helm', 'cleaning', 'payout']) assert.equal(laneOf(r, k).state, 'agree', k);
  assert.equal(laneOf(r, 'stripe').state, 'info');
  assert.equal(laneOf(r, 'bank').state, 'info');
});

test('stays: a PDF stay missing from the statement is named and blocks', () => {
  const r = reconcileStatement(base({ reservations: [airbnb('A1', 1000), manual('M1', 2000, 1850, 78.4)] }));
  const l = laneOf(r, 'stays');
  assert.equal(l.state, 'differs');
  assert.deepEqual(l.lines.find(x => x.label.startsWith('On the PDF'))?.codes, ['A2']);
  assert.equal(r.reconciled, false);
});

test('stays: a stay added after ingest is shown but does not block', () => {
  const r = reconcileStatement(base({ reservations: [...base().reservations, airbnb('X9', 700)] }));
  const l = laneOf(r, 'stays');
  assert.equal(l.state, 'agree');
  assert.deepEqual(l.lines.find(x => x.label.startsWith('On the statement'))?.codes, ['X9']);
});

test('stays: a booking confirmed in Guesty but not on the statement blocks', () => {
  const r = reconcileStatement(base({ driftCodes: ['Z1'] }));
  assert.equal(laneOf(r, 'stays').state, 'differs');
  assert.equal(r.reconciled, false);
});

test('stays: the PDF header claiming more reservations than could be read is shown, never judged', () => {
  // Guesty prints a $0 block for a cancelled-then-reprocessed stay and the
  // parser reads nothing from it, so header > read is the normal shape of
  // a month with a cancellation. Judging it would false-alarm every such
  // month at the close.
  const r = reconcileStatement(base({ statement: { ...base().statement, pdf_stay_count: 4 } }));
  const l = laneOf(r, 'stays');
  assert.equal(l.state, 'agree');
  const line = l.lines.find(x => x.label.startsWith('PDF header lists 4'));
  assert.ok(line);
  assert.equal(line.tone, 'neutral');
  assert.equal(r.reconciled, true);
});

test('stays: an absent PDF stay that checks out in another month is excused, not missing', () => {
  // Ingest's out-of-month gate declines these by design. They used to read
  // as a hard difference that nothing could clear.
  const r = reconcileStatement(base({ statement: { ...base().statement, pdf_stays: [...base().statement.pdf_stays!, { code: 'S9', check_out: '2026-09-02', rental_income: 3100 }] } }));
  const l = laneOf(r, 'stays');
  assert.equal(l.state, 'agree');
  assert.deepEqual(l.lines.find(x => x.label.includes('another month'))?.codes, ['S9']);
  assert.equal(r.reconciled, true);
});

test('stays: an absent PDF stay split and recognized in another month is excused', () => {
  const r = reconcileStatement(base({
    statement: { ...base().statement, pdf_stays: [...base().statement.pdf_stays!, { code: 'KB', check_out: '2026-08-01', rental_income: 8400 }] },
    excused: { splitElsewhere: new Set(['KB']), cancelled: new Set(), sliceHere: new Set() },
  }));
  const l = laneOf(r, 'stays');
  assert.equal(l.state, 'agree');
  assert.deepEqual(l.lines.find(x => x.label.includes('split across months'))?.codes, ['KB']);
});

test('stays: an absent PDF stay cancelled in Guesty and removed is excused', () => {
  const r = reconcileStatement(base({
    statement: { ...base().statement, pdf_stays: [...base().statement.pdf_stays!, { code: 'CD', check_out: '2026-08-09', rental_income: 775.29 }] },
    excused: { splitElsewhere: new Set(), cancelled: new Set(['CD']), sliceHere: new Set() },
  }));
  assert.equal(laneOf(r, 'stays').state, 'agree');
  assert.equal(r.reconciled, true);
});

test('stays: an absent PDF stay with no excuse is missing and blocks', () => {
  const r = reconcileStatement(base({ statement: { ...base().statement, pdf_stays: [...base().statement.pdf_stays!, { code: 'GONE', check_out: '2026-08-15', rental_income: 900 }] } }));
  const l = laneOf(r, 'stays');
  assert.equal(l.state, 'differs');
  assert.deepEqual(l.lines.find(x => x.label.startsWith('On the PDF, not on'))?.codes, ['GONE']);
  assert.equal(r.reconciled, false);
});

test('stays: an absent PDF stay checking out next month with a slice due THIS month is missing, not excused', () => {
  // The mirror of the has-a-slice-this-month exemption. Checkout alone
  // excused it, and $5,100 of unbooked revenue read as reconciled.
  const r = reconcileStatement(base({
    statement: { ...base().statement, pdf_stays: [...base().statement.pdf_stays!, { code: 'LS1', check_out: '2026-09-03', rental_income: 6000 }] },
    excused: { splitElsewhere: new Set(), cancelled: new Set(), sliceHere: new Set(['LS1']) },
  }));
  const l = laneOf(r, 'stays');
  assert.equal(l.state, 'differs');
  assert.deepEqual(l.lines.find(x => x.label.startsWith('On the PDF, not on'))?.codes, ['LS1']);
  assert.equal(r.reconciled, false);
});

test('stays: with the excuse reads failed, ANY absent PDF stay is unknown, out-of-month included', () => {
  const r = reconcileStatement(base({
    statement: { ...base().statement, pdf_stays: [...base().statement.pdf_stays!, { code: 'LS1', check_out: '2026-09-03', rental_income: 6000 }] },
    excused: null, excuseFailure: 'guesty',
  }));
  const l = laneOf(r, 'stays');
  assert.equal(l.state, 'unknown');
  assert.match(l.summary, /Guesty status read failed/);
});

test('stays: with the installment read failed, an unexcused absence is unknown, not judged either way', () => {
  const r = reconcileStatement(base({
    statement: { ...base().statement, pdf_stays: [...base().statement.pdf_stays!, { code: 'KB', check_out: '2026-08-01', rental_income: 8400 }] },
    excused: null, splitCodes: null,
  }));
  assert.equal(laneOf(r, 'stays').state, 'unknown');
  assert.equal(r.reconciled, false);
  // ...but with nothing absent, a failed installment read does not touch this lane
  const clean = reconcileStatement(base({ excused: null }));
  assert.equal(laneOf(clean, 'stays').state, 'agree');
});

test('stays: a row on the statement that checks out in another month still counts as on the statement', () => {
  // Booked under the has-a-slice-this-month exemption: on the statement,
  // checkout elsewhere. It must not be reported "not on the statement".
  const exempt = manual('X1', 1200, 1200, 0, { check_out: '2026-09-03' });
  const r = reconcileStatement(base({
    reservations: [...base().reservations, exempt],
    statement: { ...base().statement, pdf_stays: [...base().statement.pdf_stays!, { code: 'X1', check_out: '2026-09-03', rental_income: 1200 }] },
    splitCodes: new Set(['X1']),
  }));
  assert.equal(laneOf(r, 'stays').state, 'agree');
  assert.equal(laneOf(r, 'stays').lines.some(x => x.codes?.includes('X1')), false);
});

test('stays: no recorded PDF list is neutral, not a pass and not a failure', () => {
  const r = reconcileStatement(base({ statement: { ...base().statement, pdf_stays: null, pdf_stay_count: null } }));
  assert.equal(laneOf(r, 'stays').state, 'not_recorded');
  assert.equal(laneOf(r, 'gross').state, 'not_recorded');
  assert.equal(r.reconciled, true, 'not_recorded never blocks');
});

test('stays: a confirmed Guesty stay missing from the statement blocks even with no PDF list recorded', () => {
  // The August dry run: 17 Beach, a sent statement, read as reconciled
  // with a confirmed stay missing, because drift was only judged inside
  // the recorded branch. Every pre-existing statement is unrecorded.
  const r = reconcileStatement(base({
    statement: { ...base().statement, pdf_stays: null, pdf_stay_count: null },
    driftCodes: ['GY-qqVPackv'],
  }));
  const l = laneOf(r, 'stays');
  assert.equal(l.state, 'differs');
  assert.deepEqual(l.lines.find(x => x.codes)?.codes, ['GY-qqVPackv']);
  assert.equal(r.reconciled, false);
});

test('stays: a failed Guesty probe is unknown and blocks. Absence of data is not a fact', () => {
  const r = reconcileStatement(base({ driftCodes: null }));
  assert.equal(laneOf(r, 'stays').state, 'unknown');
  assert.equal(r.reconciled, false);
});

test('synthetic installment slices are not stays', () => {
  const slice = manual('S1', 900, 900, 0, { bank_match_status: 'installment_no_bank_event', check_out: '2026-09-04' });
  const r = reconcileStatement(base({ reservations: [...base().reservations, slice] }));
  assert.equal(laneOf(r, 'stays').state, 'agree');
});

test('gross: a PDF stay whose rental income changed after ingest is caught to the cent, by stay', () => {
  const r = reconcileStatement(base({ reservations: [airbnb('A1', 1000.01), airbnb('A2', 500), manual('M1', 2000, 1850, 78.4)] }));
  const l = laneOf(r, 'gross');
  assert.equal(l.state, 'differs');
  assert.equal(l.lines[0].amount, 0.01);
  assert.deepEqual(l.lines[0].codes, ['A1']);
});

test('gross: an absent PDF stay is the Stays lane\'s business and never makes the amounts differ', () => {
  const r = reconcileStatement(base({ statement: { ...base().statement, pdf_stays: [...base().statement.pdf_stays!, { code: 'S9', check_out: '2026-09-02', rental_income: 3100 }] } }));
  assert.equal(laneOf(r, 'gross').state, 'agree');
});

test('helm: an Airbnb stay whose net differs from the PDF blocks; a Manual one is structural and reported', () => {
  const r = reconcileStatement(base({ reservations: [airbnb('A1', 1000, { adjusted_revenue: 990 }), airbnb('A2', 500), manual('M1', 2000, 1850, 78.4)] }));
  const l = laneOf(r, 'helm');
  assert.equal(l.state, 'differs');
  assert.deepEqual(l.lines.find(x => x.codes)?.codes, ['A1']);
  const ok = laneOf(reconcileStatement(base()), 'helm');
  assert.equal(ok.state, 'agree');
  assert.equal(ok.lines.find(x => x.label.startsWith('Stripe fees'))?.amount, -78.4);
  // 1850 - 2000 + 78.4 = -71.6 of taxes/commission
  assert.equal(ok.lines.find(x => x.label.startsWith('Channel adjustment'))?.amount, -71.6);
});

test('helm: a sliced Airbnb stay is allowed to differ from the PDF; an unknown installment read blocks', () => {
  const sliced = reconcileStatement(base({ reservations: [airbnb('A1', 1000, { adjusted_revenue: 400 }), airbnb('A2', 500), manual('M1', 2000, 1850, 78.4)], splitCodes: new Set(['A1']) }));
  assert.equal(laneOf(sliced, 'helm').state, 'agree');
  const unknown = reconcileStatement(base({ splitCodes: null }));
  assert.equal(laneOf(unknown, 'helm').state, 'unknown');
  assert.equal(unknown.reconciled, false);
});

test('cleaning: each invoiced charge agreeing with its invoice is the hard check, at the tolerance the matcher pairs at', () => {
  const r = reconcileStatement(base());
  assert.equal(laneOf(r, 'cleaning').state, 'agree');
  // $5 apart: more than the $2 the invoice matcher accepts, so a real mismatch.
  const off = reconcileStatement(base({ cleaningEvents: [bank(300), { source: 'corroborated', amount: 245, credit_amount: null, invoice_no: 'INV-9', invoice_amount: 250 }] }));
  const l = laneOf(off, 'cleaning');
  assert.equal(l.state, 'differs');
  assert.equal(l.lines.find(x => x.label.startsWith('Bank $245.00 vs its invoice'))?.amount, -5);
  assert.equal(off.reconciled, false);
  // $1.50 apart: the product itself paired these, so it cannot block on them.
  const near = reconcileStatement(base({ cleaningEvents: [bank(300), { source: 'corroborated', amount: 251.5, credit_amount: null, invoice_no: 'INV-9', invoice_amount: 250 }] }));
  const nl = laneOf(near, 'cleaning');
  assert.equal(nl.state, 'agree');
  assert.equal(nl.lines.find(x => x.label.includes('within the $2'))?.amount, 1.5);
  assert.equal(near.reconciled, true);
});

test('cleaning: a charge without an invoice, or an invoice without a charge, warns but never blocks', () => {
  // Month-end: the invoice is emailed on the 31st and the ACH lands on the
  // 2nd, and each attaches to the month it fell in. Judging that made two
  // consecutive months fail with nothing in the product to clear either.
  const r = reconcileStatement(base({ cleaningEvents: [bank(300), bank(245, null), { source: 'invoice', amount: 300, credit_amount: null, invoice_no: 'INV-x', invoice_amount: 300 }] }));
  const l = laneOf(r, 'cleaning');
  assert.equal(l.state, 'agree');
  assert.equal(l.lines.find(x => x.label.startsWith('Bank charge with no invoice'))?.amount, 245);
  assert.equal(l.lines.find(x => x.label.startsWith('Invoice with no bank charge'))?.amount, 300);
  assert.equal(r.reconciled, true);
});

test('cleaning: no invoices on file is neutral; a failing invoice sync is unknown', () => {
  const none = reconcileStatement(base({ cleaningEvents: [bank(300, null), bank(300, null)] }));
  assert.equal(laneOf(none, 'cleaning').state, 'not_recorded');
  assert.equal(none.reconciled, true);
  const failing = reconcileStatement(base({ feeds: { stripe: 'ok', invoices: 'error' } }));
  assert.equal(laneOf(failing, 'cleaning').state, 'unknown');
  assert.equal(failing.reconciled, false);
});

test('cleaning: a fully credited pair is a struck charge, listed and never a mismatch, whichever row the invoice attached to', () => {
  // The invoice matcher ignores credits, so with a credited duplicate and
  // a real charge of the same amount the invoice lands on whichever row
  // comes back first. The verdict must not depend on that.
  const struckA: Ev = { source: 'matched', amount: 300, credit_amount: 300, invoice_no: 'INV-d', invoice_amount: 300 };
  const realB: Ev = { source: 'bank', amount: 300, credit_amount: null, invoice_no: null, invoice_amount: null };
  const onStruck = reconcileStatement(base({ cleaningEvents: [struckA, realB] }));
  assert.equal(laneOf(onStruck, 'cleaning').state, 'agree');
  assert.equal(laneOf(onStruck, 'cleaning').lines.find(x => x.label.startsWith('Invoiced charge credited'))?.count, 1);
  assert.equal(laneOf(onStruck, 'cleaning').lines.find(x => x.label.startsWith('Bank charge with no invoice'))?.amount, 300);
  const struckNoInv: Ev = { source: 'matched', amount: 300, credit_amount: 300, invoice_no: null, invoice_amount: null };
  const realWithInv: Ev = { source: 'corroborated', amount: 300, credit_amount: null, invoice_no: 'INV-d', invoice_amount: 300 };
  const onReal = reconcileStatement(base({ cleaningEvents: [struckNoInv, realWithInv] }));
  assert.equal(laneOf(onReal, 'cleaning').state, 'agree');
  // the struck, uninvoiced charge nets to $0 in the uninvoiced line, not $300
  assert.equal(laneOf(onReal, 'cleaning').lines.find(x => x.label.startsWith('Bank charge with no invoice'))?.amount, 0);
  assert.equal(onStruck.reconciled, true);
  assert.equal(onReal.reconciled, true);
});

test('payout: a stored money column off from its rows blocks; a count-only miss does not', () => {
  const money = reconcileStatement(base({ recomputed: { ...base().recomputed!, owner_payout: 1900 } }));
  assert.equal(laneOf(money, 'payout').state, 'differs');
  assert.equal(money.reconciled, false);
  const count = reconcileStatement(base({ recomputed: { ...base().recomputed!, nights_booked: 8 } }));
  assert.equal(laneOf(count, 'payout').state, 'agree');
  assert.equal(laneOf(count, 'payout').lines.length, 1);
  assert.equal(count.reconciled, true);
});

test('an open critical flag blocks even when every lane agrees', () => {
  const r = reconcileStatement(base({ gaps: [{ gap_type: 'vendor_refund_unapplied', severity: 'critical', resolved: false }] }));
  assert.equal(r.reconciled, false);
  assert.equal(r.openCriticalGaps, 1);
  const resolved = reconcileStatement(base({ gaps: [{ gap_type: 'vendor_refund_unapplied', severity: 'critical', resolved: true }] }));
  assert.equal(resolved.reconciled, true);
});

test('stripe and bank lanes never block on their own', () => {
  const r = reconcileStatement(base({
    reservations: [airbnb('A1', 1000, { bank_match_status: 'unmatched' }), airbnb('A2', 500), manual('M1', 2000, 1850, 78.4)],
    gaps: [{ gap_type: 'stripe_missing_charge', severity: 'warning', resolved: false }],
  }));
  assert.equal(laneOf(r, 'stripe').state, 'info');
  assert.equal(laneOf(r, 'bank').state, 'info');
  assert.deepEqual(laneOf(r, 'bank').lines.find(x => x.codes)?.codes, ['A1']);
  assert.equal(r.reconciled, true);
  const failing = reconcileStatement(base({ feeds: { stripe: 'error', invoices: 'ok' } }));
  assert.equal(laneOf(failing, 'stripe').state, 'unknown');
  assert.equal(failing.reconciled, false);
});

test('a failed flag read blocks: an empty list from a failed read is not "no flags"', () => {
  const r = reconcileStatement(base({ gaps: [], gapsKnown: false }));
  assert.equal(r.reconciled, false);
  assert.match(r.blocking.join(' '), /could not be read/);
});

test('a failed feed-health read blocks: an empty sync map is not "every feed healthy"', () => {
  const r = reconcileStatement(base({ feedsKnown: false }));
  assert.equal(r.reconciled, false);
  assert.match(r.blocking.join(' '), /Feed health could not be read/);
});

test('cleaning: a PARTIAL credit on an invoiced charge is a decision, not a mismatch, and cannot block', () => {
  // Auto-netting refuses partial refunds by design, so the operator applies
  // them by hand; a $50 credit on a $300 invoiced charge then blocked while
  // a $300 credit was neutral, a cliff with no lever.
  const partial: Ev = { source: 'corroborated', amount: 300, credit_amount: 50, invoice_no: 'INV-p', invoice_amount: 300 };
  const r = reconcileStatement(base({ cleaningEvents: [bank(300), partial] }));
  const l = laneOf(r, 'cleaning');
  assert.equal(l.state, 'agree');
  assert.equal(l.lines.find(x => x.label.startsWith('Invoiced charge credited'))?.amount, 250);
  assert.equal(r.reconciled, true);
});

test('stays: a cancelled stay that still carries a slice for this month is excused, and the stale split is called out', () => {
  // Calling it missing would send the operator to a re-ingest that books
  // cancelled revenue, since the PDF fork exempts a sliced code from the
  // month gate.
  const r = reconcileStatement(base({
    statement: { ...base().statement, pdf_stays: [...base().statement.pdf_stays!, { code: 'CX', check_out: '2026-09-03', rental_income: 6000 }] },
    excused: { splitElsewhere: new Set(), cancelled: new Set(['CX']), sliceHere: new Set(['CX']) },
  }));
  const l = laneOf(r, 'stays');
  assert.equal(l.state, 'agree');
  assert.deepEqual(l.lines.find(x => x.label.startsWith('Cancelled, but still carries'))?.codes, ['CX']);
  assert.equal(r.reconciled, true);
});
