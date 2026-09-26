import test from 'node:test';
import assert from 'node:assert/strict';
import { alertSummary, conciergeAlertHref, conciergeAlertTitle } from '../concierge-alerts.ts';

test('the alerts that sat unread Sep 12-26 read as plain words', () => {
  assert.equal(conciergeAlertTitle('pipeline_failure'), 'A guest message got no draft');
  assert.equal(conciergeAlertTitle('send_delivery_failed'), 'A reply never reached the guest');
  assert.equal(conciergeAlertTitle('addon_sms_failed'), 'A payment link did not go out');
  assert.equal(conciergeAlertTitle('unknown_owner_sms'), 'Unknown number on the Owners line');
});

test('a kind nobody named yet still shows, as words and never as a code', () => {
  assert.equal(conciergeAlertTitle('guest_wifi_ticket_stuck'), 'Guest wifi ticket stuck');
  assert.equal(conciergeAlertTitle(''), 'Alert');
});

test('each alert links to where it gets handled', () => {
  assert.equal(conciergeAlertHref('pipeline_failure'), '/messaging');
  assert.equal(conciergeAlertHref('addon_sms_failed'), '/messaging/send#payment-links');
  assert.equal(conciergeAlertHref('unknown_owner_sms'), '/owner-messaging');
  assert.equal(conciergeAlertHref('owner_guest_message_no_guest'), '/owner-messaging');
  assert.equal(conciergeAlertHref('something_new'), '/messaging');
});

test('summaries are one tidy line, capped', () => {
  assert.equal(alertSummary('AI DRAFTING FAILED\n\n  at 3 locust'), 'AI DRAFTING FAILED at 3 locust');
  const long = alertSummary('x'.repeat(400), 50);
  assert.equal(long.length, 50);
  assert.ok(long.endsWith('…'));
});

test('no em dash in anything the strip prints', () => {
  for (const k of ['pipeline_failure', 'send_delivery_failed', 'addon_sms_failed', 'sca_email_needs_you',
    'far_future_hold_failed', 'owner_guest_notice_no_guest', 'unknown_owner_sms', 'owner_email_empty']) {
    assert.ok(!conciergeAlertTitle(k).includes('—'), k);
  }
});
