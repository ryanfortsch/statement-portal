/**
 * The approve call carries only the overrides the card actually has.
 *
 * Two regressions live here. The body must be a RAW object: pre-stringifying
 * it double-encoded the payload into a JSON string, which FastAPI rejected
 * with a 422 on every addon-carrying approve (Leah / 3 Locust EV fee,
 * 2026-08-20). And an ordinary card must send NO body at all, because the
 * concierge reads a present-but-null flag as an operator decision: a blanket
 * `{ create_handoff: false }` on every approve would mark every handoff
 * skipped, which is silent and looks exactly like the AI never noticing.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildApproveBody } from '../stay-concierge.ts';

describe('buildApproveBody', () => {
  test('an ordinary approval sends no body', () => {
    assert.equal(buildApproveBody(undefined), undefined);
    assert.equal(buildApproveBody({}), undefined);
  });

  test('a card with only an add-on sends only that flag', () => {
    assert.deepEqual(buildApproveBody({ sendAddonSms: false }), {
      send_addon_sms: false,
    });
  });

  test('a card with only a handoff sends only that flag', () => {
    assert.deepEqual(buildApproveBody({ createHandoff: true }), {
      create_handoff: true,
    });
  });

  test('a card carrying both sends both, unticked included', () => {
    assert.deepEqual(
      buildApproveBody({ sendAddonSms: true, createHandoff: false }),
      { send_addon_sms: true, create_handoff: false },
    );
  });

  test('the body is a plain object, never a pre-stringified one', () => {
    const body = buildApproveBody({ createHandoff: true });
    assert.equal(typeof body, 'object');
  });

  test('an actor alone is not an override and sends no body', () => {
    // actor rides as a header, not in the payload; a body built for it
    // would put a decision on a card the operator never saw one on.
    assert.equal(buildApproveBody({ actor: 'dotti@risingtidestr.com' } as never), undefined);
  });
});

describe('follow-up consent', () => {
  test('draft is explicit without any send token', () => {
    assert.deepEqual(buildApproveBody({ cleanerAction: 'draft', workAction: 'create' }), { cleaner_action: 'draft', work_action: 'create' });
  });
  test('both follow-ups can be skipped independently', () => {
    assert.deepEqual(buildApproveBody({ cleanerAction: 'skip', workAction: 'skip' }), { cleaner_action: 'skip', work_action: 'skip' });
  });
  test('send carries only the reviewed preview token', () => {
    assert.deepEqual(buildApproveBody({ cleanerAction: 'send', previewToken: 'reviewed' }), { cleaner_action: 'send', preview_token: 'reviewed' });
    assert.deepEqual(buildApproveBody({ cleanerAction: 'draft', previewToken: 'old' }), { cleaner_action: 'draft' });
  });
});
