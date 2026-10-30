/** Static diagnostic phases only: never retain exception text, credentials or payloads. */
export type InventoryFailurePhase = 'prepare' | 'dispatch-save' | 'before-send' | 'submit' | 'receipt-save';
export class InventoryDeliveryError extends Error {
  readonly phase: InventoryFailurePhase;
  constructor(phase: InventoryFailurePhase) {
    super(`Inventory delivery failed: ${phase}`);
    this.phase = phase;
  }
}
export async function inventoryStage<T>(phase: InventoryFailurePhase, action: () => Promise<T>): Promise<T> {
  try { return await action(); }
  catch (error) {
    if (error instanceof InventoryDeliveryError) throw error;
    throw new InventoryDeliveryError(phase);
  }
}
