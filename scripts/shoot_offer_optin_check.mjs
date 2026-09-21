/**
 * A shoot is OFFERED, never assigned: the invariant audit.
 *
 * The planner grid shipped writing a committed shoot and texting the
 * contributor "it's on for Wednesday" (Dotti, 2026-09-21: "you can't just
 * book him, he has to opt in"). The fix adds two states, `offered` and
 * `declined`, and the whole thing rests on one rule:
 *
 *     AN OFFER IS NEVER WORK.
 *
 * Until the contributor accepts, a shoot must not reveal a door code, must
 * not be scanned for deliveries, must not get the 8 AM go/no-go text, must
 * not appear in the pay ledger, and must not count on anyone's profile.
 * Each of those is one filter in one file, and any of them silently dropped
 * puts us back where we started. So this checks the rule twice:
 *
 *   1. the pure predicates, mirrored and matched against the source, and
 *   2. the rails themselves, by asserting each guard is still in the file.
 *
 * (2) is unusual for a check, but these guards are load-bearing and easy to
 * delete by accident. There is no test runner here, so this is the net.
 *
 * Run:
 *   node --experimental-strip-types scripts/shoot_offer_optin_check.mjs
 */

import { readFileSync } from 'node:fs';

let failures = 0;
const fail = (m) => { failures++; console.log(`FAIL  ${m}`); };
const eq = (label, got, want) => { if (got !== want) fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
/** Assert a file still contains a load-bearing guard. */
const guard = (file, needle, why) => {
  if (!read(file).includes(needle)) fail(`${file} lost its guard (${why})\n      missing: ${needle}`);
};

/* ── 1. the rule itself ───────────────────────────────────────────── */

const ALL = ['offered', 'scheduled', 'declined', 'shot', 'delivered', 'approved', 'settled', 'cancelled'];
const isOffer = (s) => s === 'offered';
const isPreWork = (s) => s === 'offered' || s === 'declined';

// The mirror must match the source, or this whole file is checking fiction.
const shootsSrc = read('src/lib/creative-shoots.ts');
if (!shootsSrc.includes("export const isOffer = (s: ShootStatus): boolean => s === 'offered';")) {
  fail('isOffer in creative-shoots.ts no longer matches the mirror here');
}
if (!shootsSrc.includes("export const isPreWork = (s: ShootStatus): boolean => s === 'offered' || s === 'declined';")) {
  fail('isPreWork in creative-shoots.ts no longer matches the mirror here');
}
for (const s of ALL) {
  if (!shootsSrc.includes(`| '${s}'`)) fail(`ShootStatus is missing '${s}'`);
}

eq('offered is an offer', isOffer('offered'), true);
eq('scheduled is not an offer', isOffer('scheduled'), false);
eq('offered is pre-work', isPreWork('offered'), true);
eq('declined is pre-work', isPreWork('declined'), true);
// Everything else IS work, including cancelled: a cancelled shoot may carry
// receipts, so the money rollups still have to see it.
for (const s of ['scheduled', 'shot', 'delivered', 'approved', 'settled', 'cancelled']) {
  eq(`${s} is work`, isPreWork(s), false);
}

/* ── 2. the rails ─────────────────────────────────────────────────── */

// Door codes: 'offered' must NOT be in the set that reveals property secrets.
const briefSrc = read('src/lib/creative-brief.ts');
const activeSet = /const ACTIVE_SHOOT_STATUSES = new Set\(\[([^\]]*)\]\)/.exec(briefSrc);
if (!activeSet) fail('creative-brief.ts: ACTIVE_SHOOT_STATUSES not found');
else if (activeSet[1].includes("'offered'")) {
  fail("creative-brief.ts: 'offered' was added to ACTIVE_SHOOT_STATUSES — an unanswered offer would reveal the door code");
}

// The 8 AM go/no-go text: only days they actually accepted.
const notifySrc = read('src/lib/field-notify.ts');
if (!/\.in\('status', \['scheduled', 'shot'\]\)/.test(notifySrc)) {
  fail("field-notify.ts: sendCreativeDayOfChecks no longer restricts to ['scheduled','shot'] — an unanswered offer could get a go text");
}

// Drive delivery scan: an offer has no deliverables to find.
const driveSrc = read('src/lib/creative-drive.ts');
if (driveSrc.includes("'offered'")) {
  fail("creative-drive.ts mentions 'offered' — the delivery watcher must not scan an unanswered offer");
}

// The planner grid: a withdrawn or declined day is free again.
guard(
  'src/lib/creative-calendar.ts',
  ".not('status', 'in', '(cancelled,declined)')",
  'a declined day must go back to green on the grid',
);

// The office board: offers and declines stay out of the pay groups.
guard('src/app/fieldwork/shoots/page.tsx', 'isPreWork(s.shoot.status)', 'offers must not sit in the money groups');

// The contributor's profile: an unanswered offer is not a completed shoot.
guard('src/lib/creative-shoots.ts', 'if (isPreWork(sm.shoot.status)) continue;', 'an offer must not count as a shoot done');

// Both answers are one-shot, guarded on the row still being an offer.
const fieldActions = read('src/app/field/actions.ts');
for (const fn of ['acceptShoot', 'declineShoot']) {
  if (!fieldActions.includes(`export async function ${fn}(`)) fail(`field/actions.ts: ${fn} is missing`);
}
eq(
  'accept + decline are both guarded .eq(status, offered)',
  (fieldActions.match(/\.eq\('status', 'offered'\)/g) ?? []).length >= 2,
  true,
);
// And they must re-check ownership, because a brief link is short.
guard('src/app/field/actions.ts', 'shoot.contractor_id !== contractor.id', 'only the invited contributor may answer');

// The office cannot answer for them.
const officeActions = read('src/app/fieldwork/shoots/actions.ts');
if (/status:\s*'scheduled'/.test(officeActions)) {
  fail("fieldwork/shoots/actions.ts writes status 'scheduled' — only the contributor's own accept may do that");
}
// The offer writes 'offered', never a committed state.
guard('src/app/fieldwork/shoots/actions.ts', "status: 'offered'", 'the planner must offer, not book');

console.log(failures === 0 ? 'PASS  shoot offer opt-in check' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
