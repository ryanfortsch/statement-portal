/**
 * Parity harness for the per-stay folio rate in applyCollectedNet
 * (src/lib/stripe-sync.ts).
 *
 * A Direct charge reads tax-inclusive, so recognizing its rent means dividing
 * by the occupancy tax rate. That rate used to come from a property-level map.
 * A property-level rate cannot express a per-stay exception, and 17 Beach had
 * one: every Direct/VRBO folio there billed the 3% CIF except Brian Guest
 * Spillover GY-EcKUjyqJ, whose CIF line was hand-zeroed, so the guest really
 * did pay 11.7%. Inverting his $1,172.85 at the property's 1.147 recognized
 * $1,022.54 against a folio that says $1,050.00 and cost the owner $15.93.
 *
 * The inversion now uses the rate written on the booking's own folio. This
 * replays both rates over every MANUAL stay that has a folio and reports the
 * disagreements, asserting:
 *
 *   1. No stay on a sent or finalized statement moves. (Belt and braces --
 *      stripe-sync's freeze gate returns before it lists a charge -- but a
 *      harness that only trusts the gate proves nothing about the gate.)
 *   2. Every stay that does move lands ON its folio's pre-tax total, which is
 *      Guesty's own arithmetic and the number the owner's statement shows.
 *
 *   supabase db query --linked --file scripts/stay_folio_rate_parity.sql \
 *     | node scripts/stay_folio_rate_parity.mjs
 */
import { occupancyTaxMultiplier } from '../src/lib/occupancy-tax.ts';

const round2 = (n) => Math.round(n * 100) / 100;
const money = (n) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
const truthy = (v) => v === true || v === 'true';

const raw = await new Promise((resolve) => {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (buf += c));
  process.stdin.on('end', () => resolve(buf));
});
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

const failures = [];
const moved = [];
let agreed = 0;
let skippedInstallment = 0;

for (const r of rows) {
  if (truthy(r.installment)) { skippedInstallment += 1; continue; }

  const base = Number(r.base);
  const fee = Number(r.fee);
  const net = Number(r.net);
  const folioTax = Number(r.folio_tax);
  const folioPreTax = Number(r.folio_pretax);
  const frozen = truthy(r.sent) || truthy(r.period_final);

  // Probe the map mid-month: the exact charge date is not in this feed, and
  // no CIF window opens or closes mid-month on any mapped property.
  //
  // Compare at 4dp, the precision an occupancy rate actually carries. The
  // folio quotient reproduces 1.117 as 1.1170000000000002 and a raw epsilon
  // reads 25 sent stays as "disagreeing" over a rounding cent. In production
  // that cent cannot escape either: when the two rates agree the inversion
  // lands within $1 of the folio pre-tax, so applyCollectedNet takes its
  // agree branch and writes `base - fee`, discarding collectedPreTax. The
  // quotient only ever feeds a $1-tolerance comparison, which a cent cannot
  // flip.
  const q4 = (n) => Math.round(n * 10000) / 10000;
  const mapRate = q4(occupancyTaxMultiplier(r.property_id, `${r.month}-15`));
  const stayRate = q4((folioPreTax + folioTax) / folioPreTax);
  if (mapRate === stayRate) { agreed += 1; continue; }

  // What the charge would have been, and what each rate makes of it.
  const collectedGross = round2(folioPreTax + folioTax);
  const preTaxOld = round2(collectedGross / mapRate);
  const preTaxNew = round2(collectedGross / stayRate);
  const netOld = round2(preTaxOld - fee);
  const netNew = round2(preTaxNew - fee);

  moved.push({ ...r, base, fee, net, mapRate, stayRate, preTaxOld, preTaxNew, netOld, netNew, delta: round2(netNew - netOld), frozen });

  if (frozen) {
    failures.push(
      `ASSERT 1: ${r.month} ${r.property_id} ${r.guest_name} is SENT/FINAL but its rate ` +
      `disagrees (${mapRate.toFixed(4)} vs ${stayRate.toFixed(4)}), worth ${money(round2(netNew - netOld))}`,
    );
  }
  if (Math.abs(preTaxNew - folioPreTax) > 0.02) {
    failures.push(
      `ASSERT 2: ${r.month} ${r.property_id} ${r.guest_name} lands ${money(preTaxNew)}, ` +
      `not its folio pre-tax ${money(folioPreTax)}`,
    );
  }
}

console.log(`Scanned ${rows.length} MANUAL stay(s) carrying a folio with tax.\n`);
console.log(`  ${agreed} where the folio's rate already equals the property map: inert.`);
console.log(`  ${skippedInstallment} installment rows: applyCollectedNet refuses them outright.`);
console.log(`  ${moved.length} where the two rates disagree.\n`);

for (const m of moved) {
  console.log(`  ${m.month}  ${m.property_id}  ${m.guest_name} (${m.confirmation_code})${m.frozen ? '  [SENT/FINAL]' : ''}`);
  console.log(`      map ${m.mapRate.toFixed(4)} -> stay ${m.stayRate.toFixed(4)} (from the folio's own ${money(Number(m.folio_tax))} on ${money(Number(m.folio_pretax))})`);
  console.log(`      rent ${money(m.preTaxOld)} -> ${money(m.preTaxNew)}   net ${money(m.netOld)} -> ${money(m.netNew)}   owner ${m.delta >= 0 ? '+' : ''}${money(m.delta)}`);
}

if (failures.length) {
  console.log(`\n${failures.length} FAILURE(S):`);
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
console.log('\nPARITY OK: no sent or finalized statement disagrees, and every moving stay');
console.log("lands exactly on its folio's pre-tax total.");
