#!/usr/bin/env node
/**
 * Internal-sweep classifier check.
 *
 * Exercises the REAL shipped classifier (src/lib/internal-transfers.ts and
 * the descriptor parser in src/lib/bank-charges.ts) via Node's native
 * TypeScript stripping. No database, no bundler, no network.
 *
 * WHAT IS BEING GUARDED. The classifier decides which outgoing bank rows are
 * Rising Tide moving its own money -- occupancy tax to *9928, the VRBO
 * commission and management fee to *5130 -- and files those out of the
 * operator's Unattributed Charges queue. The *5130 account is shared with
 * genuine expense reimbursements that DO belong on the owner's Repairs line,
 * so the cost of a false positive is a real repair silently disappearing
 * from a statement. Three such reimbursements are already attributed
 * against live statements and are pinned as cases below.
 *
 * This is not a payout parity harness in the usual sense, because the change
 * it guards cannot move a payout: a recognized sweep still lands with
 * status='pending', and every recompute site reads only status='attributed'
 * (loadAddOnTotals in src/lib/statement-addons.ts). What it guards is the
 * classification itself.
 *
 * Every fixture below is a real row from bank_deposit_attributions.
 *
 * Run: node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON scripts/internal_transfer_parity.mjs
 */

import { parseInternalTransfer, TAX_REMITTANCE_ACCOUNT, RT_OPERATING_ACCOUNT } from '../src/lib/bank-charges.ts';
import { classifyInternalTransfers, remittanceMonthFor, SWEEP_SOURCE } from '../src/lib/internal-transfers.ts';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log(`  FAIL  ${label}\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ok    ${label}`);
  }
};

const ACCOUNTS = { tax: TAX_REMITTANCE_ACCOUNT, operating: RT_OPERATING_ACCOUNT };

/* ------------------------------------------------------------------ */
console.log('\n1. Descriptor parsing (real Chase strings)');

const parse = d => parseInternalTransfer(d.toUpperCase());

check('outbound to the tax account',
  parse('Online Transfer to CHK ...9928 transaction#: 30570598973 08/27'),
  { last4: '9928', outbound: true });
check('outbound to RT operating',
  parse('Online Transfer to CHK ...5130 transaction#: 30571000226 08/27'),
  { last4: '5130', outbound: true });
check('inbound is recognized but flagged not-outbound',
  parse('Online Transfer from CHK ...5130 transaction#: 29717013440'),
  { last4: '5130', outbound: false });
check('a vendor charge is not a transfer',
  parse('LAUNDRY PLUS DELIVERED 781-8732000 MA        08/29'), null);
check('an owner distribution is not a transfer',
  parse('ONLINE ACH PAYMENT 8261951 TO DANIELLEANDMARKRAMSEY (_#########)'), null);
check('a bare account number in a transaction id does not fire',
  parse('IN *SP PROPERTIES 978-9491399 NH 5130'), null);

/* ------------------------------------------------------------------ */
console.log('\n2. Month offset (the sweep pays the PRIOR month)');

check('August landing pays July', remittanceMonthFor('2026-08'), '2026-07');
check('January landing pays the prior December', remittanceMonthFor('2026-01'), '2025-12');
check('a malformed month is returned untouched', remittanceMonthFor('nonsense'), 'nonsense');

/* ------------------------------------------------------------------ */
console.log('\n3. The operator\'s worked example: 19 Rackliffe, landing 2026-08');
// Real rows. The 08/27 pair is July's sheet ($1,734.81 tax / $191.55
// commission); the 08/03 row is July's management fee ($5,516.64).

const rackliffe = [
  { key: 'tax', last4: '9928', amount: 1734.81, date: '2026-08-27' },
  { key: 'comm', last4: '5130', amount: 191.55, date: '2026-08-27' },
  { key: 'fee', last4: '5130', amount: 5516.64, date: '2026-08-03' },
];
const rackliffeExpected = {
  taxToRemit: 1734.81,
  vrboCommissionSweep: 191.55,
  managementFee: 5516.64,
  sweepEstimated: false,
};
const rv = classifyInternalTransfers(rackliffe, rackliffeExpected, ACCOUNTS);
const kindOf = (verdicts, key) => verdicts.find(v => v.key === key)?.kind ?? null;

check('tax wire recognized', kindOf(rv, 'tax'), 'tax-sweep');
check('tax wire reconciles', rv.find(v => v.key === 'tax')?.reconciles, true);
check('VRBO commission recognized', kindOf(rv, 'comm'), 'commission-sweep');
check('management fee recognized', kindOf(rv, 'fee'), 'mgmt-fee-sweep');
check('all three carry a source', rv.every(v => typeof v.source === 'string' && v.source.length > 0), true);
check('sources are the shipped constants',
  rv.map(v => v.source).sort(),
  [SWEEP_SOURCE['commission-sweep'], SWEEP_SOURCE['mgmt-fee-sweep'], SWEEP_SOURCE['tax-sweep']].sort());

/* ------------------------------------------------------------------ */
console.log('\n4. THE LOAD-BEARING CASES: real reimbursements must survive');
// These three are attributed against live statements. If the classifier
// ever claims one, an owner stops being billed for work already done.

// 20 Hammond, $250.66 AC installation on 2026-06-22. Sits $8.41 from that
// property's $242.25 commission sweep -- the reason the tolerance is a cent
// and not a dollar.
const hammond = classifyInternalTransfers(
  [{ key: 'ac', last4: '5130', amount: 250.66, date: '2026-06-22' }],
  { taxToRemit: 1200.00, vrboCommissionSweep: 242.25, managementFee: 2788.21, sweepEstimated: false },
  ACCOUNTS);
check('AC installation ($8.41 from a real sweep figure) is NOT claimed', hammond.length, 0);

// 17 Beach, $49.99 trash can on 2026-05-26. No tax wire that day.
const beach = classifyInternalTransfers(
  [{ key: 'can', last4: '5130', amount: 49.99, date: '2026-05-26' }],
  { taxToRemit: 900.12, vrboCommissionSweep: 49.99, managementFee: 12171.63, sweepEstimated: false },
  ACCOUNTS);
check('trash can is NOT claimed even at an EXACT tie, with no tax sibling', beach.length, 0);

// 53 Rocky Neck, $26.59 shower door handle on 2026-05-26.
const rockyNeck = classifyInternalTransfers(
  [{ key: 'door', last4: '5130', amount: 26.59, date: '2026-05-26' }],
  { taxToRemit: 800.00, vrboCommissionSweep: 0, managementFee: 4997.11, sweepEstimated: false },
  ACCOUNTS);
check('shower door handle is NOT claimed', rockyNeck.length, 0);

/* ------------------------------------------------------------------ */
console.log('\n5. Refusals: the classifier declines rather than guesses');

check('no prior-month figures means nothing on *5130 is claimed',
  classifyInternalTransfers(
    [{ key: 'a', last4: '5130', amount: 191.55, date: '2026-08-27' }], null, ACCOUNTS).length,
  0);

// 21 Horton's real $685.00 on 2026-08-20 ties no figure at all.
check('an unexplained late-month transfer stays in the queue',
  classifyInternalTransfers(
    [{ key: 'x', last4: '5130', amount: 685.00, date: '2026-08-20' },
     { key: 't', last4: '9928', amount: 500.00, date: '2026-08-20' }],
    { taxToRemit: 500.00, vrboCommissionSweep: 495.15, managementFee: 3266.80, sweepEstimated: false },
    ACCOUNTS).filter(v => v.key === 'x').length,
  0);

check('two rows tying the same figure claims NEITHER',
  classifyInternalTransfers(
    [{ key: 'a', last4: '5130', amount: 191.55, date: '2026-08-27' },
     { key: 'b', last4: '5130', amount: 191.55, date: '2026-08-27' },
     { key: 't', last4: '9928', amount: 1734.81, date: '2026-08-27' }],
    rackliffeExpected, ACCOUNTS).filter(v => v.kind === 'commission-sweep').length,
  0);

check('a zero expected commission never claims anything',
  classifyInternalTransfers(
    [{ key: 'a', last4: '5130', amount: 0, date: '2026-08-27' },
     { key: 't', last4: '9928', amount: 10, date: '2026-08-27' }],
    { taxToRemit: 10, vrboCommissionSweep: 0, managementFee: null, sweepEstimated: false },
    ACCOUNTS).filter(v => v.kind === 'commission-sweep').length,
  0);

check('a transfer to an unknown account is left alone',
  classifyInternalTransfers(
    [{ key: 'a', last4: '1228', amount: 191.55, date: '2026-08-27' }],
    rackliffeExpected, ACCOUNTS).length,
  0);

check('the management-fee window does not extend past day 7',
  classifyInternalTransfers(
    [{ key: 'f', last4: '5130', amount: 5516.64, date: '2026-08-08' }],
    rackliffeExpected, ACCOUNTS).length,
  0);

/* ------------------------------------------------------------------ */
console.log('\n6. Tax leg: classified on destination, reconciled on amount');

// 16 Waterman moved $504.04 against a computed $0. The money is provably
// tax, so it is still kept off the owner's statement -- but the mismatch is
// reported, because it means a stay never made it into Helm.
const waterman = classifyInternalTransfers(
  [{ key: 't', last4: '9928', amount: 504.04, date: '2026-08-27' }],
  { taxToRemit: 0, vrboCommissionSweep: 0, managementFee: 5550.53, sweepEstimated: false },
  ACCOUNTS);
check('a non-tying tax wire is still recognized', kindOf(waterman, 't'), 'tax-sweep');
check('...and reports that it does not reconcile', waterman[0].reconciles, false);
check('...and says it WAS evaluated (a real discrepancy, not a blind spot)', waterman[0].evaluated, true);

const blind = classifyInternalTransfers(
  [{ key: 't', last4: '9928', amount: 504.04, date: '2026-08-27' }], null, ACCOUNTS);
check('with no sheet at all, the tax wire is recognized but NOT called a discrepancy',
  [blind[0].kind, blind[0].evaluated, blind[0].reconciles],
  ['tax-sweep', false, false]);

const split = classifyInternalTransfers(
  [{ key: 'a', last4: '9928', amount: 1000.00, date: '2026-08-27' },
   { key: 'b', last4: '9928', amount: 734.81, date: '2026-08-27' }],
  rackliffeExpected, ACCOUNTS);
check('a tax wire split in two reconciles on the SUM', split.every(v => v.reconciles), true);

/* ------------------------------------------------------------------ */
console.log('\n7. Tolerance is exactly one cent');

const atTolerance = amount => classifyInternalTransfers(
  [{ key: 'c', last4: '5130', amount, date: '2026-08-27' },
   { key: 't', last4: '9928', amount: 1734.81, date: '2026-08-27' }],
  rackliffeExpected, ACCOUNTS).filter(v => v.kind === 'commission-sweep').length;

check('a penny under still matches (float slack)', atTolerance(191.54), 1);
check('a penny over still matches (float slack)', atTolerance(191.56), 1);
check('two cents off does NOT match', atTolerance(191.57), 0);
check('a dollar off does NOT match', atTolerance(192.55), 0);

/* ------------------------------------------------------------------ */
console.log(failures === 0
  ? '\nPASS -- classifier agrees with every pinned live case.\n'
  : `\nFAIL -- ${failures} case(s) diverged.\n`);
process.exit(failures === 0 ? 0 : 1);
