import 'server-only';
import type { ChannexJob, ChannexJobStore } from './worker.ts';
import type { MessageAttempt } from './transport.ts';
const isId = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s);
const validAttempt = (v: MessageAttempt) => v?.environment === 'production'
  && v.propertyId === '320c5cb5-91e0-46af-b9b3-a3fc20b4631e' && v.provider === 'Airbnb'
  && [v.channelId, v.bookingId, v.threadId].every(isId)
  && typeof v.bodySha256 === 'string' && /^[a-f0-9]{64}$/.test(v.bodySha256);
export type MessageRpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
/** Concrete PostgREST RPC adapter; caller supplies its explicit service-role client. */
export function createChannexJobStore(rpc: MessageRpc): ChannexJobStore {
  const call = async (name: string, args: Record<string, unknown>) => {
    try {
      const result = await rpc(name, args);
      if (!result || result.error !== null) throw Error('RPC failed');
      return result.data;
    } catch { throw Error('Message ledger unavailable'); }
  };
  return {
    async read(sendId) {
      if (!isId(sendId)) throw Error('Invalid message identity');
      const data = await call('helm_channex_message_read', { p_send_id: sendId });
      if (data === null) return null;
      const row = data as ChannexJob;
      if (!row || row.sendId !== sendId || !validAttempt(row)
          || typeof row.contextRevision !== 'string' || !/^[a-f0-9]{32}$/.test(row.contextRevision)
          || !['prepared', 'attempting', 'unknown', 'rejected', 'accepted', 'recorded'].includes(row.state)
          || (row.state === 'prepared' ? row.attemptId !== null : !isId(row.attemptId))
          || (['accepted', 'recorded'].includes(row.state) ? !isId(row.providerMessageId) : row.providerMessageId !== null)) {
        throw Error('Invalid message ledger response');
      }
      // Do not propagate unexpected fields (including raw bodies) from storage.
      return Object.freeze({ sendId, environment: row.environment, propertyId: row.propertyId, channelId: row.channelId,
        provider: row.provider, bookingId: row.bookingId, threadId: row.threadId, bodySha256: row.bodySha256,
        contextRevision: row.contextRevision, state: row.state, attemptId: row.attemptId, providerMessageId: row.providerMessageId });
    },
    async claim(sendId, attemptId, attempt) {
      if (!isId(sendId) || !isId(attemptId)) throw Error('Invalid message identity');
      if (!validAttempt(attempt)) throw Error('Invalid message target');
      const { environment, propertyId, channelId, provider, bookingId, threadId, bodySha256 } = attempt;
      const data = await call('helm_channex_message_claim', { p_send_id: sendId, p_attempt_id: attemptId,
        p_attempt: { environment, propertyId, channelId, provider, bookingId, threadId, bodySha256 } });
      if (typeof data !== 'boolean') throw Error('Uncertain message claim');
      return data;
    },
    async finish(sendId, attemptId, outcome) {
      if (!isId(sendId) || !isId(attemptId)) throw Error('Invalid message identity');
      if (!outcome || !['unknown', 'rejected', 'accepted', 'recorded'].includes(outcome.state)
          || (['accepted', 'recorded'].includes(outcome.state) && !('providerMessageId' in outcome && isId(outcome.providerMessageId)))
          || (outcome.state === 'rejected' && ![401, 403, 404, 422].includes(outcome.status))
          || (!['accepted', 'recorded'].includes(outcome.state) && 'providerMessageId' in outcome)
          || (outcome.state !== 'rejected' && 'status' in outcome)) throw Error('Invalid message outcome');
      const data = await call('helm_channex_message_finish', { p_send_id: sendId, p_attempt_id: attemptId,
        p_state: outcome.state, p_provider_id: 'providerMessageId' in outcome ? outcome.providerMessageId : null,
        p_rejection_status: 'status' in outcome ? outcome.status : null });
      if (typeof data !== 'boolean') throw Error('Uncertain message receipt');
      return data;
    },
  };
}
