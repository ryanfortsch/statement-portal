/**
 * A failed SEND must never read as a service outage.
 *
 * The Cloudflare Tunnel returns a bare 502 when the concierge origin is down.
 * The concierge ALSO raises 502, with a detail, when an approved draft fails
 * to send. Both used to print "Messaging service is unreachable (it may be
 * restarting)", and that is how a dead send channel hid for six days: every
 * approve of an early-checkout notice was 400ing at Quo, and the operator
 * read "it may be restarting" and texted the cleaner by hand instead
 * (2026-09-27, 20 Hammond).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { explainError } from '../stay-concierge.ts';

const http = (status: number, detail: unknown = '') =>
  ({ kind: 'http', status, detail }) as never;

describe('explainError', () => {
  test('a bare 502 is still an outage', () => {
    const msg = explainError(http(502));
    assert.match(msg, /unreachable/);
  });

  test('a 504 is still an outage', () => {
    assert.match(explainError(http(504)), /unreachable/);
  });

  test('a 502 carrying a Quo rejection says the send failed', () => {
    const msg = explainError(
      http(502, "quo_error: Client error '400 Bad Request' for url 'https://api.openphone.com/v1/messages'"),
    );
    assert.doesNotMatch(msg, /unreachable/);
    assert.match(msg, /not sent/);
    assert.match(msg, /400 Bad Request/);
    // The operator needs to know the work is not lost.
    assert.match(msg, /still pending/);
  });

  test('a 502 with any other detail still reports a send failure, not an outage', () => {
    const msg = explainError(http(502, 'no_cleaner_phone'));
    assert.doesNotMatch(msg, /unreachable/);
    assert.match(msg, /no_cleaner_phone/);
  });

  test('whitespace-only detail is treated as bare', () => {
    assert.match(explainError(http(502, '   ')), /unreachable/);
  });

  test('a genuine network error is unchanged', () => {
    assert.match(
      explainError({ kind: 'network' } as never),
      /unreachable/,
    );
  });
});
