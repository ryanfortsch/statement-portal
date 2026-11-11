import 'server-only';
import { z } from 'zod';
import { planProductionInventory, type InventoryPlanningStore } from './planner.ts';
import { deliverInventoryOnce, type InventoryDeliveryStore, type InventoryDeliveryTransport } from './delivery.ts';

export const inventorySelectionSchema = z.union([
  z.object({ status: z.literal('selected'), token: z.string().uuid() }).strict(),
  z.object({ status: z.enum(['disabled', 'blocked', 'stale', 'already-accepted']) }).strict(),
]);
export interface InventoryCycleStore extends InventoryDeliveryStore {
  selectNext(token: string): Promise<z.infer<typeof inventorySelectionSchema>>;
}
/** One bounded cycle, no scheduler or activation. Planning always rereads the
 * canonical calendar. Selection persists/resumes the lease in SQL, so restarts
 * and lost responses need no in-memory token. The final claim and begin repeat
 * validation. No caller should loop immediately on a blocked/uncertain result. */
export async function runInventoryCycle(planning: InventoryPlanningStore, delivery: InventoryCycleStore,
  transport: InventoryDeliveryTransport, token: string, clock = Date.now) {
  z.string().uuid().parse(token);
  const planned = await planProductionInventory(planning, clock);
  if (!['stored', 'refreshed', 'unchanged'].includes(planned.status)) return { status: planned.status };
  const selection = inventorySelectionSchema.parse(await delivery.selectNext(token));
  if (selection.status !== 'selected') return { status: selection.status };
  return deliverInventoryOnce(delivery, transport, selection.token, clock);
}
