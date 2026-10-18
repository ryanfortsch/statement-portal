/**
 * A campaign cannot reach the list in one tap, and a stopped send can be
 * put back to draft without emailing anyone twice.
 *
 * The audit (2026-10-17, report 10) found the red "Send to N recipients"
 * button mid-form and pre-armed, and a send cut off mid-loop stuck on
 * "sending" under a sentence promising a refresh nothing performed. The send
 * is now two steps (Review and send, then the panel's button carrying the
 * count), the send refuses a count the list does not match, and an owner can
 * reset a stopped send. The rules are pure (campaign-send.ts); the wiring is
 * read from the source.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CAMPAIGN_STUCK_MS,
  campaignFromLine,
  campaignSendMissing,
  campaignSendStopped,
  confirmedCountMatches,
  recipientsLabel,
} from '../campaign-send.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const fnBody = (src: string, name: string): string => {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const next = src.indexOf('export async function', start + 10);
  return src.slice(start, next < 0 ? undefined : next);
};

describe('campaign send rules', () => {
  test('the confirmed count must be the live count, and never zero', () => {
    assert.equal(confirmedCountMatches('410', 410), true);
    assert.equal(confirmedCountMatches(' 410 ', 410), true);
    assert.equal(confirmedCountMatches('409', 410), false);
    assert.equal(confirmedCountMatches(null, 410), false);
    assert.equal(confirmedCountMatches('', 410), false);
    assert.equal(confirmedCountMatches('0', 0), false);
    assert.equal(confirmedCountMatches('4e2', 400), false);
  });

  test('a draft names what it still lacks', () => {
    assert.deepEqual(campaignSendMissing({ subject: 'Hi', body_text: 'Body', segment_id: 's' }, 3), []);
    assert.deepEqual(campaignSendMissing({ subject: ' ', body_text: null, segment_id: null }, 0), [
      'a subject',
      'a body',
      'an audience',
    ]);
    assert.deepEqual(campaignSendMissing({ subject: 'Hi', body_text: 'Body', segment_id: 's' }, 0), [
      'at least one recipient in the audience',
    ]);
  });

  test('a send is stopped only after ten quiet minutes', () => {
    const now = new Date('2026-10-18T15:00:00Z');
    assert.equal(CAMPAIGN_STUCK_MS, 600_000);
    assert.equal(campaignSendStopped('2026-10-18T14:55:00Z', now), false);
    assert.equal(campaignSendStopped('2026-10-18T14:50:00Z', now), true);
    assert.equal(campaignSendStopped(null, now), true);
  });

  test('the from line and the count read the way the guest and operator see them', () => {
    const d = { name: 'Stay Cape Ann', email: 'hello@staycapeann.com' };
    assert.equal(campaignFromLine(null, '', d), 'Stay Cape Ann <hello@staycapeann.com>');
    assert.equal(campaignFromLine('Allie', 'allie@staycapeann.com', d), 'Allie <allie@staycapeann.com>');
    assert.equal(recipientsLabel(1), '1 recipient');
    assert.equal(recipientsLabel(410), '410 recipients');
  });
});

describe('the two-step send is wired', () => {
  const page = read('src/app/guests/campaigns/[id]/page.tsx');
  const actions = read('src/app/guests/campaigns/actions.ts');

  test('the composer form has no button that sends to the list', () => {
    assert.ok(!page.includes('formAction={sendCampaign}'), 'a one-tap send button is back in the form');
    const uses = page.split('sendCampaign}').length - 1;
    assert.equal(uses, 1, 'sendCampaign is posted from exactly one place, the review panel');
    const panel = page.slice(page.indexOf('function ReviewPanel'));
    assert.ok(panel.includes('<form action={sendCampaign}>'));
    assert.ok(panel.includes('name="confirm_count"'));
    assert.ok(page.includes('formAction={reviewCampaignSend}'));
  });

  test('the send refuses a post without the count it confirmed, before the lock', () => {
    const send = fnBody(actions, 'sendCampaign');
    const check = send.indexOf("confirmedCountMatches(formData.get('confirm_count')");
    const lock = send.indexOf("status: 'sending'");
    assert.ok(check > 0 && lock > check, 'the count check must come before the sending lock');
    assert.ok(send.includes('requireOwnerEmail()'));
  });

  test('the sending lock is a real lock: a lost race sends nothing', () => {
    const send = fnBody(actions, 'sendCampaign');
    assert.match(send, /\.eq\('status', 'draft'\)\s*\.select\('id'\)/);
    assert.ok(send.includes('if (!locked?.length)'));
  });

  test('a resumed send skips the people the stopped one reached', () => {
    const send = fnBody(actions, 'sendCampaign');
    assert.ok(send.includes('campaignSentContactIds(id)'));
    assert.ok(send.includes('!alreadySent.has(r.id)'));
  });

  test('only an owner resets a stopped send, and only once it has stopped', () => {
    const reset = fnBody(actions, 'resetStuckCampaign');
    assert.ok(reset.includes('requireOwnerEmail()'));
    assert.ok(reset.includes('campaignSendStopped('));
    assert.match(reset, /\.eq\('status', 'sending'\)/);
  });

  test('the page promises a refresh only where one runs', () => {
    assert.ok(!page.includes('This page will refresh when complete'));
    const sentence = page.indexOf('This page refreshes every ten seconds');
    assert.ok(sentence > 0);
    const block = page.slice(sentence, sentence + 400);
    assert.ok(block.includes('<AutoRefresh intervalMs={10000} />'));
  });
});
