import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  alertSummary,
  conciergeAlertCopy,
  conciergeAlertHref,
  conciergeAlertsFor,
  conciergeAlertTitle,
  criticalAlertCopy,
  humanizeSummary,
  plainAlertDate,
} from '../concierge-alerts.ts';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const HOMES = [
  { id: '17_beach_rd', name: '17 Beach' },
  { id: '21_horton', name: '21 Horton' },
  { id: '53_rocky_neck', name: '53 Rocky Neck' },
  { id: '53_rocky_neck_2', name: '53 Rocky Neck, Downstairs' },
  { id: '73_rocky_neck', name: '73 Rocky Neck' },
  { id: '3_south_st', name: '3 South' },
];

/** What a row must never print: a slug, an ISO date, shouting, a file path,
 *  an error tail, an em dash. */
function assertHuman(text: string, label: string) {
  assert.ok(!/\b\d+_[a-z]+/.test(text), `${label}: slug in ${text}`);
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(text), `${label}: ISO date in ${text}`);
  assert.ok(!/\b[A-Z]{4,}\b/.test(text), `${label}: shouting in ${text}`);
  assert.ok(!/\.md\b|prompts\/|reason:|Guesty error|https?:/.test(text), `${label}: machine part in ${text}`);
  assert.ok(!text.includes('—'), `${label}: em dash`);
}

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
  assert.equal(conciergeAlertHref('addon_sms_failed'), '/messaging/send?tab=charge#payment-links');
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

test('a staff login never sees an alert whose link lands on the owner inbox', () => {
  const items = [
    { kind: 'pipeline_failure', item_key: 'a' },
    { kind: 'unknown_owner_sms', item_key: 'b' },
    { kind: 'owner_guest_message_no_guest', item_key: 'c' },
    { kind: 'addon_sms_failed', item_key: 'd' },
    { kind: 'owner_email_empty', item_key: 'e' },
    { kind: 'something_new', item_key: 'f' },
  ];
  assert.deepEqual(conciergeAlertsFor('staff', items).map((i) => i.item_key), ['a', 'd', 'f']);
  assert.deepEqual(conciergeAlertsFor('owner', items).map((i) => i.item_key), ['a', 'b', 'c', 'd', 'e', 'f']);
});

test('the reflection report and the AI outage are not alerts', () => {
  const items = [
    { kind: 'reflection_report', item_key: 'r' },
    { kind: 'ai_down', item_key: 'x' },
    { kind: 'pipeline_failure', item_key: 'a' },
  ];
  assert.deepEqual(conciergeAlertsFor('owner', items).map((i) => i.item_key), ['a']);
  assert.deepEqual(conciergeAlertsFor('staff', items).map((i) => i.item_key), ['a']);
});

describe('each alert reads as a home, one sentence and one verb', () => {
  const cases: Array<[string, string, string, string | null]> = [
    ['pipeline_failure', 'pipefail:6512abc0de', 'AI DRAFTING FAILED at 21 Horton - no draft was created, reply in Guesty directly. Guest said: Is there a hair dryer? (reason: APIError: 529)', '21 Horton'],
    ['send_delivery_failed', 'deliveryfail:p', 'Channel REJECTED our sent reply on 53_rocky_neck (conv 6512abc0): "Hi Sam, the code is 4412" - the guest never received it; resend a clean version from the thread. Guesty error: 400', '53 Rocky Neck'],
    ['addon_sms_failed', 'a', 'Addon link SMS FAILED for Jamie Lee (Late checkout, $50) - guest was told a link is coming; send by hand: https://buy.stripe.com/x', null],
    ['addon_sms_failed', 'b', 'PAID extension for Jamie Lee at 3 South but the calendar block 2026-10-20..2026-10-22 FAILED - block it in Guesty NOW or those nights can double-book', '3 South'],
    ['owner_guest_notice_no_guest', 'ownervisit-noguest:17_beach_back:2026-11-03', '17_beach_back: nobody in house 2026-11-03, no guest notice sent.', '17 Beach Back'],
    ['unknown_owner_sms', 'u', 'UNIDENTIFIED SENDER ON THE OWNERS LINE: Bob (+19785551212) wrote "Hey can you check the gutters". No owner on file matches them, so no draft was made. Tag them in Quo or add their phone to the owner in Helm.', null],
    ['gear_slip_failed', 'g', 'Gear slip FAILED to open (404) for 21_horton: Pack n play - stage it by hand and check the property mapping.', '21 Horton'],
    ['a_kind_nobody_named', 'n', 'SOMETHING BROKE at 73_rocky_neck on 2026-10-19 - see prompts/reference/foo.md (reason: x)', '73 Rocky Neck'],
  ];
  for (const [kind, item_key, summary, home] of cases) {
    test(kind + ' ' + item_key, () => {
      const copy = conciergeAlertCopy({ kind, item_key, summary }, HOMES);
      assert.equal(copy.home, home);
      assertHuman(copy.sentence, kind);
      assert.equal((copy.sentence.match(/[.!?](\s|$)/g) ?? []).length, 1, `${kind}: one sentence, got ${copy.sentence}`);
    });
  }

  test('the 2026-10-17 examples from the audit read as words', () => {
    const notice = conciergeAlertCopy({ kind: 'owner_guest_notice_no_guest', item_key: 'k', summary: '17_beach_back: nobody in house 2026-11-03, no guest notice sent' }, HOMES);
    assert.match(notice.sentence, /Tue, Nov 3/);
    const sms = conciergeAlertCopy({ kind: 'unknown_owner_sms', item_key: 'k', summary: 'UNIDENTIFIED SENDER ON THE OWNERS LINE: Bob (+1978) wrote "hi". No owner on file matches them.' }, HOMES);
    assert.match(sms.sentence, /^Bob texted the Owners line/);
  });

  test('a drafting failure and an emergency open their own thread', () => {
    const fail = conciergeAlertCopy({ kind: 'pipeline_failure', item_key: 'pipefail:abc123', summary: 'AI DRAFTING FAILED at 21 Horton - no draft. Guest said: hi' }, HOMES);
    assert.deepEqual(fail.verb, { label: 'Open the thread', href: '/messaging?open=abc123#conversations' });
    const crit = criticalAlertCopy({ summary: 'Maria at 73 Rocky Neck: We are locked out (flag: locked out)', conversation_id: 'c-9' }, HOMES);
    assert.equal(crit.home, '73 Rocky Neck');
    assert.equal(crit.sentence, 'Maria wrote “We are locked out”; answer them now.');
    assert.equal(crit.verb?.href, '/messaging?open=c-9#conversations');
  });

  test('a payment alert sends you to Charge', () => {
    const c = conciergeAlertCopy({ kind: 'addon_sms_failed', item_key: 'a', summary: 'Addon link SMS FAILED for Jamie (Late checkout, $50) - send by hand: https://x' }, HOMES);
    assert.equal(c.sentence, 'Jamie was told a late checkout link ($50) is coming and the text did not go out; send it from Charge.');
    assert.equal(c.verb?.href, '/messaging/send?tab=charge#payment-links');
  });

  test('a summary with no words of its own is cleaned, never shown raw', () => {
    const t = humanizeSummary('NEW THING FAILED for 21_horton on 2026-10-20 - see prompts/reference/x.md (reason: boom)', HOMES);
    assertHuman(t, 'humanize');
    assert.match(t, /21 Horton/);
  });

  test('dates are plain and in Gloucester', () => {
    const now = new Date('2026-10-18T15:00:00Z');
    assert.equal(plainAlertDate('2026-10-18T14:45:00Z', now), 'Today, 10:45 AM');
    assert.equal(plainAlertDate('2026-10-17T13:10:00Z', now), 'Yesterday, 9:10 AM');
    assert.equal(plainAlertDate('2026-10-15T13:10:00Z', now), 'Thu, Oct 15');
  });
});

describe('the alerts are filed under Messaging', () => {
  test('the home page carries one line, the rows render above the Messaging queue', () => {
    const home = read('src/app/(home)/page.tsx');
    assert.ok(home.includes('<ConciergeAlertsLine />'), 'home renders the one-line count');
    assert.ok(!home.includes('<ConciergeAlerts />'), 'home no longer renders the rows');
    const alerts = read('src/components/ConciergeAlerts.tsx');
    assert.ok(alerts.includes('href="/messaging#alerts"'), 'the line links to the rows');
    const messaging = read('src/app/messaging/page.tsx');
    const list = messaging.indexOf('<ConciergeAlertList />');
    const queue = messaging.indexOf('<QueueSection />');
    assert.ok(list > 0 && list < queue, 'the rows sit above the queue');
    assert.ok(!alerts.includes('alertSummary('), 'no row prints the raw summary');
  });
});
