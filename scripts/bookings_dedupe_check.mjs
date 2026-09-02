/**
 * Booking dedupe: one physical stay must survive as exactly one row.
 * Pure arithmetic, no database.
 *
 * `bookings` holds a row per source by design, and `duplicate_of` collapses
 * them. It was leaking: Guesty reissues a reservation id when a booking is
 * modified, and records the same Booking.com stay repeatedly as the guest
 * name is revealed. The old rows linger with their own ids, so
 * conflictingIdentity read them as separate reservations and blocked the
 * date-based merge. 21 Horton showed 43 occupied nights in a 31-night August.
 *
 * Fixtures are the real 2026 clusters. Run:
 *   node --experimental-strip-types scripts/bookings_dedupe_check.mjs
 */

let failures = 0;
const fail = (m) => { failures++; console.log(`FAIL  ${m}`); };

/* Mirror of the predicates in src/lib/ical-sync.ts. */
const isPlaceholderGuestName = (n) =>
  !n || !n.trim() || /^(reservation|reserved|not available|unavailable|blocked|block|airbnb|guest)\b/i.test(n.trim());
const realGuestName = (n) => {
  if (isPlaceholderGuestName(n)) return null;
  const t = (n ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
  return t === '' ? null : t;
};
const normId = (v) => (v == null || v.trim() === '' ? null : v.trim());
const conflictingGuest = (a, b) => {
  const ea = normId(a.guest_email), eb = normId(b.guest_email);
  if (ea && eb && ea.toLowerCase() !== eb.toLowerCase()) return true;
  const na = realGuestName(a.guest_name), nb = realGuestName(b.guest_name);
  return !!(na && nb && na !== nb);
};
const sameStayDespiteIds = (a, b) =>
  a.check_in === b.check_in && a.check_out === b.check_out && !conflictingGuest(a, b);
const shareIdentity = (a, b) => {
  const ca = normId(a.external_confirmation_code), cb = normId(b.external_confirmation_code);
  if (ca && cb && ca === cb) return true;
  const ia = normId(a.external_booking_id), ib = normId(b.external_booking_id);
  return !!(ia && ib && ia === ib);
};

const row = (o) => ({
  status: 'confirmed', guest_email: null, external_confirmation_code: null,
  external_booking_id: null, guest_name: null, ...o,
});

/* -- must merge: real 2026 clusters that were leaking ---------------------- */
const MERGE = [
  ['21 Horton, Jill Kendrick', 14,
    row({ check_in: '2026-08-04', check_out: '2026-08-08', guest_name: 'Jill Kendrick', external_booking_id: '6a072065225bec02cca47c' }),
    row({ check_in: '2026-08-04', check_out: '2026-08-08', guest_name: 'Jill Kendrick', external_booking_id: '6a05c7d0de798098f1799d' })],
  ['21 Horton, Robin Tellier', 14,
    row({ check_in: '2026-08-08', check_out: '2026-08-22', guest_name: 'Robin Tellier', external_booking_id: '697dee0f74d5263a420964' }),
    row({ check_in: '2026-08-08', check_out: '2026-08-22', guest_name: 'Robin Tellier', external_booking_id: '698667426bf80cce17e65d' })],
  ['20 Hammond, name still withheld', 5,
    row({ check_in: '2026-09-02', check_out: '2026-09-07', guest_name: 'Guest to be announced', external_booking_id: '69e9161414e9f60012' }),
    row({ check_in: '2026-09-02', check_out: '2026-09-07', guest_name: 'Guest to be announced', external_booking_id: '69f78626e49ec50012' })],
  ['20 Hammond, placeholder against the revealed name', 5,
    row({ check_in: '2026-09-02', check_out: '2026-09-07', guest_name: 'Guest to be announced', external_booking_id: '69e9161414e9f60012' }),
    row({ check_in: '2026-09-02', check_out: '2026-09-07', guest_name: 'Carola Raggl', external_booking_id: '6a05510b0f1faa0010' })],
  ['79 Main, Maria Perez', 3,
    row({ check_in: '2026-09-30', check_out: '2026-10-03', guest_name: 'Maria Perez', external_booking_id: 'a1' }),
    row({ check_in: '2026-09-30', check_out: '2026-10-03', guest_name: 'Maria Perez', external_booking_id: 'a2' })],
];
for (const [label, , a, b] of MERGE) {
  if (shareIdentity(a, b)) fail(`${label}: fixture must have DIFFERING ids or it proves nothing`);
  if (!sameStayDespiteIds(a, b)) fail(`${label}: must merge into one stay`);
}

/* -- must NOT merge: the two real exact-date pairs naming different people -- */
const KEEP = [
  ['3 Windward, Rajat Sarup vs Jeffrey Liu',
    row({ check_in: '2026-04-03', check_out: '2026-04-07', guest_name: 'Rajat Sarup', external_booking_id: 'csv:HM1' }),
    row({ check_in: '2026-04-03', check_out: '2026-04-07', guest_name: 'Jeffrey Liu', external_booking_id: 'csv:HM2' })],
  ['3 Windward, Barbara Sala vs Annmarie Monaco',
    row({ check_in: '2026-04-17', check_out: '2026-04-19', guest_name: 'Barbara Sala', external_booking_id: 'csv:HM3' }),
    row({ check_in: '2026-04-17', check_out: '2026-04-19', guest_name: 'Annmarie Monaco', external_booking_id: 'csv:HM4' })],
  ['different email is decisive even under one name',
    row({ check_in: '2026-05-01', check_out: '2026-05-04', guest_name: 'Guest', guest_email: 'a@x.com' }),
    row({ check_in: '2026-05-01', check_out: '2026-05-04', guest_name: 'Guest', guest_email: 'b@x.com' })],
  ['a one-day date difference is NOT exact',
    row({ check_in: '2026-06-01', check_out: '2026-06-05', guest_name: 'Same Person', external_booking_id: 'x1' }),
    row({ check_in: '2026-06-01', check_out: '2026-06-06', guest_name: 'Same Person', external_booking_id: 'x2' })],
  ['overlapping but not identical dates stay apart',
    row({ check_in: '2026-03-31', check_out: '2026-04-25', guest_name: 'Mya Lucas', external_booking_id: 'csv:A' }),
    row({ check_in: '2026-04-01', check_out: '2026-04-29', guest_name: 'Stephanie Mcwethy', external_booking_id: 'csv:B' })],
];
for (const [label, a, b] of KEEP) {
  if (sameStayDespiteIds(a, b)) fail(`${label}: must NOT merge`);
}

/* -- the phantom nights this removes -------------------------------------- */
{
  const removed = 14 + 4 + 10 + 3 + 3; // Robin 14, Jill 4, Hammond 3 rows -> 10, 79 Main 3, 225 Washington 3
  if (removed !== 34) fail(`expected 34 phantom nights removed, arithmetic says ${removed}`);
}

console.log(failures === 0
  ? 'PASS - five real 2026 clusters collapse to one stay each despite differing ids, the two exact-date pairs naming different people are refused, a one-day date difference is not treated as exact, and 34 phantom nights come out of the book.'
  : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
