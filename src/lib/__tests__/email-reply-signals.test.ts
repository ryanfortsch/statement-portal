import test from 'node:test';
import assert from 'node:assert/strict';
import { replySignalFor, type ReplySignals } from '../email-reply-signals.ts';

const T0 = '2026-09-18T11:02:16.000Z'; // Marci Bailey's inbound
const ms = (iso: string) => new Date(iso).getTime();

function signals(sent: Record<string, string> = {}, touch: Record<string, string> = {}): ReplySignals {
  return {
    recentSentTo: new Map(Object.entries(sent).map(([k, v]) => [k, ms(v)])),
    recentTouchTo: new Map(Object.entries(touch).map(([k, v]) => [k, ms(v)])),
  };
}

test('an outbound contact touch after the inbound retires it (the Marci case)', () => {
  // Reply logged 58 minutes after the inbound, via stay-concierge owner messaging.
  const s = signals({}, { 'baileynrma@comcast.net': '2026-09-18T12:00:46.000Z' });
  assert.equal(replySignalFor(s, 'baileynrma@comcast.net', T0), 'contact_touch');
});

test('a Gmail Sent message after the inbound wins over a touch', () => {
  const s = signals(
    { 'baileynrma@comcast.net': '2026-09-19T19:19:49.000Z' },
    { 'baileynrma@comcast.net': '2026-09-18T12:00:46.000Z' },
  );
  assert.equal(replySignalFor(s, 'baileynrma@comcast.net', T0), 'reply_sent');
});

test('a reply BEFORE the inbound is not a reply', () => {
  const s = signals(
    { 'baileynrma@comcast.net': '2026-09-14T17:41:52.000Z' },
    { 'baileynrma@comcast.net': '2026-09-16T14:14:45.000Z' },
  );
  assert.equal(replySignalFor(s, 'baileynrma@comcast.net', T0), null);
});

test('sender address is matched case-insensitively and trimmed', () => {
  const s = signals({}, { 'baileynrma@comcast.net': '2026-09-19T19:24:17.000Z' });
  assert.equal(replySignalFor(s, '  BaileyNRMA@Comcast.NET ', T0), 'contact_touch');
});

test('no sender, no signal', () => {
  const s = signals({ 'x@y.com': '2026-09-19T00:00:00.000Z' });
  assert.equal(replySignalFor(s, null, T0), null);
  assert.equal(replySignalFor(s, undefined, T0), null);
  assert.equal(replySignalFor(s, 'nobody@y.com', T0), null);
});

test('an unparseable inbound timestamp never retires anything', () => {
  const s = signals({ 'x@y.com': '2026-09-19T00:00:00.000Z' });
  assert.equal(replySignalFor(s, 'x@y.com', 'not a date'), null);
});
