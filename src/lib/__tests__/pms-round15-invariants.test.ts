/**
 * Round-15 guards that live in IO code, config or docs, read from the
 * source (the shape shoot-offer-optin.test.ts uses). Break one and watch it
 * fail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');

test('the planner loads a stay booked (confirmed) in the last 24h, not only one first seen then', () => {
  const src = read('src/lib/automations.ts');
  assert.ok(src.includes(".or(`first_seen_at.gte.${sinceIso},booked_at.gte.${sinceIso}`)"), 'an inquiry confirmed today for a stay two months out');
  assert.ok(src.includes('pausedByStayCancel: stayCancelPausedKeys(existing)'));
  assert.ok(/\.eq\('error', PAUSE_REASON_STAY_CANCELLED\)\s*\.gte\('planned_check_out', addDays\(today, -1\)\)/.test(src), 'revived stays are loaded, bounded to stays not yet over');
});

test('Helm sales enforce the turnover buffer and No arrival / No departure days', () => {
  const src = read('src/lib/pms-bridge.ts');
  assert.ok(src.includes('loadPricingBundle(property.id, args.checkIn, args.checkOut)'), 'the quote reads the checkout date (its CTD)');
  assert.ok(src.includes('const buffer = bufferNights(p.holds, p.bundle.plan?.turnover_buffer_days ?? 0);'));
  assert.ok(/buffer\.has\(night\)/.test(src));
  const create = src.slice(src.indexOf('const hard = hardBlockedNights(priced'));
  assert.ok(create.indexOf('arrivalDepartureViolations(priced.bundle.days, input.check_in, input.check_out)') > 0);
  const refuse = create.indexOf("if (dayRules.length > 0) return fail({ ok: false, error: 'terms', violations: dayRules });");
  assert.ok(refuse > 0 && refuse < create.indexOf('// 4. The locked writer.'), 'refused before the write');
  const avail = read('src/lib/availability.ts');
  assert.ok(avail.includes('!buffer.has(date)'));
});

test('a failed rental-period read never reads as open year-round', () => {
  const src = read('src/lib/property-rates.ts');
  const fn = src.slice(src.indexOf('async function readRentalPeriods('), src.indexOf('// ── The bundle'));
  assert.ok(fn.includes('if (error) throw new Error('));
  assert.ok(!/catch\s*\{[\s\S]*return \[\];/.test(fn), 'the fail-open catch is back');
});

test('the guest AI reads a Helm-run home\'s checkout from its rate plan, like the automations', () => {
  const src = read('src/app/api/kb-facts/route.ts');
  assert.ok(src.includes(".select('property_id, checkin_time, checkout_time')"));
  assert.ok(src.includes('check_out_time: checkoutByProp.get(p.id) ?? normalizeTime(p.default_checkout_time) ?? \'\','));
});

test('reviews-to-slips has no schedule of its own, and CLAUDE.md counts the crons that exist', () => {
  const crons = (JSON.parse(read('vercel.json')).crons as Array<{ path: string }>).map((c) => c.path);
  assert.ok(!crons.includes('/api/cron/reviews-to-slips'), 'a second daily pass gives every review a second LLM roll');
  const dir = new URL('src/app/api/cron/', root);
  const routes = readdirSync(dir).filter((d) => statSync(new URL(`${d}/`, dir)).isDirectory()).length;
  const md = read('CLAUDE.md');
  assert.ok(md.includes(`**${routes} cron routes, ${crons.length} schedules, and that is correct.**`), `CLAUDE.md should say ${routes} routes, ${crons.length} schedules`);
});

test('a feed\'s moves and cancels land in the booking change log, after the writes', () => {
  const src = read('src/lib/ical-sync.ts');
  const build = src.indexOf('const feedEvents = feedChangeEvents([');
  const reclass = src.indexOf("cancel_reason: 'reclassified_hold'");
  const insert = src.indexOf(".from('booking_events').insert(part)");
  assert.ok(build > 0 && reclass > 0 && insert > reclass, 'events are inserted once the cancels and reclassifications landed');
});

test('Remove override no longer claims to delete the send history', () => {
  const panel = read('src/app/properties/[id]/AutomationsPanel.tsx');
  assert.ok(!panel.includes('and its send history'));
  assert.ok(panel.includes('What it already sent stays in the history and is not sent again'));
});
