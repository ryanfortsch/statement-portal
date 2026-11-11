import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { syntheticCapture } from './fixtures/channex-template-capture.ts';
import { compileCalderwoodTemplates, preparedPolicy, MIGRATION_TIMING } from '../channex-messaging/template-migration.ts';
import { renderTemplate, resolveAutomationsFor, type AutomationRule } from '../automations-core.ts';
import { reviewPreparationRules } from '../channex-messaging/preparation-rules.ts';

const now = Date.parse('2026-11-07T20:00:00Z');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const compile = () => compileCalderwoodTemplates(structuredClone(syntheticCapture), now);
const rules = () => compile().map((r, i) => ({ ...r, id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  property_id: '65_calderwood', audience: r.key.startsWith('cleaner_') ? 'cleaner' : 'guest',
  trigger: r.key.startsWith('cleaner_') ? 'pre_arrival' : r.key, offset_days: 0, at_local: null,
  timezone: 'America/New_York', channel_exclusions: [], delivery: r.key.startsWith('cleaner_') ? 'sms' : 'ota_manual',
  send_mode: 'approve', min_nights: null, subject: null, enabled: false, configured_in_ota: true }));
test('six source templates retain literal wording and offsets with explicit field mappings', () => {
  const rows = compile(); assert.equal(rows.length, 6);
  for (const row of rows) {
    assert.equal(row.migration_policy.sourceSha256, hash(syntheticCapture.templates[row.key]));
    assert.equal(row.migration_policy.bodySha256, hash(row.body));
    assert.deepEqual(row.migration_policy.timing, MIGRATION_TIMING[row.key]);
    assert.equal(preparedPolicy(row.key, row.body, row.migration_policy)?.state, 'prepared');
  }
  assert.equal(rows[0].body, syntheticCapture.templates.booking_confirmed);
  assert.equal(rows[1].body, 'Hello {{guest_first}},\nArrival {{check_in_long}}; departure {{check_out_long}}.');
  assert.equal(rows[3].body, syntheticCapture.templates.pre_checkout);
});
test('literal credentials and legacy cleaner URL never leave the compiler', () => {
  const json = JSON.stringify(compile());
  for (const s of ['SyntheticWifiSecret', 'Synthetic Network', 'app.guesty.com', 'viewId=']) assert.equal(json.includes(s), false);
  assert.ok(json.includes('{{wifi_name}}')); assert.ok(json.includes('{{wifi_password}}'));
  assert.ok(json.includes('{{door_code}}')); assert.ok(json.includes('{{cleaner_schedule_url}}'));
});
test('the existing canonical renderer masks secrets and blocks absent dependencies', () => {
  const row = compile().find(r => r.key === 'checkin_day')!;
  const rendered = renderTemplate(row.body, { guest_first: 'Synthetic', door_code: 'synthetic-door',
    wifi_name: 'Test Network', wifi_password: 'synthetic-password' });
  assert.deepEqual(rendered.missing, []);
  assert.ok(rendered.text.includes('synthetic-door')); assert.ok(rendered.text.includes('synthetic-password'));
  assert.equal(rendered.masked.includes('synthetic-door'), false); assert.equal(rendered.masked.includes('synthetic-password'), false);
  assert.deepEqual(renderTemplate(row.body, { guest_first: 'Synthetic' }).missing, ['door_code', 'wifi_name', 'wifi_password']);
  assert.ok(renderTemplate(compile()[4].body, {}).missing.includes('cleaner_schedule_url'));
});
test('malformed or incomplete source captures fail without exposing private content', () => {
  for (const mutate of [
    (v: typeof syntheticCapture) => { delete (v.templates as Partial<typeof v.templates>).pre_arrival; },
    (v: typeof syntheticCapture) => { v.property = 'other_home'; },
    (v: typeof syntheticCapture) => { v.observedAt = '2036-01-01T00:00:00Z'; },
    (v: typeof syntheticCapture) => { v.templates.booking_confirmed = 'PRIVATE {{unknown}}'; },
    (v: typeof syntheticCapture) => { v.templates.booking_confirmed += '{{broken'; },
    (v: typeof syntheticCapture) => { v.templates.pre_checkout = ''; },
    (v: typeof syntheticCapture) => { v.templates.pre_checkout += '\u0000'; },
    (v: typeof syntheticCapture) => { v.templates.pre_checkout += 'x'.repeat(16001); },
    (v: typeof syntheticCapture) => { v.templates.checkin_day += '\nSyntheticWifiSecret'; },
    (v: typeof syntheticCapture) => { v.templates.checkin_day = v.templates.checkin_day.replace('Password:', 'Pwd:'); },
    (v: typeof syntheticCapture) => { v.templates.checkin_day += '\nName: Another\nPassword: AnotherSecret'; },
    (v: typeof syntheticCapture) => { v.templates.pre_checkout += '\nPassword: PRIVATE'; },
    (v: typeof syntheticCapture) => { v.templates.cleaner_reminder += '\nhttps://app.guesty.com/private'; },
    (v: typeof syntheticCapture) => { v.templates.cleaner_reminder = v.templates.cleaner_reminder.replace('https:', 'http:'); },
  ]) {
    const capture = structuredClone(syntheticCapture); mutate(capture);
    assert.throws(() => compileCalderwoodTemplates(capture, now), e => e instanceof Error && e.message === 'Template migration requires source review');
  }
});
test('prepared metadata rejects changed body, timing, state, hash or extra policy fields', () => {
  const r = compile()[0];
  assert.equal(preparedPolicy(r.key, r.body + 'changed', r.migration_policy), null);
  for (const patch of [{ state: 'active' }, { timing: { anchor: 'confirmed_at', minutes: 0 } },
    { timing: { anchor: 'arrival', minutes: 30 } }, { bodySha256: 'a'.repeat(64) }, { secret: 'PRIVATE' }]) {
    assert.equal(preparedPolicy(r.key, r.body, { ...r.migration_policy, ...patch }), null);
  }
  assert.equal(preparedPolicy('unknown', r.body, r.migration_policy), null);
});
test('disabled canonical overrides silence fleet defaults without planning messages', () => {
  const rows = rules() as AutomationRule[];
  const fleet = { ...rows[0], id: '00000000-0000-4000-8000-000000000090', property_id: null, enabled: true, migration_policy: null };
  assert.equal(resolveAutomationsFor('65_calderwood', [fleet, ...rows]).length, 0);
  assert.equal(resolveAutomationsFor('other_home', [fleet, ...rows]).length, 1);
});
test('owner review reports preparation and unresolved dependencies without returning bodies', () => {
  const r = reviewPreparationRules(rules());
  assert.equal(r.preparedWorkflows, 6); assert.equal(r.missingWorkflows, 0);
  assert.equal(r.workflows[4].rule?.migration?.cleanerLinkRequired, true);
  assert.equal(r.workflows[2].rule?.migration?.credentialFields, true);
  assert.equal(r.workflows[1].rule?.migration?.dateFormatReview, true);
  assert.equal(JSON.stringify(r).includes('Your synthetic stay'), false);
  assert.equal(JSON.stringify(r).includes('SyntheticWifiSecret'), false);
  const changed = rules(); changed[0].body += 'changed';
  assert.equal(reviewPreparationRules(changed).preparedWorkflows, 5);
  assert.equal(reviewPreparationRules(changed).workflows[0].rule?.invalidMigrationPolicy, true);
});
test('UI keeps prepared rules explicitly off with automated intended delivery', () => {
  const src = readFileSync(new URL('../../app/channels/65_calderwood/message-preparation/PreparationReview.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes('sending off')); assert.ok(src.includes('Automatic booking-channel message'));
  assert.ok(src.includes('Automatic cleaner SMS')); assert.ok(src.includes('Rendered message and delivery checks remain'));
});
