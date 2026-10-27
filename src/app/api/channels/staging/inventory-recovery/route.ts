import { auth } from '@/auth';
import { createBookingInventoryConsumerStore } from '@/lib/channex-staging/booking-inventory-consumer-store';
import { createInventoryRouteReader } from '@/lib/channex-staging/inventory-route-store';
import { parseBookingInventoryState } from '@/lib/channex-staging/booking-inventory-consumer';
import { inventoryRecoveryAllowed, inventoryRecoveryView, prepareInventoryRecovery, executeInventoryRecovery, recoveryBinding } from '@/lib/channex-staging/inventory-recovery';
import { ChannexAvailabilityClient } from '@/lib/channex-staging/availability-client';
import { readIsolatedChannex, CALDERWOOD_STAGING } from '@/lib/calderwood-readonly/channex';
import { propertyMapping } from '@/lib/channex-staging/inventory-route';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const headers = { 'Cache-Control': 'private, no-store' };
async function allowed() { return inventoryRecoveryAllowed((await auth())?.user?.email, process.env); }
function store() { return createBookingInventoryConsumerStore(process.env.CHANNEX_STAGING_DB_URL ?? '', process.env.CHANNEX_STAGING_DB_SERVICE_KEY ?? '', 'HELMTEST-calderwood'); }
export async function GET() {
  if (!await allowed()) return Response.json({ error: 'unavailable' }, { status: 403, headers });
  try { const db = store(); return Response.json(inventoryRecoveryView(parseBookingInventoryState(await db.read(), db.property)), { headers }); }
  catch { return Response.json({ error: 'Recovery status unavailable.' }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  if (!await allowed()) return Response.json({ error: 'unavailable' }, { status: 403, headers });
  if (!process.env.AUTH_URL || request.headers.get('origin') !== new URL(process.env.AUTH_URL).origin) return Response.json({ error: 'origin' }, { status: 403, headers });
  try {
    const body = await request.json();
    if (!body || !['prepare', 'execute'].includes(body.action) || Object.keys(body).some(k => !['action', 'binding'].includes(k))) return Response.json({ error: 'Invalid action' }, { status: 400, headers });
    const db = store();
    if (body.action === 'prepare') return Response.json(await prepareInventoryRecovery(db), { headers });
    const binding = recoveryBinding.parse(body.binding);
    const state = parseBookingInventoryState(await db.read(), db.property);
    const route = await createInventoryRouteReader(process.env.CHANNEX_STAGING_DB_URL!, process.env.CHANNEX_STAGING_DB_SERVICE_KEY!)(state);
    if (route.propertyId !== CALDERWOOD_STAGING.propertyId || route.roomTypeId !== CALDERWOOD_STAGING.roomTypeId || route.ratePlanId !== CALDERWOOD_STAGING.ratePlanId) throw Error('Mapping changed');
    const key = process.env.CHANNEX_STAGING_API_KEY ?? '';
    const client = new ChannexAvailabilityClient(key, { environment: 'staging', helmProperty: route.helmProperty, connection: route.connection,
      generation: route.generation, propertyId: route.propertyId, roomTypeId: route.roomTypeId, propertyTitle: route.propertyTitle });
    const result = await executeInventoryRecovery(db, client, binding, async current => {
      const observed = await readIsolatedChannex(key, { from: current.configuration.start, to: current.configuration.end }, propertyMapping(route));
      if (observed.days.length !== 500 || observed.days.some(day => day.stopSell !== true || Object.values(day).some(v => v === null))) throw Error('Complete stopped calendar required');
    });
    return Response.json({ ...inventoryRecoveryView(parseBookingInventoryState(await db.read(), db.property)), result }, { headers });
  } catch {
    return Response.json({ error: 'Recovery did not complete. Refresh status before continuing. A prepared 500-day window, fresh source coverage and unchanged reviewed plan are required. Saved attempts and receipts are retained.' }, { status: 409, headers });
  }
}
