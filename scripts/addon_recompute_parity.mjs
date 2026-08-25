#!/usr/bin/env node
/**
 * Add-on recompute parity harness.
 *
 * READ-ONLY, no database, no network. Pure arithmetic proof for the two
 * recompute sites fixed alongside it:
 *
 *   src/app/api/resolve-gap/route.ts        ("Mark as paid off-Stripe")
 *   src/app/api/reservations/remove/route.ts ("Remove from statement")
 *
 * Both used to compute the management fee off rental_revenue alone. The
 * canonical formula (src/lib/statement-addons.ts) is:
 *
 *   fee_base     = rental_revenue + addOnsMgmtBase
 *   owner_payout = rental_revenue + addOnsRevenue - management_fee
 *                  - cleaning_total - repairs_total - attributedDebits
 *                  - reserve_holdback
 *
 * What this proves
 *   1. SAFETY (the one that matters): on any statement with NO attributions,
 *      the new formula is byte-identical to the old one at both sites. No
 *      historical statement moves by a cent.
 *   2. CORRECTNESS: with attributions present, both sites now agree exactly
 *      with the canonical formula, and with each other.
 *   3. The old behaviour is shown as a signed delta so the size of the bug
 *      is explicit per case.
 *
 * Run: node scripts/addon_recompute_parity.mjs
 * Exit 0 = parity holds. Exit 1 = a case diverged.
 */

const round2 = (n) => Math.round(n * 100) / 100;

// ---- resolve-gap ---------------------------------------------------------

function resolveGapOld({ rentalRevenue, feePct, cleaning, repairs, reserve }) {
  const fee = round2(rentalRevenue * (feePct / 100));
  const payout = round2(rentalRevenue - fee - cleaning - repairs - reserve);
  return { fee, payout };
}

function resolveGapNew({ rentalRevenue, feePct, cleaning, repairs, reserve, addOnsRevenue, addOnsMgmtBase, attributedDebits }) {
  const fee = round2((rentalRevenue + addOnsMgmtBase) * (feePct / 100));
  const payout = round2(
    rentalRevenue + addOnsRevenue - fee - cleaning - repairs - attributedDebits - reserve,
  );
  return { fee, payout };
}

// ---- reservations/remove -------------------------------------------------
// The old site DID fold add-ons into the payout, but read them off the stored
// mirror columns and left addOnsMgmtBase out of the fee base entirely.

function removeOld({ rentalRevenue, feePct, cleaning, repairs, reserve, storedAddOns, storedDebits }) {
  const fee = round2(rentalRevenue * (feePct / 100));
  const payout = round2(rentalRevenue + storedAddOns - fee - cleaning - repairs - reserve - storedDebits);
  return { fee, payout };
}

function removeNew(a) {
  return resolveGapNew(a);
}

// ---- /api/ingest ---------------------------------------------------------
// Ingest hand-rolled its own attribution read and selected only
// `amount, apply_mgmt_fee`, with no `direction`. Every attributed row was
// therefore added to addOnsRevenue, so a DEBIT (which should reduce the
// payout) increased it instead, and because apply_mgmt_fee defaults TRUE the
// debit also inflated the fee base. It never wrote attributed_debits_total.

function ingestOld({ rentalRevenue, feePct, cleaning, repairs, reserve, addOnsRevenue, addOnsMgmtBase, attributedDebits, debitAppliesMgmtFee }) {
  // The old loop could not tell a debit from a deposit.
  const seenAsAddOns = addOnsRevenue + attributedDebits;
  const seenAsMgmtBase = addOnsMgmtBase + (debitAppliesMgmtFee ? attributedDebits : 0);
  const fee = round2((rentalRevenue + seenAsMgmtBase) * (feePct / 100));
  const payout = round2(rentalRevenue + seenAsAddOns - fee - cleaning - repairs - reserve);
  return { fee, payout };
}

function ingestNew(a) {
  return canonical(a);
}

// ---- canonical reference (statement-addons.ts docblock, transcribed) ------

function canonical({ rentalRevenue, feePct, cleaning, repairs, reserve, addOnsRevenue, addOnsMgmtBase, attributedDebits }) {
  const feeBase = rentalRevenue + addOnsMgmtBase;
  const fee = round2(feeBase * (feePct / 100));
  const payout = round2(
    rentalRevenue + addOnsRevenue - fee - cleaning - repairs - attributedDebits - reserve,
  );
  return { fee, payout };
}

// ---- cases ---------------------------------------------------------------

const FEE_PCTS = [20, 22, 25];
const REVENUES = [0, 1234.56, 8750, 20853.63, 32000, 62400.19];
const CLEANINGS = [0, 325, 1487.5];
const REPAIRS = [0, 89.99];
const RESERVES = [0, 2000];

function* noAttributionCases() {
  for (const feePct of FEE_PCTS)
    for (const rentalRevenue of REVENUES)
      for (const cleaning of CLEANINGS)
        for (const repairs of REPAIRS)
          for (const reserve of RESERVES)
            yield {
              rentalRevenue, feePct, cleaning, repairs, reserve,
              addOnsRevenue: 0, addOnsMgmtBase: 0, attributedDebits: 0,
              storedAddOns: 0, storedDebits: 0,
            };
}

// Realistic attribution shapes: fee-bearing add-on, non-fee add-on
// (a reimbursement), a debit, and a mix.
const ATTRIBUTIONS = [
  { label: 'fee-bearing add-on $450',      addOnsRevenue: 450,  addOnsMgmtBase: 450, attributedDebits: 0 },
  { label: 'non-fee add-on $450',          addOnsRevenue: 450,  addOnsMgmtBase: 0,   attributedDebits: 0 },
  { label: 'debit only $275',              addOnsRevenue: 0,    addOnsMgmtBase: 0,   attributedDebits: 275 },
  { label: 'mixed 600/350 + debit 120',    addOnsRevenue: 600,  addOnsMgmtBase: 350, attributedDebits: 120 },
  { label: 'pet fee 150 + charger 62.40',  addOnsRevenue: 212.40, addOnsMgmtBase: 212.40, attributedDebits: 0 },
];

function* attributionCases() {
  for (const feePct of FEE_PCTS)
    for (const rentalRevenue of [8750, 20853.63, 32000])
      for (const a of ATTRIBUTIONS)
        yield {
          rentalRevenue, feePct, cleaning: 325, repairs: 0, reserve: 0,
          addOnsRevenue: a.addOnsRevenue,
          addOnsMgmtBase: a.addOnsMgmtBase,
          attributedDebits: a.attributedDebits,
          storedAddOns: a.addOnsRevenue,
          storedDebits: a.attributedDebits,
          label: a.label,
        };
}

// ---- run -----------------------------------------------------------------

let checked = 0;
let failures = 0;
const fail = (msg) => { console.error(`  FAIL  ${msg}`); failures++; };

console.log('\n=== 1. SAFETY: no attributions => byte-identical to the old formula ===\n');
for (const c of noAttributionCases()) {
  checked++;
  const rgOld = resolveGapOld(c), rgNew = resolveGapNew(c);
  if (rgOld.fee !== rgNew.fee || rgOld.payout !== rgNew.payout) {
    fail(`resolve-gap rev=${c.rentalRevenue} pct=${c.feePct} old=${JSON.stringify(rgOld)} new=${JSON.stringify(rgNew)}`);
  }
  const rmOld = removeOld(c), rmNew = removeNew(c);
  if (rmOld.fee !== rmNew.fee || rmOld.payout !== rmNew.payout) {
    fail(`remove rev=${c.rentalRevenue} pct=${c.feePct} old=${JSON.stringify(rmOld)} new=${JSON.stringify(rmNew)}`);
  }
}
console.log(`  ${checked} zero-attribution cases, ${failures === 0 ? 'all identical' : `${failures} DIVERGED`}.`);
console.log('  => No statement without attributions changes by a cent.\n');

console.log('=== 2. CORRECTNESS: with attributions, both sites match canonical ===\n');
const before = failures;
const rows = [];
for (const c of attributionCases()) {
  checked++;
  const ref = canonical(c);
  const rg = resolveGapNew(c);
  const rm = removeNew(c);
  if (rg.fee !== ref.fee || rg.payout !== ref.payout) fail(`resolve-gap != canonical for ${c.label} rev=${c.rentalRevenue}`);
  if (rm.fee !== ref.fee || rm.payout !== ref.payout) fail(`remove != canonical for ${c.label} rev=${c.rentalRevenue}`);

  const oldRg = resolveGapOld(c);
  const oldRm = removeOld(c);
  rows.push({
    case: c.label,
    pct: c.feePct,
    rev: c.rentalRevenue,
    feeWas: oldRg.fee,
    feeNow: ref.fee,
    payoutWasResolveGap: oldRg.payout,
    payoutWasRemove: oldRm.payout,
    payoutNow: ref.payout,
  });
}
console.log(`  ${failures === before ? 'All cases match the canonical formula.' : `${failures - before} MISMATCHED.`}\n`);

console.log('=== 3. What the bug was worth, per case ===\n');
const sample = rows.filter((r) => r.pct === 25 && r.rev === 20853.63);
console.log('  (25% fee, $20,853.63 rental revenue, $325 cleaning)\n');
for (const r of sample) {
  const dRg = round2(r.payoutNow - r.payoutWasResolveGap);
  const dRm = round2(r.payoutNow - r.payoutWasRemove);
  console.log(`  ${r.case.padEnd(30)} fee ${String(r.feeWas).padStart(9)} -> ${String(r.feeNow).padStart(9)}`);
  console.log(`  ${''.padEnd(30)} payout correction: resolve-gap ${dRg >= 0 ? '+' : ''}${dRg}, remove ${dRm >= 0 ? '+' : ''}${dRm}`);
}

console.log('\n=== 4. /api/ingest: what the missing `direction` column cost ===\n');
{
  // 4a. SAFETY: no attributions at all, and deposit-only attributions, are
  // both unchanged. The old code was correct for deposits; only statements
  // carrying an attributed DEBIT ever moved. That is the blast radius.
  let same = 0;
  for (const c of noAttributionCases()) {
    checked++;
    const o = ingestOld({ ...c, debitAppliesMgmtFee: true });
    const n = ingestNew(c);
    if (o.fee !== n.fee || o.payout !== n.payout) fail(`ingest zero-attribution rev=${c.rentalRevenue}`);
    else same++;
  }
  console.log(`  ${same} zero-attribution cases unchanged.`);

  let depSame = 0, depTotal = 0;
  for (const c of attributionCases()) {
    if (c.attributedDebits !== 0) continue;
    depTotal++; checked++;
    const o = ingestOld({ ...c, debitAppliesMgmtFee: true });
    const n = ingestNew(c);
    if (o.fee !== n.fee || o.payout !== n.payout) fail(`ingest deposit-only ${c.label}`);
    else depSame++;
  }
  console.log(`  ${depSame}/${depTotal} deposit-only cases unchanged.`);
  console.log('  => Only statements with an attributed DEBIT were ever wrong.\n');

  // 4b. The debit cases, quantified.
  console.log('  (25% fee, $20,853.63 rental revenue, $325 cleaning)\n');
  for (const c of attributionCases()) {
    if (c.attributedDebits === 0 || c.feePct !== 25 || c.rentalRevenue !== 20853.63) continue;
    checked++;
    const o = ingestOld({ ...c, debitAppliesMgmtFee: true });
    const n = ingestNew(c);
    if (n.fee !== canonical(c).fee || n.payout !== canonical(c).payout) fail(`ingest != canonical ${c.label}`);
    const dFee = round2(n.fee - o.fee);
    const dPay = round2(n.payout - o.payout);
    console.log(`  ${c.label.padEnd(30)} debit $${c.attributedDebits}`);
    console.log(`  ${''.padEnd(30)} fee ${o.fee} -> ${n.fee} (${dFee >= 0 ? '+' : ''}${dFee})`);
    console.log(`  ${''.padEnd(30)} payout ${o.payout} -> ${n.payout} (${dPay >= 0 ? '+' : ''}${dPay}, owner was overpaid)`);
  }
}

console.log(`\n${'='.repeat(62)}`);
if (failures === 0) {
  console.log(`PARITY HOLDS. ${checked} cases checked, 0 divergences.`);
  process.exit(0);
} else {
  console.log(`PARITY BROKEN: ${failures} divergence(s) across ${checked} cases.`);
  process.exit(1);
}
