/** Explicit, bounded planning pass. Does not submit to Channex or start a loop. */
import { createBookingInventoryConsumerStore } from '../src/lib/channex-staging/booking-inventory-consumer-store.ts';
import { consumeBookingInventory } from '../src/lib/channex-staging/booking-inventory-consumer.ts';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: channex-booking-inventory.mts plan <property-id>');
  console.log('Requires CHANNEX_WORKER_MODE=isolated-staging and CHANNEX_BOOKING_INVENTORY_MODE=plan-only.');
  console.log('Uses explicit CHANNEX_STAGING_DB_URL and CHANNEX_STAGING_DB_SERVICE_KEY. No provider submission.');
} else if (args.length !== 2 || args[0] !== 'plan' || !/^[A-Za-z0-9_-]{1,160}$/.test(args[1]) ||
    process.env.CHANNEX_WORKER_MODE !== 'isolated-staging' || process.env.CHANNEX_BOOKING_INVENTORY_MODE !== 'plan-only') {
  console.error('Explicit isolated-staging, plan-only mode and property ID required. Use --help.');
  process.exitCode = 1;
} else {
  try {
    const store = createBookingInventoryConsumerStore(process.env.CHANNEX_STAGING_DB_URL ?? '',
      process.env.CHANNEX_STAGING_DB_SERVICE_KEY ?? '', args[1]);
    const result = await consumeBookingInventory(store, Date.now);
    console.log(JSON.stringify({ event: 'booking-inventory-plan', status: result.status }));
    if (result.status === 'blocked' || result.status === 'superseded') process.exitCode = 2;
  } catch {
    console.error('Planning stopped. Retain durable history and reread before retry; no provider submission was attempted.');
    process.exitCode = 1;
  }
}
