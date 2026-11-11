import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveCleanerReminderLink, withCleanerReminderLink, deliverVerifiedCleanerReminder } from '../cleaner-reminder-link.ts';
import { MASK, renderTemplate, renderSubject, decideDispatch, type AutomationRule, type AutomationBooking } from '../automations-core.ts';

const property = '65_calderwood';
const recipient = () => ({ phone: '+12025550100', portal_token: 'a'.repeat(32), enabled: true,
  property_ids: [property], region: 'bridgeport_ct', language: 'en', display_name: 'Synthetic cleaner', daily_digest_enabled: false });
const rule: AutomationRule = { id: 'synthetic-rule', key: 'cleaner_reminder', property_id: property,
  audience: 'cleaner', delivery: 'sms', trigger: 'pre_arrival', offset_days: -10, at_local: '16:00',
  timezone: 'America/New_York', channel_exclusions: [], send_mode: 'auto', min_nights: null,
  body: 'Schedule {{cleaner_schedule_url}}', subject: null, enabled: true, configured_in_ota: false };
const booking: AutomationBooking = { id: 'synthetic-booking', property_id: property, channel: 'airbnb',
  status: 'confirmed', check_in: '2026-11-24', check_out: '2026-11-28', guest_name: 'Synthetic Guest',
  guest_phone: null, guest_email: null, duplicate_of: null, first_seen_at: '2026-11-01T12:00:00Z' };

test('existing exact English access resolves on the pinned Helm origin with daily texts off', () => {
  const r = recipient(), result = resolveCleanerReminderLink(property, [r]);
  assert.deepEqual(result, { phone: r.phone, token: r.portal_token,
    url: `https://helm.risingtidestr.com/c/${r.portal_token}/stays`, language: 'en' });
  assert.equal(resolveCleanerReminderLink('other', [r]), null);
});
test('malformed, revoked, broad, wrong-language and ambiguous access never resolves', () => {
  for (const patch of [{ enabled: false }, { portal_token: '' }, { portal_token: 'https://evil.test/' },
    { portal_token: 'a'.repeat(17) }, { phone: null }, { phone: '123' }, { property_ids: [] },
    { property_ids: [property, 'other'] }, { property_ids: ['other'] }, { language: 'pt' }, { language: null }])
    assert.equal(resolveCleanerReminderLink(property, [{ ...recipient(), ...patch }]), null);
  assert.equal(resolveCleanerReminderLink(property, [recipient(), recipient()]), null);
  assert.equal(resolveCleanerReminderLink(property, [recipient(), { ...recipient(), property_ids: [] }]), null);
  assert.equal(resolveCleanerReminderLink(property, [recipient(), null]), null);
  assert.equal(resolveCleanerReminderLink(property, Array(201).fill(recipient())), null);
});
test('unrelated and disabled recipients never lend their token or block the unique recipient', () => {
  const r = recipient();
  const result = resolveCleanerReminderLink(property, [{ ...r, enabled: false, portal_token: 'b'.repeat(32) },
    { ...r, region: 'cape_ann', property_ids: [], portal_token: 'c'.repeat(32) }, r]);
  assert.equal(result?.token, r.portal_token);
});
test('guest, fleet, wrong-home and unsupported rules cannot obtain the link in any mode', () => {
  for (const patch of [{ audience: 'guest' }, { property_id: null }, { property_id: 'other' },
    { delivery: 'email' }, { key: 'cleaner_new_booking' }]) for (const wire of [false, true]) {
    const ctx = withCleanerReminderLink({ cleaner_schedule_url: 'untrusted' }, property, { ...rule, ...patch }, [recipient()], wire);
    assert.equal(ctx.cleaner_schedule_url, null);
  }
});
test('only the wire context contains the credential; previews, subjects and stored renders mask it', () => {
  const r = recipient(), preview = withCleanerReminderLink({}, property, rule, [r]);
  assert.equal(preview.cleaner_schedule_url, MASK);
  const ctx = withCleanerReminderLink({}, property, rule, [r], true);
  const body = renderTemplate(rule.body, ctx), subject = renderSubject(rule.body, ctx);
  assert.ok(body.text.includes(r.portal_token));
  assert.equal(body.masked, `Schedule ${MASK}`); assert.deepEqual(body.missing, []);
  assert.equal(subject.masked, `Schedule ${MASK}`);
  assert.equal(JSON.stringify(preview).includes(r.portal_token), false);
});
test('a fresh matching access check sends once to its own phone, with no enrollment writes', async () => {
  let reads = 0, sends = 0;
  const result = await deliverVerifiedCleanerReminder(property, rule, [recipient()], {
    recheck: async () => { reads++; return [recipient()]; },
    send: async link => { sends++; assert.equal(link.phone, recipient().phone); return 'provider-id'; },
  });
  assert.equal(result, 'provider-id'); assert.equal(reads, 1); assert.equal(sends, 1);
});
test('rotation, revocation, language, phone, scope and recipient changes during recheck send nothing', async () => {
  for (const changed of [[], [{ ...recipient(), portal_token: 'b'.repeat(32) }],
    [{ ...recipient(), enabled: false }], [{ ...recipient(), phone: '+12025550101' }],
    [{ ...recipient(), language: 'pt' }], [{ ...recipient(), property_ids: [] }], [recipient(), recipient()]]) {
    let sends = 0;
    await assert.rejects(deliverVerifiedCleanerReminder(property, rule, [recipient()], {
      recheck: async () => changed, send: async () => { sends++; },
    }), /access changed/);
    assert.equal(sends, 0);
  }
});
test('slow or failed access reads abort, and errors never echo credentials', async () => {
  let sends = 0, at = 0;
  await assert.rejects(deliverVerifiedCleanerReminder(property, rule, [recipient()], {
    clock: () => at, recheck: async () => { at = 5001; return [recipient()]; }, send: async () => { sends++; },
  }), /access changed/);
  await assert.rejects(deliverVerifiedCleanerReminder(property, rule, [recipient()], {
    recheck: async () => { throw Error(recipient().portal_token); }, send: async () => { sends++; },
  }), e => e instanceof Error && e.message === 'Cleaner schedule access could not be rechecked');
  assert.equal(sends, 0);
});
test('uncertain provider results are sanitized and never retried automatically', async () => {
  let sends = 0;
  await assert.rejects(deliverVerifiedCleanerReminder(property, rule, [recipient()], {
    recheck: async () => [recipient()], send: async () => { sends++; throw Error(recipient().portal_token + recipient().phone); },
  }), e => e instanceof Error && e.message === 'Cleaner reminder delivery could not be confirmed; review before retrying');
  assert.equal(sends, 1);
});
const decision = (r = rule, missing: string[] = []) => decideDispatch({
  row: { planned_check_in: booking.check_in, planned_check_out: booking.check_out }, booking, rule: r,
  property: { automations_enabled: true, calendar_authority: 'helm' }, guest: null,
  recipients: [recipient()], rendered: { missing }, lockMapped: false, approved: true,
});
test('missing cleaner links and guest misuse never become a send or OTA paste even after approval', () => {
  assert.equal(decision(rule, ['cleaner_schedule_url']).outcome, 'awaiting_approval');
  assert.equal(decision({ ...rule, audience: 'guest', delivery: 'ota_manual' }).outcome, 'awaiting_approval');
  assert.equal(decision({ ...rule, audience: 'guest', body: 'Hi', subject: rule.body }).outcome, 'awaiting_approval');
  assert.equal(decision({ ...rule, configured_in_ota: true }).outcome, 'configured_in_ota');
  assert.equal(decision().outcome, 'send');
});
test('the production sender uses the verified phone, and all surfaces apply the audience-specific context', () => {
  const io = readFileSync(new URL('../automations.ts', import.meta.url), 'utf8');
  assert.match(io, /recheck: loadEnabledRecipients/);
  assert.match(io, /sendMessage\(\{ from, to: link\.phone, content: rendered\.text \}\)/);
  assert.match(io, /withCleanerReminderLink\(baseContext, booking\?\.property_id/);
  assert.match(io, /renderTemplate\(rule.body, withCleanerReminderLink\(ctx, propertyId, rule, bundle.recipients\)\)/);
  assert.match(io, /withCleanerReminderLink\(ctx, propertyId, r, bundle.recipients\)/);
});
