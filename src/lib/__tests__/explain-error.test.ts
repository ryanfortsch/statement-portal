/**
 * A send that failed is not a service outage, and must not say it is.
 *
 * Dotti, 2026-10-05, pressing Approve on April's courtesy ack: Helm said
 * "Messaging service is unreachable (it may be restarting)". The concierge had
 * been up since 10:07 and the tunnel answered in 0.23s. Guesty had refused the
 * send with a 429 and the concierge returned 502 guesty_send_failed, which this
 * function rendered as an outage for every 502.
 *
 * Carries over the cases from the stale PR #1644, with its flaw fixed: it
 * treated any 502 WITH a detail as a send failure, but a tunnel 502 also has a
 * detail (the status text "Bad Gateway"), so it would have relabelled real
 * outages. What tells them apart is whether the body was the concierge's JSON.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { explainError } from '../stay-concierge.ts';

const http = (status: number, detail = '', fromService = false) =>
  ({ kind: 'http', status, detail, fromService }) as const;

describe('explainError', () => {
  test('a Guesty rate limit says nothing went out, never "unreachable"', () => {
    const msg = explainError(http(503, 'guesty_rate_limited', true));
    assert.match(msg, /rate-limiting/);
    assert.match(msg, /nothing went out/);
    assert.doesNotMatch(msg, /unreachable|restarting/);
  });

  test('the OAuth cooldown also says nothing went out', () => {
    const msg = explainError(http(503, 'guesty_cooldown', true));
    assert.match(msg, /cooldown/);
    assert.match(msg, /nothing went out/);
  });

  test("a concierge 502 is a failed send that says to check before retrying", () => {
    const msg = explainError(http(502, 'guesty_send_failed', true));
    assert.doesNotMatch(msg, /unreachable|restarting/);
    assert.match(msg, /Check the conversation before trying again/);
    assert.doesNotMatch(msg, /nothing went out/, 'a timeout or 5xx may have been processed');
  });

  test('a concierge 502 carrying a Quo rejection says the send failed', () => {
    const msg = explainError(
      http(502, "quo_error: Client error '400 Bad Request' for url 'https://api.openphone.com/v1/messages'", true),
    );
    assert.doesNotMatch(msg, /unreachable/);
    assert.match(msg, /send failed/);
  });

  test('a TUNNEL 502 is still an outage, even though it carries the status text', () => {
    // The flaw in #1644: "Bad Gateway" is a non-empty detail.
    assert.match(explainError(http(502, 'Bad Gateway', false)), /unreachable/);
    assert.match(explainError(http(502, '', false)), /unreachable/);
    assert.match(explainError(http(504, 'Gateway Timeout', false)), /unreachable/);
  });

  test('a network failure is still an outage', () => {
    assert.match(explainError({ kind: 'network', message: 'fetch failed' }), /unreachable/);
  });
});
