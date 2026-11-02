/**
 * An owner's email relayed by statements@ or onboarding@ is the owner's, not
 * ours. Header shapes are the ones Gmail delivered for Lisa Gruber's
 * 2026-11-01 reply, which the reply mirror filed as outbound. See
 * gmail-relay.ts.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { headerAddress, originalSender } from '../gmail-relay.ts';

const OWNER = 'owner@example.net';

function headers(h: Record<string, string>) {
  return (name: string) => {
    for (const [k, v] of Object.entries(h)) if (k.toLowerCase() === name.toLowerCase()) return v;
    return null;
  };
}

describe('gmail relay', () => {
  test('a relayed owner email is the owner\'s', () => {
    const h = headers({
      From: `"'${OWNER}' via Owner Onboarding" <Onboarding@risingtidestr.com>`,
      'X-Original-Sender': OWNER,
      'X-Original-From': `"${OWNER}" <${OWNER}>`,
    });
    assert.equal(originalSender(h), OWNER);
  });

  test('X-Original-From is the fallback', () => {
    const h = headers({ From: `'Owner' via Statements <statements@risingtidestr.com>`, 'X-Original-From': `Owner <${OWNER}>` });
    assert.equal(originalSender(h), OWNER);
  });

  test('a direct email reads its From', () => {
    assert.equal(originalSender(headers({ From: `Owner <${OWNER}>`, 'X-Original-Sender': 'x@y.com' })), OWNER);
  });

  test('only our own groups are unwrapped', () => {
    const h = headers({ From: `'x' via List <list@outside.org>`, 'X-Original-Sender': OWNER });
    assert.equal(originalSender(h), 'list@outside.org');
  });

  test('a statement we sent stays ours', () => {
    assert.equal(originalSender(headers({ From: 'Rising Tide <statements@risingtidestr.com>' })), 'statements@risingtidestr.com');
  });

  test('headerAddress reads bare and named addresses', () => {
    assert.equal(headerAddress('A <B@X.com>'), 'b@x.com');
    assert.equal(headerAddress('b@x.com'), 'b@x.com');
    assert.equal(headerAddress('nobody'), null);
  });

  test('the reply mirror reads the sender through the relay', () => {
    const src = readFileSync(new URL('../../app/api/cron/sync-gmail-replies/route.ts', import.meta.url), 'utf8');
    assert.match(src, /const fromEmail = originalSender\(/);
  });
});
