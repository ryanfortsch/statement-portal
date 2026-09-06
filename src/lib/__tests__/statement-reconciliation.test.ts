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
      pdf_stay_count: 3, pdf_rental_income_sum: 3500, pdf_confirmation_codes: ['A1', 'A2', 'M1'],
    },
    reservations,
    cleaningEvents: [bank(300), bank(300)],
    gaps: [],
    driftCodes: [],
    splitCodes: new Set(),
    feeds: { stripe: 'ok', invoices: 'ok' },
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

test('stays: the PDF header claiming more reservations than could be read is a difference', () => {
  const r = reconcileStatement(base({ statement: { ...base().statement, pdf_stay_count: 4 } }));
  assert.equal(laneOf(r, 'stays').state, 'differs');
});

test('stays: no recorded PDF list is neutral, not a pass and not a failure', () => {
  const r = reconcileStatement(base({ statement: { ...base().statement, pdf_confirmation_codes: null, pdf_rental_income_sum: null, pdf_stay_count: null } }));
  assert.equal(laneOf(r, 'stays').state, 'not_recorded');
  assert.equal(laneOf(r, 'gross').state, 'not_recorded');
  assert.equal(r.reconciled, true, 'not_recorded never blocks');
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

test('gross: a PDF stay whose rental income changed after ingest is caught to the cent', () => {
  const r = reconcileStatement(base({ reservations: [airbnb('A1', 1000.01), airbnb('A2', 500), manual('M1', 2000, 1850, 78.4)] }));
  const l = laneOf(r, 'gross');
  assert.equal(l.state, 'differs');
  assert.equal(l.lines[0].amount, 0.01);
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

test('cleaning: invoices agreeing with the bank to the cent is the hard check', () => {
  const r = reconcileStatement(base());
  assert.equal(laneOf(r, 'cleaning').state, 'agree');
  const off = reconcileStatement(base({ cleaningEvents: [bank(300), bank(245, null), { source: 'invoice', amount: 300, credit_amount: null, invoice_no: 'INV-x', invoice_amount: 300 }] }));
  const l = laneOf(off, 'cleaning');
  assert.equal(l.state, 'differs');
  assert.equal(l.lines.find(x => x.label.startsWith('Bank charge with no invoice'))?.amount, 245);
  assert.equal(l.lines.find(x => x.label.startsWith('Invoice with no bank charge'))?.amount, 300);
});

test('cleaning: no invoices on file is neutral; a failing invoice sync is unknown', () => {
  const none = reconcileStatement(base({ cleaningEvents: [bank(300, null), bank(300, null)] }));
  assert.equal(laneOf(none, 'cleaning').state, 'not_recorded');
  assert.equal(none.reconciled, true);
  const failing = reconcileStatement(base({ feeds: { stripe: 'ok', invoices: 'error' } }));
  assert.equal(laneOf(failing, 'cleaning').state, 'unknown');
  assert.equal(failing.reconciled, false);
});

test('cleaning: a credit nets the bank side, matching how the write path bills', () => {
  const credited: Ev = { source: 'matched', amount: 300, credit_amount: 300, invoice_no: 'INV-d', invoice_amount: 300 };
  // Bank net 300 (one real, one fully credited) vs invoices 600: the duplicate invoice is the difference.
  const r = reconcileStatement(base({ cleaningEvents: [bank(300), credited] }));
  const l = laneOf(r, 'cleaning');
  assert.equal(l.state, 'differs');
  assert.match(l.summary, /Bank \$300\.00 vs invoices \$600\.00/);
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
