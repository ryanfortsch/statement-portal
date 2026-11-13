/**
 * Send now on a queued card asks first (2026-11-12).
 *
 * A queued card is on a clock on purpose: a replacement checkout notice goes
 * the morning before the new checkout and says "tomorrow". On the folded row
 * Send now sat beside Show with no question, and one tap delivered Anne's
 * 3 South notice, queued for Sat Nov 28, on Nov 12. Every queue renders the
 * one ApprovalCard, so the question lives there. Reads the source: the guard
 * is one await that deletes cleanly.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CARD = readFileSync(
  new URL('../../../src/components/messaging/card/ApprovalCard.tsx', import.meta.url),
  'utf8',
);

function sendNowBody(): string {
  const start = CARD.indexOf('const sendNow = ');
  assert.ok(start > 0, 'ApprovalCard defines sendNow');
  const end = CARD.indexOf('const cancelSchedule = ', start);
  assert.ok(end > start, 'cancelSchedule follows sendNow');
  return CARD.slice(start, end);
}

test('Send now asks before it sends', () => {
  const body = sendNowBody();
  const asked = body.indexOf('await ask(');
  const sent = body.indexOf("run('send-now'");
  assert.ok(asked > 0, 'sendNow awaits the confirm dialog');
  assert.ok(sent > asked, 'the send runs only after the answer');
  assert.match(body, /if \(!ok\) return;/, 'Cancel keeps the schedule');
});

test('the question names the time the send gives up', () => {
  const body = sendNowBody();
  assert.match(body, /sendsInLabel\(sendAt/, 'the dialog says when it was set to go');
  assert.match(body, /cancelLabel: 'Keep the schedule'/);
  assert.match(CARD, /import \{ useConfirm \} from '@\/components\/ConfirmDialog';/);
});

test('both Send now buttons go through the guarded verb', () => {
  const buttons = CARD.match(/onClick=\{sendNow\}/g) || [];
  assert.equal(buttons.length, 1, 'one Send now button, shared by the folded row and the open card');
  assert.ok(!/onClick=\{\(\) => verbs\.sendNow/.test(CARD), 'no button calls the raw verb');
});
