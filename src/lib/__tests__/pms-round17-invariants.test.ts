/**
 * Round-17 guards (concurrency and copy), read from the source (the shape
 * shoot-offer-optin.test.ts uses), plus the writer/form rule agreement.
 * Break one and watch it fail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isGuestyRuleArtifactUid } from '../calendar-holds.ts';

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test('an inquiry is deleted only while it is still an inquiry', () => {
  const src = read('src/lib/bookings-write.ts');
  const body = src.slice(src.indexOf('export async function deleteOrCancelBooking('));
  assert.ok(/\.delete\(\)\s*\.eq\('id', id\)\s*\.eq\('status', 'inquiry'\)\s*\.select\('id'\)/.test(body), 'a Confirm landing in between is never hard-deleted');
  assert.ok(!/\.from\('bookings'\)\.delete\(\)\.eq\('id', id\);/.test(body));
});

test("an automation's masked record replaces Quo's unmasked echo, in either order", () => {
  const src = read('src/lib/helm-inbox.ts');
  const out = src.slice(src.indexOf('export async function recordOutboundSms('));
  const early = out.indexOf('replaceEchoWithAutomation(input.quoMessageId');
  const alreadyRecorded = out.indexOf("return { recorded: false, reason: 'already_recorded' };");
  assert.ok(early > 0 && early < alreadyRecorded, 'the echo recorded first is overwritten');
  assert.ok(/if \(input\.automationSendId\) \{\s*const id = await replaceEchoWithAutomation\(input\.quoMessageId/.test(out), 'for every automation send');
  const ins = src.slice(src.indexOf('async function insertMessage('));
  assert.ok(/if \(m\.automationSendId && m\.externalMessageId\) \{[\s\S]*?\.from\('guest_messages'\)\s*\.update\(\{\s*body: m\.body,/.test(ins), 'the echo that won the insert race is overwritten');
});

test('the mirror writer never sweeps another writer\'s rows by timestamp', () => {
  const src = read('src/lib/helm-calendar-mirror.ts');
  assert.ok(!/\.lt\('synced_at', runStartIso\)/.test(src), 'a synced_at sweep is back');
  assert.ok(src.includes("const freeDates = rows.filter((r) => r.block_type == null).map((r) => r.date);"));
});

test('an extension is retracted only when its day is in the mirror and not held', () => {
  const src = read('src/lib/extension-holds.ts');
  const i = src.indexOf("note: 'Hold removed from the Guesty calendar; extension retracted'");
  const guard = src.lastIndexOf('if (dayErr || !dayRow) continue;', i);
  assert.ok(guard > 0, 'a missing day is unknown, not removed');
});

test('the new-booking form uses the writer\'s rule for Guesty rule artifacts', () => {
  const sql = read('supabase/migrations/20260926200000_helm_pms_plumbing.sql');
  const m = /b\.ical_uid ~ '\^\[0-9a-f\]\+_\(([a-z|]+)\)_/.exec(sql);
  assert.ok(m, 'the writer tags its rule artifacts by uid');
  for (const tag of m![1].split('|')) {
    assert.equal(isGuestyRuleArtifactUid(`abc123_${tag}_2027-01-01_2027-02-01@guesty.com`), true, `tag ${tag}`);
  }
  assert.equal(isGuestyRuleArtifactUid('abc123_o_2027-01-01_2027-02-01@guesty.com'), false, 'an owner hold is a hold');
  const form = read('src/app/channels/bookings/new/page.tsx');
  assert.ok(form.includes("const isRule = (b: BookingEx) => b.status === 'block' && b.source === 'ical_import' && b.hold_kind !== 'ota' && isGuestyRuleArtifactUid(b.ical_uid);"));
  assert.ok(form.includes('out.conflicting = overlapping.filter((b) => !isRule(b));'));
});
