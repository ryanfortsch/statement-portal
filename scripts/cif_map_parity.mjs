/**
 * Parity harness for the 2026-09-01 CIF map change (occupancy-tax.ts:
 * 17_beach_rd, 3_south_st and 3_windward added to CIF_EFFECTIVE_FROM).
 *
 * WHAT THE CHANGE DOES
 *   `applyCollectedNet` in src/lib/stripe-sync.ts recognizes a Direct stay's
 *   revenue from the money actually collected, inverting the tax-inclusive
 *   Stripe charge by `occupancyTaxMultiplier(propertyId, chargeDate)`. An
 *   unmapped property inverts at 1.117 even though its guests were charged
 *   14.7%, so the 3% Community Impact Fee is recognized as RENT and paid to
 *   the owner while Rising Tide still owes it to Gloucester.
 *
 * WHAT THIS PROVES
 *   For every reservation fleet-wide that currently carries a collected-net
 *   rebuild, recompute the net under the new multiplier and report the delta.
 *   Three assertions must hold:
 *     1. no row on a property OUTSIDE the newly-mapped three moves
 *     2. no row on an EMAILED statement moves (sent statements are frozen;
 *        see the email_sent_at gate in stripe-sync.ts)
 *     3. every moving row lands on `folio pre-tax - actual fee`, i.e. the
 *        value the "folio and charge agree" branch writes once the rate is
 *        right, and always DOWNWARD (the old rate over-credited)
 *
 *   A rebuilt row's collected gross is recoverable exactly from what was
 *   stored, since net = collectedGross / oldMultiplier - fee. Rows with no
 *   rebuild cannot move: the multiplier only enters through that path (and
 *   through refund PAIR MATCHING, which sets no revenue).
 *
 * RUN (read-only; needs the Supabase CLI linked, no service-role key):
 *
 *   supabase db query --linked "$(cat scripts/cif_map_parity.sql)" \
 *     | node scripts/cif_map_parity.mjs
 *
 * Exits non-zero if any assertion fails.
 */

const BASE = 0.117;
const CIF = 0.03;
const NEWLY_MAPPED = new Set(['17_beach_rd', '3_south_st', '3_windward']);
const ALREADY_MAPPED = new Set(['79_main']);

const round2 = (n) => Math.round(n * 100) / 100;
const money = (n) => `$${n.toFixed(2)}`;

function multiplier(propertyId, mapped) {
  return 1 + BASE + (mapped.has(propertyId) ? CIF : 0);
}

const raw = await new Promise((resolve) => {
  let buf = '';
  process.stdin.on('data', (c) => (buf += c));
  process.stdin.on('end', () => resolve(buf));
});

// The CLI wraps results in a boundary envelope; pull the JSON object out.
const match = raw.match(/\{[\s\S]*\}/);
if (!match) {
  console.error('No JSON found on stdin. Pipe `supabase db query --linked` output in.');
  process.exit(1);
}
const rows = JSON.parse(match[0]).rows ?? [];
if (rows.length === 0) {
  console.error('No rows returned; the query fed in is wrong.');
  process.exit(1);
}

const before = new Set([...ALREADY_MAPPED]);
const after = new Set([...ALREADY_MAPPED, ...NEWLY_MAPPED]);

const moved = [];
const failures = [];
let skippedNonManual = 0;
let skippedInstallment = 0;

for (const r of rows) {
  const propertyId = r.property_id;
  const base = Number(r.base);            // guesty_rental_income (folio pre-tax)
  const fee = Number(r.fee);              // stripe_fee (actual, post-sync)
  const net = Number(r.net);              // adjusted_revenue as stored
  const sent = r.sent === true || r.sent === 'true';
  const installment = r.installment === true || r.installment === 'true';

  // Mirror applyCollectedNet's own gates, in its order (stripe-sync.ts:524).
  // MANUAL only: a VRBO/HomeAway row's net legitimately differs from
  // base - fee because ingest nets the 5% channel commission out of it, and
  // reading that as a "rebuild" is what made an earlier draft of this
  // harness report a phantom move on Melissa Jordan.
  if ((r.platform || '').toUpperCase() !== 'MANUAL') {
    skippedNonManual += 1;
    continue;
  }
  // Installment rows are refused outright, so they cannot move.
  if (installment) {
    skippedInstallment += 1;
    continue;
  }
  // A stored net equal to base - fee carries no collected-net rebuild, so
  // the multiplier never entered it.
  const plain = round2(base - fee);
  if (Math.abs(net - plain) <= 0.02) continue;

  const mOld = multiplier(propertyId, before);
  const mNew = multiplier(propertyId, after);
  if (mOld === mNew) continue; // property not touched by this change

  // Recover the collected gross from what the old inversion stored, then
  // re-invert at the corrected rate.
  const collectedGross = round2((net + fee) * mOld);
  const preTaxNew = round2(collectedGross / mNew);
  const netNew = round2(preTaxNew - fee);
  const delta = round2(netNew - net);
  if (Math.abs(delta) < 0.01) continue;

  moved.push({ ...r, base, fee, net, netNew, delta, collectedGross, preTaxNew, sent });

  if (!NEWLY_MAPPED.has(propertyId)) {
    failures.push(`ASSERT 1: ${propertyId} is outside the mapped set but moved ${money(delta)}`);
  }
  if (sent) {
    failures.push(`ASSERT 2: ${r.month} ${propertyId} ${r.guest_name} is EMAILED but moved ${money(delta)}`);
  }
  if (Math.abs(netNew - plain) > 0.02) {
    failures.push(
      `ASSERT 3: ${r.month} ${propertyId} ${r.guest_name} lands ${money(netNew)}, ` +
      `not folio-minus-fee ${money(plain)}`,
    );
  }
  if (delta > 0) {
    failures.push(`ASSERT 3: ${r.month} ${propertyId} ${r.guest_name} moved UP ${money(delta)}`);
  }
}

console.log(`Scanned ${rows.length} Direct/VRBO/Manual reservation rows fleet-wide.`);
console.log(`  ${skippedNonManual} skipped: not MANUAL (applyCollectedNet refuses them)`);
console.log(`  ${skippedInstallment} skipped: installment rows (refused outright)\n`);

if (moved.length === 0) {
  console.log('No rows move. (Expected only if the fix is already applied and synced.)');
} else {
  console.log(`${moved.length} row(s) move:\n`);
  for (const m of moved) {
    console.log(`  ${m.month}  ${m.property_id}  ${m.guest_name}`);
    console.log(`      collected ${money(m.collectedGross)} -> pre-tax ${money(m.base)} (was recognized as ${money(round2(m.net + m.fee))})`);
    console.log(`      net ${money(m.net)} -> ${money(m.netNew)}   delta ${money(m.delta)}   emailed=${m.sent}\n`);
  }
  const total = round2(moved.reduce((s, m) => s + m.delta, 0));
  console.log(`Total revenue correction: ${money(total)}\n`);
}

if (failures.length > 0) {
  console.error('PARITY FAILED:');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log('PARITY OK: every moving row is on a newly-mapped property, unsent,');
console.log('lands exactly on folio-pre-tax minus actual fee, and moves downward.');
