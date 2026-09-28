/**
 * Round-14 guards that live in IO code or SQL, read from the source (the
 * shape shoot-offer-optin.test.ts uses). Break one and watch it fail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
const flat = (s: string) => s.replace(/\s+/g, ' ');
const fnBody = (src: string, header: string) => {
  const start = src.indexOf(header);
  assert.ok(start >= 0, `${header} is in the file`);
  const next = src.indexOf('\nexport ', start + header.length);
  return src.slice(start, next < 0 ? undefined : next);
};
const SQL = flat(read('supabase/migrations/20260926200000_helm_pms_plumbing.sql'));

test("a feed cancel pauses an upcoming stay's messages, and leaves a finished stay's roll-off alone", () => {
  const src = read('src/lib/ical-sync.ts');
  assert.ok(src.includes('error: PAUSE_REASON_STAY_CANCELLED'), 'the resumable reason, not a verdict');
  assert.ok(!src.includes("'stay cancelled by its feed'"), 'the old final reason is back');
  assert.ok(/const pausedStays = \[\.\.\.plan\.cancelNow\.filter\(\(id\) => !pastIds\.has\(id\)\)/.test(src), 'roll-offs keep their post_checkout');
  assert.ok(/const pastIds = new Set\(judged\.filter\(\(r\) => String\(r\.check_out\) < cutoff\)/.test(src));
});

test('an inquiry confirmed later is booked when confirmed (the booking_confirmed gate reads booked_at)', () => {
  assert.ok(SQL.includes("booked_at = case when v_before.status in ('inquiry', 'pending') and p_status in ('confirmed', 'completed') then now() else booked_at end"));
});

test('removing an override keeps what was sent, keyed so it is not sent again', () => {
  assert.ok(SQL.includes('automation_id uuid references public.message_automations(id) on delete set null'), 'send history survives Remove override');
  assert.ok(SQL.includes('automation_key text,'));
  const src = read('src/lib/automations.ts');
  assert.ok(/automation_key: p\.automation_key,/.test(src), 'the planner writes the key');
  assert.ok(/select\('id, booking_id, automation_id, automation_key, fire_at, status, error, planned_check_in, planned_check_out'\)/.test(src), 'the planner reads the key back');
  const chan = read('src/lib/channels.ts');
  assert.ok(!chan.includes('rows.map((r) => String(r.automation_id))'), "a deleted rule's null id is never sent as 'null'");
});

test('the planner pauses what it no longer wants, and re-times a moved card only on the dates it was parked for', () => {
  const src = read('src/lib/automations.ts');
  const plan = fnBody(src, 'export async function planAutomations(');
  assert.ok(/withdrawnSends\(planned, existing, rules, allEffective\)/.test(plan));
  assert.ok(/error: PAUSE_REASON_NO_LONGER_APPLIES/.test(plan));
  assert.ok(/\.eq\('status', 'awaiting_approval'\)\s*\.eq\('planned_check_in', u\.movedFrom\.planned_check_in\)\s*\.eq\('planned_check_out', u\.movedFrom\.planned_check_out\)/.test(plan));
});

test('approval is for the rail the card showed; the paste card hands a moved stay back to the planner', () => {
  const src = read('src/lib/automations.ts');
  assert.ok(/approvedRail: opts\.approved \? row\.delivery_used : null/.test(src), 'dispatchRow passes the approved rail');
  const paste = fnBody(src, 'export async function otaPasteText(');
  assert.ok(paste.includes("approvedRail: 'ota_manual'"));
  const moved = paste.indexOf("decision.outcome === 'skipped_dates_moved'");
  const rail = paste.indexOf("decision.outcome === 'awaiting_approval' && decision.rail && decision.rail !== 'ota_manual'");
  const generic = paste.indexOf('Not to be sent any more');
  assert.ok(moved > 0 && rail > 0 && generic > moved && generic > rail, 'moved and re-railed cards are handled before "skip this message"');
  const skip = fnBody(src, 'export async function skipSend(');
  assert.ok(skip.includes("status: 'skipped_dates_moved'"), 'a skip on a moved stay re-plans it');
});

test('the inbox writer guards every event stamp itself (watch-out 9)', () => {
  const src = read('src/lib/helm-inbox.ts');
  const start = src.indexOf('async function insertMessage(');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.ok(!/update\(patch\)/.test(body), 'the blind thread update is back');
  assert.ok(/update\(\{ last_guest_at: at \}\)\.eq\('id', thread\.id\)\.or\(allBeforeOr\(\['last_guest_at'\], at\)\)/.test(body));
  assert.ok(/update\(\{ last_host_at: at \}\)\.eq\('id', thread\.id\)\.or\(allBeforeOr\(\['last_host_at'\], at\)\)/.test(body));
  assert.ok(/last_preview: previewOf\(m\.body\), last_message_at: at/.test(body));
  assert.ok(body.includes('.or(`last_message_at.is.null,last_message_at.lte.${at}`)'));
  assert.ok(/\.in\('status', \['snoozed', 'done'\]\)\s*\.or\(allBeforeOr\(\['last_guest_at'\], at\)\)/.test(body), 'reopen for a guest message newer than the guest\'s latest (round 15: not held back by our reply)');
  assert.ok(SQL.includes('last_message_at timestamptz,'));
});

test('a Helm send re-links a thread only among stays at Helm-run homes', () => {
  const src = read('src/lib/helm-inbox.ts');
  assert.ok(src.includes('await atHelmRunHomes(await bookingsForPhone(e164, today))'));
  assert.ok(src.includes('await atHelmRunHomes(await bookingsForEmail(key, today))'));
});

test('a listing read is stamped with when its drop rule was read, never its completion', () => {
  const src = read('src/lib/ical-sync.ts');
  assert.ok(!src.includes('last_imported_at: completedAt'), 'the completion stamp is back');
  assert.ok(src.includes('last_imported_at: (opts.rulesReadAt && opts.rulesReadAt < startedAt ? opts.rulesReadAt : startedAt).toISOString()'));
  const i = src.indexOf('const rulesReadAt = new Date();');
  assert.ok(i > 0 && i < src.indexOf('const { data, error } = await q;', i), 'taken before the listing read');
});

test('a seed re-run leaves operator listing edits and the arrival note alone unless forced', () => {
  const src = read('scripts/seed_calderwood.mts');
  const content = src.slice(src.indexOf('async function upsertContent('), src.indexOf('async function upsertRooms('));
  assert.ok(/existing\?\.updated_by && !existing\.updated_by\.startsWith\('seed:'\) && !force/.test(content));
  const note = src.slice(src.indexOf('async function upsertArrivalNote('), src.indexOf('async function fillParking('));
  const guard = note.indexOf('if (existing.length && !force)');
  assert.ok(guard > 0 && guard < note.indexOf(".update({ body, guest_facing: true"), 'the guard precedes the overwrite');
});
