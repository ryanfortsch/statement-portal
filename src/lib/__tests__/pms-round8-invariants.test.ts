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
