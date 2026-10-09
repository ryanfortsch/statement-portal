import { recordInventoryCommand, type InventoryJournalStore } from './inventory-journal.ts';
import type { DispatchContext, InventoryJob } from './inventory-outbox.ts';
/** Worker preparation only. No live provider transport or scheduling is installed.
 * Caller may dispatch once only after this returns a committed submitting job.
 * A process crash after that barrier must reconcile, never automatically resend.
 */
export async function prepareInventoryDispatch(
  store: InventoryJournalStore, id: string, clock: () => number, leaseMs: number,
  refreshContext: (job: InventoryJob) => Promise<DispatchContext>,
): Promise<InventoryJob | null> {
  await recordInventoryCommand(store, { kind: 'expire', now: clock() });
  const claimed = await recordInventoryCommand(store, { kind: 'claim', id, now: clock(), leaseMs });
  if (!claimed.saved || !claimed.result || typeof claimed.result !== 'object') return null;
  const job = claimed.result;
  const context = await refreshContext(job);
  const dispatched = await recordInventoryCommand(store, {
    kind: 'dispatch', id, token: job.token!, context, now: clock(),
  });
  return dispatched.saved && dispatched.result && typeof dispatched.result === 'object' ? dispatched.result : null;
}
