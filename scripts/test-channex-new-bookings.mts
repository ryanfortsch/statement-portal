/** Local synthetic rehearsal only. No env/credentials, live DB or network adapter. */
import { runNewBookingRehearsal } from '../src/lib/__tests__/fixtures/channex-new-booking-rehearsal.ts';

// All production dependencies must stay injected. Fail an accidental global fetch
// rather than letting this acceptance command contact any real service.
globalThis.fetch = async () => { throw Error('Network disabled during synthetic new-booking rehearsal'); };
console.log(JSON.stringify(await runNewBookingRehearsal(), null, 2));
