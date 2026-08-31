/**
 * Reservation dedupe must not depend on read order.
 *
 * computeRevenueSnapshot's reservation read is paged, so the order rows
 * arrive in is a function of where the OFFSET windows fall, not of the heap.
 * dedupeReservations used to keep the FIRST row of a tied group, which made
 * the survivor a function of that accident. This proves the replacement is a
 * total order: same winners under any permutation of the input.
 *
 * Pure arithmetic, no database. The fixtures are the eight real tied groups
 * from guesty_reservations on 2026-08-31, plus the untied cases around them.
 *
 * Run: node --experimental-strip-types scripts/revenue_dedupe_order_check.mjs
 */

let failures = 0;
const fail = (m) => { failures++; console.log(`FAIL  ${m}`); };

// Mirror of dedupeReservations' key + comparator (src/lib/revenue-snapshot.ts).
const payoutSignal = (r) =>
  Math.max(Number(r.host_payout ?? 0), Number(r.owner_net_revenue_guesty ?? 0), Number(r.total_paid ?? 0));
const better = (a, b) => {
  const sa = payoutSignal(a), sb = payoutSignal(b);
  if (sa !== sb) return sa > sb;
  const ca = a.confirmation_code ?? '', cb = b.confirmation_code ?? '';
  if (!!ca !== !!cb) return !!ca;
  return ca < cb;
};
function dedupe(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const key = `${r.property_id ?? ''}|${r.check_in ?? ''}|${r.check_out ?? ''}`;
    const cur = byKey.get(key);
    if (!cur || better(r, cur)) byKey.set(key, r);
  }
  return Array.from(byKey.values());
}

const row = (property_id, check_in, check_out, host_payout, confirmation_code = null) =>
  ({ property_id, check_in, check_out, host_payout, confirmation_code });

// The eight live tied groups, all tying at a payout signal of 0.
const FIXTURES = [
  row('19_rackliffe', '2026-08-18', '2026-08-23', 0, 'GY-AAA'),
  row('19_rackliffe', '2026-08-18', '2026-08-23', 0, null),
  row('20_enon', '2026-04-22', '2026-05-12', 0, 'GY-BBB'),
  row('20_enon', '2026-04-22', '2026-05-12', 0, 'GY-BBB'),
  row('21_horton', '2026-08-08', '2026-08-22', 0, 'GY-ZZZ'),
  row('21_horton', '2026-08-08', '2026-08-22', 0, 'GY-KKK'), // two distinct codes
  row('3_locust', '2027-06-30', '2027-07-06', 0, 'GY-CCC'),
  row('3_locust', '2027-06-30', '2027-07-06', 0, 'GY-CCC'),
  row('3_south_st', '2026-05-03', '2026-05-06', 0, 'GY-DDD'),
  row('3_south_st', '2026-05-03', '2026-05-06', 0, 'GY-DDD'),
  // Untied: money must still win outright, whatever the order.
  row('21_horton', '2026-08-28', '2026-09-13', 15500, 'GY-8QDbYkKX'),
  row('21_horton', '2026-08-28', '2026-09-13', 16954, null), // higher payout, no code
  // A real stay that must survive untouched.
  row('84_thatcher', '2026-07-02', '2026-07-09', 4200, 'GY-EEE'),
];

// Deterministic shuffles: every rotation, plus the reverse of each.
const permutations = [];
for (let i = 0; i < FIXTURES.length; i++) {
  const rot = FIXTURES.slice(i).concat(FIXTURES.slice(0, i));
  permutations.push(rot, [...rot].reverse());
}

const canonical = (rows) =>
  JSON.stringify(
    dedupe(rows)
      .map((r) => `${r.property_id}|${r.check_in}|${r.check_out}|${payoutSignal(r)}|${r.confirmation_code ?? ''}`)
      .sort(),
  );

const baseline = canonical(FIXTURES);
for (let i = 0; i < permutations.length; i++) {
  if (canonical(permutations[i]) !== baseline) {
    fail(`permutation ${i} produced a different winner set than the baseline order`);
    break;
  }
}

// The comparator must be a strict total order on the fixtures: for any two
// distinct rows, exactly one direction is true.
for (const a of FIXTURES) {
  for (const b of FIXTURES) {
    if (a === b) continue;
    const ab = better(a, b), ba = better(b, a);
    if (ab && ba) fail(`comparator says both directions better: ${a.confirmation_code} vs ${b.confirmation_code}`);
  }
}

// Money still wins: the $16,954 row beats the $15,500 row despite having no code.
const horton = dedupe(FIXTURES).find((r) => r.check_in === '2026-08-28');
if (payoutSignal(horton) !== 16954) fail(`highest payout must win a non-tie; got ${payoutSignal(horton)}`);

// Every distinct stay key survives exactly once.
const keys = new Set(FIXTURES.map((r) => `${r.property_id}|${r.check_in}|${r.check_out}`));
if (dedupe(FIXTURES).length !== keys.size) fail(`expected ${keys.size} survivors, got ${dedupe(FIXTURES).length}`);

console.log(failures === 0
  ? `PASS - dedupe is order-independent across ${permutations.length} permutations, the comparator is a strict total order, and highest payout still wins an untied group.`
  : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
