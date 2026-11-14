import 'server-only';
import { isDeepStrictEqual } from 'node:util';
import { projectRemoteBooking } from '../channex-bookings/reconciliation.ts';
import { todayInEastern } from '../sca-quotes-types.ts';
import { discoverBookingThread } from './thread-discovery.ts';
import { inspectMessageThreadIdentity } from './thread-identity.ts';
import { createNewStayScheduleInputReader, type NewStayScheduleInputs } from './new-stay-schedule-inputs.ts';
import type { MessageRpc } from './store.ts';

const object = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error();
  return raw as Record<string, unknown>;
};
export function fixedNewStayInputs(s: NewStayScheduleInputs) {
  const { observedAt: _at, ledger: _ledger, admission, ...stable } = s;
  const { observedAt: _observed, confirmation: _confirmation, ...origin } = admission;
  void _at; void _ledger; void _observed; void _confirmation;
  // Time-relative "future" can become "due" during a check; receipts/clocks may not.
  return { ...stable, admission: origin };
}

/** Two bounded Channex booking/thread reads bracketed by consistent SQL snapshots.
 * No Guesty clock inference, provider POST, feed ACK or admission creation. */
export async function loadVerifiedNewStay(bookingId: string, deps: {
  rpc: MessageRpc; now: () => number; channexKey: () => Promise<string>; fetcher: typeof fetch;
}) {
  const { now } = deps, started = now(), day = todayInEastern(new Date(started));
  let last = started, requests = 0;
  const remaining = () => {
    const at = now();
    if (!Number.isSafeInteger(started) || !Number.isSafeInteger(at) || at < last || at - started >= 80000
      || todayInEastern(new Date(at)) !== day) throw Error();
    last = at; return 80000 - (at - started);
  };
  const reader = createNewStayScheduleInputReader(deps.rpc, { enabled: true });
  remaining(); const before = await reader.load(bookingId, now); remaining();
  if (!before || before.booking.end <= day) throw Error();
  const key = await deps.channexKey(); remaining();
  if (typeof key !== 'string' || !key || key.length > 4096 || /[\x00-\x20\x7f]/.test(key)) throw Error();
  const read = async (path: string, maxBytes: number): Promise<unknown> => {
    if (++requests > 14) throw Error();
    const res = await deps.fetcher('https://app.channex.io/api/v1' + path, { method: 'GET', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(Math.min(8000, remaining())), headers: { Accept: 'application/json', 'user-api-key': key } });
    if (res.status !== 200 || res.redirected || !res.body) { await res.body?.cancel(); throw Error(); }
    const stream = res.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) { const part = await stream.read(); remaining(); if (part.done) break;
        bytes += part.value.byteLength; if (bytes > maxBytes) throw Error(); chunks.push(part.value); }
      const value = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
      const meta = value.meta === undefined ? {} : object(value.meta);
      if (value.errors !== undefined || (meta.warnings !== undefined && (!Array.isArray(meta.warnings) || meta.warnings.length))) throw Error();
      return value;
    } finally { await stream.cancel().catch(() => undefined); stream.releaseLock(); }
  };
  const scan = async () => {
    const r = before.admission.currentReceipt.revision;
    const remote = projectRemoteBooking(object(await read(`/bookings/${r.bookingId}`, 1048576)).data);
    if (remote.id !== r.bookingId || remote.revisionId !== r.revisionId || remote.code !== r.reservationCode
      || remote.checkIn !== r.checkIn || remote.checkOut !== r.checkOut || remote.status === 'cancelled') throw Error();
    const threadId = await discoverBookingThread(read, before.scope, r.bookingId);
    if (inspectMessageThreadIdentity(object(await read(`/message_threads/${threadId}`, 1048576)).data,
      before.scope, { bookingId: r.bookingId, threadId }, true)) throw Error();
    return { remote, threadId };
  };
  const first = await scan(), second = await scan();
  if (!isDeepStrictEqual(first, second)) throw Error();
  const after = await reader.load(bookingId, now); remaining();
  if (!after || !isDeepStrictEqual(fixedNewStayInputs(before), fixedNewStayInputs(after))) throw Error();
  return { ...after, route: { remoteBookingId: after.admission.remoteBookingId, threadId: second.threadId } };
}
