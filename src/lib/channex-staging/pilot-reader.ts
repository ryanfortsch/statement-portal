/** Unwired, GET-only reader for the two approved 17 Beach properties on Channex staging.
 * Deliberately independent of the synthetic writer. No ACK, send, receipt or calendar methods.
 */
import {PILOTS,record,textField,validateRevision,type Unit,type Revision} from './core.ts';
import {normalizePilotThread,normalizePilotMessage} from './messages.ts';
const BASE='https://staging.channex.io/api/v1';
type Json=Record<string,unknown>;
type Fetcher=(input:string|URL|Request,init?:RequestInit)=>Promise<Response>;
function uuid(value:unknown):string{const id=textField(value);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw Error('Invalid pilot resource ID');return id;}
function checkUnit(unit:Unit){if(unit!=='front'&&unit!=='back')throw Error('Unknown pilot unit');}
export class PilotReadError extends Error{constructor(status:number){super(`Pilot read failed (HTTP ${status || 'network'}); response withheld`);}}
export function normalizeAirbnbBooking(raw:unknown,unit:Unit):Revision{
 checkUnit(unit);const row=record(raw),a=record(row.attributes);
 if(row.type!=='booking'||a.property_id!==PILOTS[unit].propertyId||a.ota_name!=='Airbnb')throw Error('Booking outside approved Airbnb pilot');
 if(!Array.isArray(a.rooms)||a.rooms.length!==1)throw Error('Unexpected pilot room count');
 const room=record(a.rooms[0]);
 if(room.room_type_id!==PILOTS[unit].roomTypeId)throw Error('Booking room outside pilot');
 const checkIn=textField(a.arrival_date),checkOut=textField(a.departure_date);
 if((room.checkin_date&&room.checkin_date!==checkIn)||(room.checkout_date&&room.checkout_date!==checkOut))throw Error('Inconsistent booking dates');
 // Snapshot time is NOT a revision ordering authority. This result must not drive inventory.
 return validateRevision({id:uuid(a.revision_id),bookingId:uuid(row.id),member:unit,status:a.status as Revision['status'],checkIn,checkOut,receivedAt:textField(a.inserted_at)});
}
export class ChannexPilotReader{
 #key:string;#fetch:Fetcher;
 constructor(apiKey:string,fetcher:Fetcher=fetch){
  if(typeof window!=='undefined')throw Error('Pilot credentials are server-only');
  if(!apiKey.trim())throw Error('Pilot credential missing');
  this.#key=apiKey.trim();this.#fetch=fetcher;
 }
  async #request(path: string): Promise<Json> {
    let response: Response;
    try {
      response = await this.#fetch(`${BASE}${path}`, {
        method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000),
        headers: { 'user-api-key': this.#key, Accept: 'application/json' },
      });
    } catch { throw new PilotReadError(0); }
    if (!response.ok) throw new PilotReadError(response.status);
    let result: Json;
    try { result = record(await response.json()); } catch { throw new Error('Invalid Channex JSON response'); }
    if (result.errors) throw new Error('Channex returned an error envelope');
    if (result.meta) {
      const warnings = record(result.meta).warnings;
      if (warnings !== undefined && (!Array.isArray(warnings) || warnings.length)) throw new Error('Channex rejected part of the update; read-back reconciliation required');
    }
    return result;
  }
  async #list(path: string, unit: Unit): Promise<Json[]> {
    checkUnit(unit);
    const rows: Json[] = [], ids = new Set<string>();
    let expectedTotal: number | undefined;
    for (let page = 1; page <= 20; page++) {
      const params = new URLSearchParams({ 'filter[property_id]': PILOTS[unit].propertyId, 'pagination[page]': String(page), 'pagination[limit]': '100' });
      const result = await this.#request(`${path}?${params}`);
      if (!Array.isArray(result.data)) throw new Error('Invalid Channex collection');
      const meta = record(result.meta);
      if (!Number.isInteger(meta.total) || (meta.total as number) < 0 || meta.page !== page || !Number.isInteger(meta.limit) || (meta.limit as number) < 1) throw new Error('Invalid Channex pagination');
      if(expectedTotal!==undefined&&expectedTotal!==meta.total)throw Error('Collection changed during pagination');
      expectedTotal=meta.total as number;
      for (const item of result.data) {
        const row = record(item), id = textField(row.id);
        if (ids.has(id)) throw new Error('Collection changed during pagination; retry before writing');
        ids.add(id); rows.push(row);
      }
      if (rows.length === meta.total) return rows;
      if (!result.data.length || rows.length > (meta.total as number)) throw new Error('Incomplete Channex collection');
    }
    throw new Error('Channex collection exceeds pilot safety limit');
  }
  async #identity(unit:Unit){
  checkUnit(unit);const expected=PILOTS[unit];
  const property=record((await this.#request(`/properties/${expected.propertyId}`)).data),a=record(property.attributes);
  if(property.id!==expected.propertyId||a.currency!=='USD'||a.timezone!=='America/New_York')throw Error('Pilot property identity changed');
  const room=record((await this.#request(`/room_types/${expected.roomTypeId}`)).data),r=record(room.attributes);
  const parent=record(record(record(room.relationships).property).data).id;
  if(room.id!==expected.roomTypeId||parent!==expected.propertyId||r.count_of_rooms!==1||r.occ_adults!==expected.capacity)throw Error('Pilot room identity changed');
 }
 async readBookings(unit:Unit){
  await this.#identity(unit);
  const bookings=(await this.#list('/bookings',unit)).map(row=>normalizeAirbnbBooking(row,unit));
  return {mode:'read-only-snapshot' as const,inventoryAuthority:false as const,bookings};
 }
 async readMessages(unit:Unit,threadId?:string){
  checkUnit(unit);if(threadId)uuid(threadId);
  await this.#identity(unit);
  const threads=(await this.#list('/message_threads',unit)).map(row=>{
   const thread=normalizePilotThread(row,unit);if(thread.provider!=='Airbnb')throw Error('Thread outside Airbnb pilot');return thread;
  });
  if(!threadId)return {threads,messages:[],selectedThread:null};
  if(!threads.some(t=>t.id===threadId))throw Error('Thread outside selected pilot');
  const messages=(await this.#list(`/message_threads/${threadId}/messages`,unit)).map(row=>normalizePilotMessage(row,threadId));
  return {threads,messages,selectedThread:threadId};
 }
}
