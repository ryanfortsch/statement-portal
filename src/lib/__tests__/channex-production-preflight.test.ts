import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALDERWOOD_PRODUCTION as m, inspectCalderwoodProduction, ProductionPreflightError } from '../channex-production-preflight.ts';

const key = 'synthetic-token-for-test-only';
const rel = (id: string) => ({ data: { id } });
function fixtures() {
  return [
    { data: { id: m.propertyId, attributes: { title: m.propertyTitle, currency: 'USD', timezone: 'America/New_York', property_type: 'holiday_home' } } },
    { data: { id: m.roomTypeId, attributes: { title: m.roomTitle, count_of_rooms: 1, occ_adults: 6, occ_children: 0, occ_infants: 0 }, relationships: { property: rel(m.propertyId) } } },
    { data: { id: m.ratePlanId, attributes: { title: m.rateTitle, currency: 'USD', sell_mode: 'per_room', rate_mode: 'manual', stop_sell: Array(7).fill(true) }, relationships: { property: rel(m.propertyId), room_type: rel(m.roomTypeId) } } },
    { data: [], meta: { total: 0, page: 1 } },
  ];
}
function mock(payloads: unknown[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  return { calls, fetcher: async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(payloads[calls.length - 1]), { status: 200 });
  } };
}
const rejectsCode = (code: string) => (error: unknown) => error instanceof ProductionPreflightError && error.code === code;

test('production inspection uses only the four fixed GETs and cannot report cutover readiness', async () => {
  const f = mock(fixtures());
  const receipt = await inspectCalderwoodProduction(key, f.fetcher);
  assert.equal(receipt.readyForCutover, false);
  assert.equal(receipt.writesPerformed, false);
  assert.equal(receipt.calendarAuthorityChanged, false);
  assert.equal(receipt.priceAuthority, 'pricelabs');
  assert.equal(receipt.channels, 0);
  assert.equal(f.calls.length, 4);
  assert.deepEqual(f.calls.slice(0, 3).map(c => new URL(c.url).pathname), [
    `/api/v1/properties/${m.propertyId}`, `/api/v1/room_types/${m.roomTypeId}`, `/api/v1/rate_plans/${m.ratePlanId}`,
  ]);
  for (const { url, init } of f.calls) {
    assert.equal(new URL(url).origin, 'https://app.channex.io');
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.body, undefined);
    assert.equal(new Headers(init.headers).get('user-api-key'), key);
    assert.equal(url.includes(key), false);
    assert.ok(init.signal);
  }
  assert.equal(new URL(f.calls[3].url).searchParams.get('filter[property_id]'), m.propertyId);
  assert.equal(JSON.stringify(receipt).includes(key), false);
});

test('missing or malformed credentials never contact the provider', async () => {
  for (const value of ['', ' ', ' token', 'token\n', 'token\u0000suffix', 'a'.repeat(4097)]) {
    const f = mock(fixtures());
    await assert.rejects(inspectCalderwoodProduction(value, f.fetcher), rejectsCode('CREDENTIAL_REQUIRED'));
    assert.equal(f.calls.length, 0);
  }
});

test('staging property, wrong currency, timezone or billing classification fail before subsequent reads', async () => {
  for (const patch of [{ id: '30584a9a-8784-4eb1-a387-e26bd43aec1c' },
    { currency: 'EUR' }, { timezone: 'UTC' }, { property_type: 'hotel' }]) {
    const rows = fixtures();
    const property = rows[0].data as { id: string; attributes: Record<string, unknown> };
    if ('id' in patch) property.id = patch.id!;
    else Object.assign(property.attributes, patch);
    const f = mock(rows);
    await assert.rejects(inspectCalderwoodProduction(key, f.fetcher), rejectsCode('MAPPING_MISMATCH'));
    assert.equal(f.calls.length, 1);
  }
});

test('room and rate must belong to the exact reviewed production property and room', async () => {
  for (const index of [1, 2]) {
    const rows = fixtures();
    const row = rows[index].data as { relationships: { property: { data: { id: string } } } };
    row.relationships.property.data.id = 'another-property';
    const f = mock(rows);
    await assert.rejects(inspectCalderwoodProduction(key, f.fetcher), rejectsCode('MAPPING_MISMATCH'));
    assert.equal(f.calls.length, index + 1);
  }
});

test('missing, shortened or partially open stop-sell defaults fail closed', async () => {
  for (const flags of [undefined, [], Array(6).fill(true), [true, true, true, false, true, true, true], Array(7).fill('true')]) {
    const rows = fixtures();
    const rate = rows[2].data as { attributes: Record<string, unknown> };
    rate.attributes.stop_sell = flags;
    await assert.rejects(inspectCalderwoodProduction(key, mock(rows).fetcher), rejectsCode('RATE_NOT_CLOSED'));
  }
});

test('channels present, omitted metadata and incomplete collection evidence are not accepted', async () => {
  for (const channels of [{ data: [{ id: 'synthetic-channel' }], meta: { total: 1, page: 1 } },
    { data: [], meta: { total: 1, page: 1 } }, { data: [], meta: { total: 0, page: 2 } }, { data: [] }]) {
    const rows: unknown[] = fixtures(); rows[3] = channels;
    await assert.rejects(inspectCalderwoodProduction(key, mock(rows).fetcher),
      error => error instanceof ProductionPreflightError && ['CHANNELS_PRESENT', 'INVALID_RESPONSE'].includes(error.code));
  }
});

test('provider errors, warnings, redirect attempts and invalid JSON never disclose response bodies or credentials', async () => {
  for (const response of [new Response(`private body ${key}`, { status: 401 }),
    new Response(`private body ${key}`, { status: 404 }), new Response(`private body ${key}`, { status: 500 }),
    new Response('', { status: 302, headers: { Location: 'https://example.invalid' } }),
    new Response(`private body ${key}`), new Response(JSON.stringify({ errors: { secret: key } })),
    new Response(JSON.stringify({ data: {}, meta: { warnings: [key] } }))]) {
    await assert.rejects(inspectCalderwoodProduction(key, async () => response), error => {
      assert.ok(error instanceof ProductionPreflightError);
      assert.equal(String(error).includes(key), false);
      assert.equal(String(error).includes('private body'), false);
      return true;
    });
  }
  await assert.rejects(inspectCalderwoodProduction(key, async () => { throw new Error(key); }),
    rejectsCode('PROVIDER_UNAVAILABLE'));
});
