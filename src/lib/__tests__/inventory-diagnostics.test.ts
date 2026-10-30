import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryStage, InventoryDeliveryError } from '../channex-staging/inventory-diagnostics.ts';
import { runInventoryScheduler } from '../channex-staging/booking-inventory-scheduler.ts';
test('delivery stage logs sanitize exceptions and never retry inside a stage', async () => {
  for (const phase of ['prepare', 'dispatch-save', 'before-send', 'submit', 'receipt-save'] as const) {
    let calls = 0; const logs: unknown[] = [];
    await runInventoryScheduler({ signal: new AbortController().signal, once: true,
      cycle: async () => inventoryStage(phase, async () => { calls++; throw Error('SECRET payload'); }),
      log: entry => logs.push(entry) });
    assert.equal(calls, 1);
    assert.equal((logs[0] as {phase:string}).phase, `delivery-${phase}`);
    assert.doesNotMatch(JSON.stringify(logs), /SECRET|payload/);
  }
});
test('pre-send classification survives outer submit stage without exposing original details', async () => {
  await assert.rejects(inventoryStage('submit', async () => { throw new InventoryDeliveryError('before-send'); }),
    (error: unknown) => error instanceof InventoryDeliveryError && error.phase === 'before-send');
  assert.equal(await inventoryStage('prepare', async () => 42), 42);
});
