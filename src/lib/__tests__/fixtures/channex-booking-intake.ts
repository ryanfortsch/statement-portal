/** Synthetic provider only. No credentials or customer data. */
import assert from 'node:assert/strict';
import { CALDERWOOD_PRODUCTION as m } from '../../channex-production-preflight.ts';
import { PRODUCTION_DB_URL } from '../../channex-production-runtime.ts';
import type { AirbnbBookingReceipt } from '../../channex-bookings/ingestion.ts';
import type { AirbnbBookingRevision } from '../../channex-bookings/revision.ts';
export const intakeEnv = { VERCEL_ENV: 'production', HELM_CHANNEX_BOOKINGS_MODE: 'calderwood-v1',
  CHANNEX_PRODUCTION_MODE: 'off', NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_DB_URL,
  SUPABASE_SERVICE_ROLE_KEY: 'SYNTHETIC_SERVICE_KEY', CHANNEX_PRODUCTION_API_KEY: 'SYNTHETIC_PROVIDER_KEY', CRON_SECRET: 'SYNTHETIC_CRON_KEY' };
export const intakeId = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export function intakeRow(n = 1, status = 'new') {
  const start = `2035-02-${String(1 + n * 2).padStart(2, '0')}`;
  const end = `2035-02-${String(2 + n * 2).padStart(2, '0')}`;
  return { type: 'booking_revision', id: intakeId(n), attributes: {
    booking_id: intakeId(n + 100), property_id: String(m.propertyId), ota_name: 'Airbnb', ota_reservation_code: `INTAKESYNTHETIC${n}`,
    status, arrival_date: start, departure_date: end, inserted_at: `2026-11-13T12:00:00.${String(n).padStart(6, '0')}Z`,
    customer: { name: 'Synthetic', surname: null, mail: 'synthetic@example.invalid', phone: null,
      address: null, city: null, state: null, country: null, zip: null }, notes: null,
    rooms: [{ room_type_id: m.roomTypeId, rate_plan_id: m.ratePlanId, checkin_date: start, checkout_date: end }],
  } };
}
export function intakeHarness(rows = [intakeRow()]) {
  const events: string[] = [], receipts = new Map<string, AirbnbBookingReceipt>(), acked = new Set<string>();
  const storage = { propertyId: m.helmPropertyId, environment: 'production', remotePropertyId: m.propertyId,
    roomTypeId: m.roomTypeId, ratePlanId: m.ratePlanId, generation: 1,
    importEnabled: true, captureEnabled: true, calendarAuthority: 'helm', receipts: 0, inventoryEvents: 0 };
  const relation = (id: string) => ({ data: { id } });
  const rpc = async (name: string, args: Record<string, unknown>, signal: AbortSignal) => {
    signal.throwIfAborted(); events.push(name);
    if (name === 'helm_channex_storage_status') return { data: structuredClone(storage), error: null };
    if (name === 'helm_airbnb_revision_commit') {
      const revision = args.p_revision as AirbnbBookingRevision;
      const old = receipts.get(revision.revisionId);
      if (old) assert.deepEqual(old.revision, revision);
      else receipts.set(revision.revisionId, { revision: structuredClone(revision), canonicalBookingId: intakeId(900),
        outcome: 'applied', committed: true, committedAt: '2026-11-13T13:00:00.000001Z', firstReceivedAt: '2026-11-13T13:00:00.000001Z' });
      return { data: structuredClone(receipts.get(revision.revisionId)), error: null };
    }
    assert.equal(name, 'helm_airbnb_revision_receipt');
    return { data: structuredClone(receipts.get(args.p_id as string)), error: null };
  };
  const fetcher: typeof fetch = async (input, init) => {
    init?.signal?.throwIfAborted();
    const url = new URL(String(input)), path = url.pathname.replace('/api/v1', '');
    assert.equal(url.origin, 'https://app.channex.io');
    assert.equal(init?.redirect, 'error'); assert.equal(init.cache, 'no-store');
    assert.equal(new Headers(init.headers).get('user-api-key'), intakeEnv.CHANNEX_PRODUCTION_API_KEY);
    events.push(`${init.method} ${path}`);
    if (path === '/properties/' + m.propertyId) return Response.json({ data: { id: m.propertyId } });
    if (path === '/room_types/' + m.roomTypeId) return Response.json({ data: { id: m.roomTypeId, relationships: { property: relation(m.propertyId) } } });
    if (path === '/rate_plans/' + m.ratePlanId) return Response.json({ data: { id: m.ratePlanId, relationships: { property: relation(m.propertyId), room_type: relation(m.roomTypeId) } } });
    if (path === '/booking_revisions/feed') {
      assert.equal(url.searchParams.get('pagination[page]'), '1');
      assert.equal(url.searchParams.has('filter[property_id]'), false);
      const pending = rows.filter(r => !acked.has(r.id));
      return Response.json({ data: pending, meta: { page: 1, total: pending.length, limit: 100 } });
    }
    const row = rows.find(r => path === '/booking_revisions/' + r.id || path === '/booking_revisions/' + r.id + '/ack');
    assert.ok(row, 'Unexpected provider IO');
    if (init.method === 'POST') {
      assert.equal(path, '/booking_revisions/' + row.id + '/ack'); acked.add(row.id);
      return Response.json({ meta: { message: 'Success' } });
    }
    const remote = structuredClone(row);
    if (acked.has(row.id)) { Object.assign(remote.attributes, { acknowledge_status: 'acknowledged' }); remote.attributes.customer.mail = '***'; }
    return Response.json({ data: remote });
  };
  return { rows, events, receipts, acked, storage, rpc, fetcher };
}
