/**
 * Round-8 guards that live in IO code, read from the source (the shape
 * shoot-offer-optin.test.ts uses). Break one and watch it fail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test("the digest's note is rendered before the send claims the row", () => {
  // A model call inside the claim that hung past the function's limit left
  // the digest in 'sending' for good, and the crew got no text that day.
  const src = read('src/lib/cleaner-digest.ts');
  const start = src.indexOf('export async function sendDigest(');
  const body = src.slice(start, src.indexOf('\nexport ', start + 10));
  const note = body.indexOf('await resolveNoteBlock(');
  const claim = body.indexOf(".update({ status: 'sending'");
  assert.ok(note > 0 && claim > 0, 'both calls are in sendDigest');
  assert.ok(note < claim, 'resolveNoteBlock runs before the claim');
});

test('the Calderwood registry seeds no trash day (a Bridgeport home is not on the Gloucester cart rule)', () => {
  const src = read('supabase/migrations/20260926210000_calderwood_registry.sql');
  assert.ok(!/'(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day'/.test(src), 'a weekday is seeded; stay-concierge would give Calderwood guests the Gloucester cart rule');
});

test('the SQL writers stamp the moment of a cancel and give Helm rows their hold ages', () => {
  const src = read('supabase/migrations/20260926200000_helm_pms_plumbing.sql').replace(/\s+/g, ' ');
  assert.ok(!src.includes('cancelled_at = coalesce(cancelled_at, now())'), 'a revived row kept its old cancel stamp');
  assert.ok(src.includes("case when v_before.status = 'cancelled' then coalesce(v_before.cancelled_at, now()) else now() end"));
  assert.ok(src.includes("live_since = case when v_reage then v_live else live_since end"), 'helm_move_booking restarts the age of a moved or reinstated row');
  assert.ok(src.includes("case when p_status in ('confirmed','completed','block') then now() end"), 'helm_create_booking stamps a holding row');
});

test('catch-all cleaners serve Cape Ann homes only, on the property page and in the launch tracker', () => {
  assert.ok(read('src/lib/property-crew.ts').includes('const serves = (fleetWide && capeAnn) || ids.includes(propertyId);'));
  assert.ok(read('src/lib/launch-context.ts').includes('(list.length === 0 && isCapeAnnOps({ region: scope.region ?? null })) || list.includes(p.id)'));
});

test('round 9: a declined inquiry re-confirmed starts holding, and a row moved to dates it does not hold keeps no ages', () => {
  const src = read('supabase/migrations/20260926200000_helm_pms_plumbing.sql').replace(/\s+/g, ' ');
  assert.ok(src.includes("or (v_before.live_since is null and v_before.source in ('manual','direct_booking'))"));
  assert.ok(src.includes('elsif p_check_in <> v_before.check_in or p_check_out <> v_before.check_out then v_reage := true; v_live := null; v_ages := null;'));
  assert.ok(src.includes('held_ages = case when v_reage then v_ages else held_ages end'));
  assert.ok(!src.includes('kept_since'), 'one age model: held_ages');
});

test("round 9: the onboarding trash item never asks for a day outside Gloucester", () => {
  const src = read('src/lib/onboarding-catalog.ts');
  assert.ok(!src.includes('Non-Gloucester homes need the day set by hand'));
  assert.ok(src.includes("derive: ({ p }) => has(p.trash_day) || ((p.city || '').split(',')[0].trim() !== 'Gloucester' && has(p.trash_notes)),"));
});

test('round 9: the flip notes carried-season blocks and trims the mirror past its window', () => {
  const src = read('src/lib/cutover.ts');
  assert.ok(src.includes('noteCarriedSeasons(carry.carriedSeasonBlockIds)'));
  assert.ok(src.includes('trimMirrorPast(propertyId, window.end)'));
});

test('round 10: the maintenance planner keeps its drafts when the property read looks failed', () => {
  const src = read('src/lib/maintenance-runs.ts');
  assert.ok(src.includes('const readLooksFailed = fieldProps.size === 0 && pool.length > 0;'));
  assert.ok(src.includes('for (const e of readLooksFailed ? [] : existing) {'));
});

test('round 10: the echo confirmation only stamps a live Booking.com closure, bound to what it is now', () => {
  const src = read('src/app/channels/[propertyId]/cutover-actions.ts');
  assert.ok(src.includes("row.source !== 'ical_import' || row.channel !== 'booking_com' || row.status !== 'block' || row.hold_kind !== 'ota'"));
  assert.ok(src.includes('echo_confirmed: echoFingerprint(row!)'));
});

test('round 10: the pre-tick hold list waits for a cutover to be prepared', () => {
  assert.ok(read('src/app/channels/[propertyId]/page.tsx').includes('{!helmRun && !cutoverUnderway && factsOrError.facts?.ratePlan && carry && carry.guestyHoldsUncarried.length > 0 && ('));
});

test('round 11: a recipient takes its homes\' region, one region per row', () => {
  const src = read('src/app/turnovers/schedule/actions.ts');
  assert.ok(src.includes('if (regions.size > 1) redirect(`${PAGE}?err=mixed_region${anchor}`);'));
  assert.ok(src.includes('const region = propertyRegion || rawRegion || CAPE_ANN_REGION;'));
});

test('round 11: the echo confirmation stamps only the closure the operator saw', () => {
  const src = read('src/app/channels/[propertyId]/cutover-actions.ts');
  assert.ok(src.includes('if (seen !== echoFingerprint(row!)) {'));
  assert.ok(read('src/app/channels/[propertyId]/page.tsx').includes('<input type="hidden" name="fingerprint" value={echoFingerprint(r)} />'));
});

test('round 11: the seed reads an export someone pulled, and the pull never keeps codes or reservations', () => {
  const seed = read('scripts/seed_calderwood.mts');
  assert.ok(!seed.includes('/private/tmp/'), 'no seed path inside one session scratchpad');
  assert.ok(seed.includes("if (!args.seedPath) fail('--seed <path> is required"));
  const pull = read('scripts/pull_guesty_seed.mts');
  assert.ok(!pull.includes('/v1/reservations'));
  // The reductions themselves are tested in pricing-seed.test.ts.
  assert.ok(pull.includes('scrubSeedListing(listing)') && pull.includes('seedCalendarDays(calendar)'));
});

test('round 11: "configured in Airbnb" answers for Airbnb stays only', () => {
  assert.ok(read('src/lib/automations-core.ts').includes("return rule.configured_in_ota && booking.channel === 'airbnb'"));
});

test('round 12: a concierge approval is claimed before the reply is sent, once', () => {
  const src = read('src/app/api/pms/threads/[id]/messages/route.ts');
  const claim = src.indexOf('const claim = await claimApproval(approvalId, thread.id);');
  const send = src.indexOf("await sendMessage({ from: quoFromNumber('guests')");
  assert.ok(claim > 0 && send > 0 && claim < send, 'the claim comes before the SMS send');
  assert.ok(read('supabase/migrations/20260926200000_helm_pms_plumbing.sql').includes('create table if not exists public.pms_reply_claims ('));
});

test('round 12: the OTA paste text is fetched for the operator, never copied from the masked ledger', () => {
  const panel = read('src/app/properties/[id]/AutomationsPanel.tsx');
  assert.ok(!panel.includes("copy(s.body_rendered ?? '')"));
  assert.ok(panel.includes('const r = await otaPasteTextAction(propertyId, s.id);'));
  assert.ok(read('src/lib/automations.ts').includes('return { ok: true, text: rendered.text };'));
});

test('round 12: a closed rate night says it closes only Helm\'s own sales', () => {
  assert.ok(!read('src/app/channels/calendar/MultiCalendarGrid.tsx').includes('shows as a hold on the export feed'));
});
