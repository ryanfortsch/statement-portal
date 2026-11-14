import 'server-only';
import { z } from 'zod';
import { registerNewStaySchedules } from './new-stay-schedule-runtime.ts';
import { newStayScheduleConfiguration } from './new-stay-schedule-config.ts';
import type { MessageRpc } from './store.ts';

/** Called behind the existing authenticated cron. No browser-provided booking
 * list, epoch creation, release or sender activation. No Quo API key is loaded. */
export async function runNewStayScheduleTick(env: Record<string, string | undefined>, deps: {
  rpc: MessageRpc; fetcher?: typeof fetch; clock?: () => number;
}) {
  const config = newStayScheduleConfiguration(env);
  if (!config) return { state: 'disabled', ok: true, stays: [] };
  const r = await deps.rpc('helm_channex_new_stay_schedule_worklist', {});
  if (!r || r.error !== null) throw Error('Worklist unavailable');
  const list = z.object({ state: z.enum(['ready', 'overflow']), bookingIds: z.array(z.uuid()).max(4) }).strict().parse(r.data);
  if (list.state !== 'ready' || new Set(list.bookingIds).size !== list.bookingIds.length)
    return { state: 'review_required', ok: false, stays: [] };
  const stays = await Promise.all(list.bookingIds.map(bookingId => registerNewStaySchedules({ bookingId, ...config.reference },
    { ...deps, channexKey: async () => env.CHANNEX_PRODUCTION_API_KEY!, smsProof: async () => config }, { enabled: true })));
  return { state: 'complete', ok: stays.every(s => ['complete', 'waiting'].includes(s.state)), stays };
}
