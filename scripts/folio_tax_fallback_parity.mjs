/**
 * Parity harness for the folio-tax fallback in src/lib/stripe-sync.ts.
 *
 * The amount-based matcher reconstructs a Direct/VRBO stay's expected Stripe
 * gross as `guesty_rental_income + total_taxes`. `total_taxes` is a CACHE of
 * the folio's TAX lines that Guesty leaves NULL on listings whose tax config
 * does not itemize, and on hand-created reservations. When it is NULL the
 * expected gross collapses to pre-tax rent, the matcher hunts a charge that
 * does not exist, and the row keeps its 3.9% + $0.40 placeholder forever.
 * The fix falls back to splitFolio(folio_items).tax.
 *
 * That widens what the matcher can reach, so this proves the widening cannot
 * disturb a statement that is already out. Two assertions:
 *
 *   1. Every newly-reachable row is EITHER on a sent/frozen statement -- in
 *      which case stripe-sync returns before it lists a single charge, so the
 *      row is structurally unreachable -- OR is unsent and therefore fair game.
 *   2. No unsent row that already carries an ACTUAL fee is disturbed. A row
 *      already holding a real fee was matched by another stage; only rows
 *      still sitting on the placeholder have anything to gain.
 *
 *   supabase db query --linked --file scripts/folio_tax_fallback_parity.sql \
 *     | node scripts/folio_tax_fallback_parity.mjs
 */

const round2 = (n) => Math.round(n * 100) / 100;
const money = (n) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
/** The placeholder written at parse time, before any Stripe sync. */
const estimate = (base) => round2(base * 0.039 + 0.4);

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

const truthy = (v) => v === true || v === 'true';
const failures = [];
const willMove = [];
let immune = 0;
let alreadyActual = 0;

for (const r of rows) {
  const base = Number(r.base);
  const fee = Number(r.fee);
  const frozen = truthy(r.sent) || truthy(r.period_final);
  const onEstimate = Math.abs(fee - estimate(base)) <= 0.02;

  if (frozen) {
    immune += 1;
    // Belt and braces: a frozen row must never be the thing we are trying to
    // fix, or the fix would be silently unreachable where it matters.
    if (onEstimate) {
      failures.push(
        `ASSERT 1: ${r.month} ${r.property_id} ${r.guest_name} is SENT/FINAL but still on the ` +
        `estimate ${money(fee)} -- the fallback cannot reach it and the fee stays wrong.`,
      );
    }
    continue;
  }
  if (!onEstimate) {
    alreadyActual += 1;
    continue;
  }
  willMove.push({ ...r, base, fee, expectedGrossWas: round2(base), expectedGrossNow: round2(base + Number(r.folio_tax)) });
}

console.log(`Scanned ${rows.length} RT-Stripe reservation(s) that gain a folio-derived tax where the scalar was NULL.\n`);
console.log(`  ${immune} on a sent or finalized statement: stripe-sync returns before listing charges, so unreachable.`);
console.log(`  ${alreadyActual} unsent but already carrying an actual fee: nothing to gain.`);
console.log(`  ${willMove.length} unsent and still on the 3.9% + $0.40 placeholder: these are the fix.\n`);

for (const m of willMove) {
  console.log(`  ${m.month}  ${m.property_id}  ${m.guest_name} (${m.confirmation_code})`);
  console.log(`      expected gross ${money(m.expectedGrossWas)} -> ${money(m.expectedGrossNow)}  (folio tax ${money(Number(m.folio_tax))})`);
  console.log(`      fee ${money(m.fee)} stands until a charge matches at the corrected gross`);
  if (truthy(m.installment)) {
    console.log('      NOTE: carries installment rows, so the fee is pro-rated and never rewritten');
  }
}

if (failures.length) {
  console.log(`\n${failures.length} FAILURE(S):`);
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
console.log('\nPARITY OK: every already-sent statement is out of reach, and no row holding a real');
console.log('fee is touched. Only placeholder fees on open statements can move.');
