import 'server-only';
import { z } from 'zod';
import { newStayDeliveryConfiguration, type NewStayAudience } from './new-stay-delivery-config.ts';
import { dispatchNewStayGuest, dispatchNewStayCleaner, reconcileNewStayCleaner } from './new-stay-delivery.ts';
import { reconcileCalderwoodMessage } from './receipt-runtime.ts';
import type { MessageRpc } from './store.ts';

const lane = z.object({ state: z.enum(['ready', 'overflow']), jobs: z.array(z.object({
  bookingId: z.uuid(), sendId: z.uuid(),
}).strict()).max(4) }).strict().refine(l => l.state !== 'overflow' || l.jobs.length === 0);
const worklist = z.object({ dispatch: lane, receipts: lane }).strict().refine(list => {
  const ids = [...list.dispatch.jobs, ...list.receipts.jobs].map(j => j.sendId);
  return new Set(ids).size === ids.length;
});

/** A dispatch failure cannot suppress independent receipt recovery. Work is
 * discovered server-side; response DTOs contain no identifiers or message data. */
export async function runNewStayDeliveryTick(audience: NewStayAudience, env: Record<string, string | undefined>, deps: {
  rpc: MessageRpc; fetcher?: typeof fetch; clock?: () => number;
}) {
  const config = newStayDeliveryConfiguration(audience, env);
  if (!config) return { state: 'disabled', ok: true, dispatch: [], receipts: [] };
  const r = await deps.rpc('helm_channex_new_stay_delivery_worklist', { p_audience: audience });
  if (!r || r.error !== null) throw Error('Delivery worklist unavailable');
  const list = worklist.parse(r.data);
  const runtime = { ...deps, channexKey: async () => env.CHANNEX_PRODUCTION_API_KEY!, sms: async () => {
    if (!config.transport) throw Error(); return config.transport;
  } };
  const [dispatch, receipts] = await Promise.all([
    Promise.all((config.mode === 'calderwood-v1' ? list.dispatch.jobs : []).map(job =>
      (audience === 'guest' ? dispatchNewStayGuest : dispatchNewStayCleaner)({ ...job, ...config.reference }, runtime, { enabled: true }))),
    Promise.all(list.receipts.jobs.map(async job => {
      const result = await (audience === 'guest'
      ? reconcileCalderwoodMessage(job.sendId, { ...deps, key: runtime.channexKey }, { enabled: true })
      : reconcileNewStayCleaner(job.sendId, runtime));
      return { state: result.state, providerReads: result.providerReads, providerPosts: result.providerPosts };
    })),
  ]);
  const overflow = list.receipts.state === 'overflow' || (config.mode === 'calderwood-v1' && list.dispatch.state === 'overflow');
  const ok = !overflow && dispatch.every(r => ['accepted', 'recorded', 'delivered'].includes(r.state))
    && receipts.every(r => ['recorded', 'delivered', 'undelivered', 'accepted'].includes(r.state));
  return { state: overflow ? 'review_required' : 'complete', ok, dispatch, receipts };
}
