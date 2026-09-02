/**
 * A cancellation dated after checkout is not a cancellation.
 * Pure arithmetic, no database.
 *
 * iCal feeds drop past events routinely and the sync marks the vanished row
 * cancelled. That is deliberate: the row is history. What it must not do is
 * speak for the whole stay. Once same-stay clustering got tighter, a rolled-off
 * past row started landing beside the Guesty rows that say confirmed, and one
 * dropped past event cancelled a stay that demonstrably happened: 99 stays,
 * 392 nights, with 21 Horton 2026-08-08 to 08-22 the worked case.
 *
 * Run: node --experimental-strip-types scripts/booking_cancel_signal_check.mjs
 */

let failures = 0;
const fail = (m) => { failures++; console.log(`FAIL  ${m}`); };

/* Mirrors src/lib/ical-sync.ts. */
const isPostStayCancel = (r) =>
  !!r.cancelled_at && r.cancelled_at.slice(0, 10) > r.check_out;
const POSITIVE_STATUS_ORDER = ['confirmed', 'completed', 'block'];
const clusterEffectiveStatus = (cluster, isAggregate) => {
  const trusted = cluster.some(
    (r) => r.status === 'cancelled' && !isAggregate(r) && !isPostStayCancel(r),
  );
  if (trusted) return 'cancelled';
  for (const s of POSITIVE_STATUS_ORDER) if (cluster.some((r) => r.status === s)) return s;
  return 'cancelled';
};
const notAggregate = () => false;
const row = (o) => ({ status: 'confirmed', cancelled_at: null, ...o });

/* -- the worked case: 21 Horton, Robin Tellier ---------------------------- */
{
  const cluster = [
    row({ check_in: '2026-08-08', check_out: '2026-08-22', status: 'confirmed' }),
    row({ check_in: '2026-08-08', check_out: '2026-08-22', status: 'confirmed' }),
    row({ check_in: '2026-08-08', check_out: '2026-08-22', status: 'confirmed' }),
    row({ check_in: '2026-08-08', check_out: '2026-08-22', status: 'cancelled', cancelled_at: '2026-08-23T04:00:00Z' }),
    row({ check_in: '2026-08-08', check_out: '2026-08-22', status: 'cancelled', cancelled_at: '2026-08-24T04:00:00Z' }),
  ];
  if (clusterEffectiveStatus(cluster, notAggregate) !== 'confirmed') {
    fail('a stay that already happened must survive two post-checkout cancels');
  }
}

/* -- a genuine cancellation of a FUTURE stay must still cancel ------------ */
{
  const cluster = [
    row({ check_in: '2026-10-08', check_out: '2026-10-12', status: 'confirmed' }),
    row({ check_in: '2026-10-08', check_out: '2026-10-12', status: 'cancelled', cancelled_at: '2026-09-15T10:00:00Z' }),
  ];
  if (clusterEffectiveStatus(cluster, notAggregate) !== 'cancelled') {
    fail('a cancel dated before checkout must still cancel the stay');
  }
}

/* -- boundary: cancelled ON the checkout date is still a real cancel ------ */
{
  const r1 = row({ check_in: '2026-08-08', check_out: '2026-08-22', status: 'cancelled', cancelled_at: '2026-08-22T09:00:00Z' });
  if (isPostStayCancel(r1)) fail('a cancel ON the checkout date is not post-stay');
  const r2 = row({ check_in: '2026-08-08', check_out: '2026-08-22', status: 'cancelled', cancelled_at: '2026-08-23T00:00:00Z' });
  if (!isPostStayCancel(r2)) fail('a cancel the day after checkout IS post-stay');
}

/* -- no timestamp: unchanged, still trusted ------------------------------- */
{
  const cluster = [
    row({ check_in: '2026-08-08', check_out: '2026-08-22', status: 'confirmed' }),
    row({ check_in: '2026-08-08', check_out: '2026-08-22', status: 'cancelled', cancelled_at: null }),
  ];
  if (clusterEffectiveStatus(cluster, notAggregate) !== 'cancelled') {
    fail('a cancel with no timestamp must keep the old behaviour and still cancel');
  }
}

/* -- the aggregate-feed rule is untouched -------------------------------- */
{
  const cluster = [
    row({ check_in: '2026-10-08', check_out: '2026-10-12', status: 'confirmed' }),
    row({ check_in: '2026-10-08', check_out: '2026-10-12', status: 'cancelled', cancelled_at: '2026-09-15T10:00:00Z' }),
  ];
  if (clusterEffectiveStatus(cluster, () => true) !== 'confirmed') {
    fail('a cancel from the Guesty aggregate feed must still be distrusted');
  }
}

console.log(failures === 0
  ? 'PASS - a stay survives post-checkout cancels, a genuine future cancel still cancels, the checkout date itself is not post-stay, a cancel with no timestamp keeps the old behaviour, and the aggregate-feed distrust rule is unchanged.'
  : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
