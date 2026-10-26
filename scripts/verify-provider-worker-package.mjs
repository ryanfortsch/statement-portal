/** Import-only packaging check. No credentials, clients, timers, database or network calls. */
import { createAirbnbRevisionReader } from '../src/lib/channex-bookings/client.ts';
import { processAirbnbBookingCycle } from '../src/lib/channex-bookings/cycle.ts';
import { createAirbnbThreadReader } from '../src/lib/channex-bookings/thread.ts';
import { createAirbnbBookingStore } from '../src/lib/channex-bookings/store.ts';
if (typeof createAirbnbRevisionReader !== 'function' || typeof processAirbnbBookingCycle !== 'function'
    || typeof createAirbnbThreadReader !== 'function' || typeof createAirbnbBookingStore !== 'function')
  throw new Error('Provider worker modules incomplete');
console.log('Provider worker modules loaded; no runtime activated.');
