// Local fixture shares the reviewed pilot's canonical source sections.
// NOT a replay of every migration or a snapshot of production. No hosted IO.
import { readFileSync } from 'node:fs';
import { canonicalPilotSchema } from './canonical-pilot-schema.mjs';
export async function installBookingInventoryFixture(db) {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  for(const sql of canonicalPilotSchema().parts) await db.exec(sql);
  const capture=readFileSync(new URL('../docs/guesty-exit/staging-storage/booking-inventory-events.sql',import.meta.url),'utf8');
  await db.exec(capture);
  return {capture};
}
