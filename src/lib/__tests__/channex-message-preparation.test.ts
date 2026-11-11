import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewCalderwoodTiming, confirmationInstant, type SourceClocks } from '../channex-messaging/preparation-timing.ts';
import { reviewPreparationRules, parsePreparationRules } from '../channex-messaging/preparation-rules.ts';
import { reviewMessagePreparation } from '../channex-messaging/preparation.ts';
import { GUESTY_ACCOUNT, GUESTY_CALDERWOOD } from '../channex-bookings/message-identity.ts';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const id = (n: number) => n.toString(16).padStart(24, '0');
const now = Date.parse('2026-11-07T18:00:00Z');
const clocks: SourceClocks = { start: '2026-11-24', end: '2026-11-28', timezone: 'America/New_York',
  plannedArrival: null, plannedDeparture: null, defaultArrival: '16:00', defaultDeparture: '11:00',
  confirmedAt: '2026-11-07T17:50:22.123Z' };
const byKey = (input: SourceClocks = clocks, at = now) => Object.fromEntries(reviewCalderwoodTiming(input, at).map(r => [r.key, r]));

test('all six times preserve source offsets including the 30-minute confirmation delay', () => {
  const r = byKey();
  assert.equal(r.booking_confirmed.at, '2026-11-07T18:20:22.123Z');
  assert.equal(r.pre_arrival.at, '2026-11-23T21:00:00.000Z');
  assert.equal(r.checkin_day.at, '2026-11-24T20:00:00.000Z');
  assert.equal(r.pre_checkout.at, '2026-11-27T16:00:00.000Z');
  assert.equal(r.cleaner_reminder.at, '2026-11-14T21:00:00.000Z');
  assert.equal(r.cleaner_arrival.at, '2026-11-24T14:00:00.000Z');
  assert.equal(Object.values(r).every(v => v.canSend === false && v.status === 'future'), true);
});
test('reservation ETA and ETD take precedence over listing defaults', () => {
  const r = byKey({ ...clocks, plannedArrival: '18:00', plannedDeparture: '12:00' });
  assert.equal(r.pre_arrival.at, '2026-11-23T23:00:00.000Z');
  assert.equal(r.checkin_day.at, '2026-11-24T22:00:00.000Z');
  assert.equal(r.pre_checkout.at, '2026-11-27T17:00:00.000Z');
  assert.equal(r.cleaner_arrival.at, '2026-11-24T16:00:00.000Z');
});
test('summer offsets remain local, not a fixed UTC 3 PM assumption', () => {
  const r = byKey({ ...clocks, start: '2027-05-20', end: '2027-05-24' });
  assert.equal(r.checkin_day.at, '2027-05-20T19:00:00.000Z');
  assert.equal(r.cleaner_arrival.at, '2027-05-20T13:00:00.000Z');
});
test('missing or malformed overrides never select a listing default', () => {
  for (const plannedArrival of [undefined, '', '4 PM', '24:00', '16:00:00', {}, false]) {
    const r = byKey({ ...clocks, plannedArrival });
    assert.equal(r.checkin_day.at, null); assert.equal(r.pre_arrival.status, 'unverified');
    assert.equal(r.pre_checkout.at, '2026-11-27T16:00:00.000Z');
  }
  for (const timezone of [undefined, null, 'UTC', 'America/Chicago'])
    assert.equal(byKey({ ...clocks, timezone }).checkin_day.at, null);
  assert.equal(byKey({ ...clocks, defaultArrival: undefined }).checkin_day.at, null);
});
test('both DST boundaries withhold day-based times when calendar and elapsed candidates differ', () => {
  for (const start of ['2027-03-14', '2027-11-07']) {
    const r = byKey({ ...clocks, start, end: start.slice(0, 8) + String(Number(start.slice(-2)) + 1).padStart(2, '0') });
    assert.equal(r.pre_arrival.at, null); assert.equal(r.pre_arrival.status, 'dst_review');
    const c = r.pre_arrival.conflict!;
    assert.equal(Math.abs(Date.parse(c.calendarAt!) - Date.parse(c.elapsedAt)), 3600000);
    assert.equal(r.checkin_day.status, 'future');
  }
});
test('gap and repeated local clocks are not assigned arbitrary instants', () => {
  for (const [start, plannedArrival] of [['2027-03-14', '02:30'], ['2027-11-07', '01:30']]) {
    const r = byKey({ ...clocks, start, end: start.slice(0, 8) + String(Number(start.slice(-2)) + 1).padStart(2, '0'), plannedArrival });
    assert.equal(r.checkin_day.at, null); assert.equal(r.cleaner_arrival.at, null);
  }
});
test('overdue confirmations and key codes stay past, never rescheduled to now', () => {
  const r = byKey(clocks, Date.parse('2026-11-24T21:00:00Z'));
  assert.equal(r.booking_confirmed.status, 'past_or_due');
  assert.equal(r.booking_confirmed.at, '2026-11-07T18:20:22.123Z');
  assert.equal(r.checkin_day.status, 'past_or_due');
  assert.equal(r.checkin_day.at, '2026-11-24T20:00:00.000Z');
});
test('confirmation evidence requires a real zoned instant, never dates or future values', () => {
  for (const v of [null, undefined, '2026-11-07', '2026-11-07T17:50:00', '2026-02-30T00:00:00Z',
    '2026-11-07T19:00:00Z', '2026-11-07T17:50:61Z']) assert.equal(confirmationInstant(v, now), null);
  assert.equal(confirmationInstant('2026-11-07T12:50:00-05:00', now), '2026-11-07T17:50:00.000Z');
  assert.throws(() => byKey({ ...clocks, start: '2026-02-30' }));
  assert.throws(() => byKey({ ...clocks, end: clocks.start }));
});

const rule = { id: uid(90), key: 'booking_confirmed', property_id: null, audience: 'guest', trigger: 'booking_confirmed',
  offset_days: 0, at_local: null, timezone: 'America/New_York', channel_exclusions: [], delivery: 'sms_then_email',
  send_mode: 'approve', min_nights: null, subject: null, body: 'PRIVATE_TEMPLATE {{guest_first}} {{door_code}}',
  enabled: false, configured_in_ota: false };
test('rule review includes disabled property overrides and never treats fleet defaults as migrated', () => {
  const r = reviewPreparationRules([rule, { ...rule, id: uid(91), property_id: '65_calderwood' }]);
  assert.equal(r.workflows.length, 6); assert.equal(r.missingWorkflows, 5); assert.equal(r.propertySpecificWorkflows, 1);
  assert.equal(r.workflows[0].rule?.id, uid(91));
  assert.equal(r.workflows[0].rule?.enabled, false);
  assert.equal(r.workflows[0].rule?.relativeTimingSupported, false);
  assert.equal(r.workflows[0].rule?.templateParityVerified, false);
  assert.equal(JSON.stringify(r).includes('PRIVATE_TEMPLATE'), false);
});
test('ambiguous and invalid rules fail rather than using defaults or choosing an arbitrary row', () => {
  assert.throws(() => parsePreparationRules([rule, { ...rule, id: uid(91) }]));
  for (const patch of [{ enabled: undefined }, { offset_days: '0' }, { property_id: 'other_home' },
    { at_local: '26:00' }, { trigger: 'unknown' }, { body: null }]) assert.throws(() => parsePreparationRules([{ ...rule, ...patch }]));
});
test('unsupported and malformed tokens are counted without exposing arbitrary field names', () => {
  const r = reviewPreparationRules([{ ...rule, body: '{{PRIVATE_FIELD}} {{guest_first}} {{bad.name}} {{wifi_password}}' }]);
  assert.equal(r.workflows[0].rule?.unsupportedFieldCount, 1);
  assert.equal(r.workflows[0].rule?.malformedTemplate, true);
  assert.equal(JSON.stringify(r).includes('PRIVATE_FIELD'), false);
  assert.deepEqual(r.workflows[0].rule?.fields, ['guest_first', 'wifi_password']);
});

const canonical = { format: 1, propertyId: '65_calderwood', authority: 'guesty', rows: [
  { id: uid(1), channel: 'airbnb', source: 'ical_import', status: 'confirmed', checkIn: clocks.start,
    checkOut: clocks.end, code: 'SYNTHETIC-CODE', duplicateOf: null, holdKind: null },
] };
const mirror = [{ guesty_reservation_id: id(1), property_id: '65_calderwood', listing_id: GUESTY_CALDERWOOD,
  confirmation_code: 'SYNTHETIC-CODE', check_in: clocks.start, check_out: clocks.end, channel: 'Airbnb', status: 'confirmed' }];
const env = { VERCEL_ENV: 'production', CHANNEX_PRODUCTION_MODE: 'inspect',
  NEXT_PUBLIC_SUPABASE_URL: 'https://qjueexujiuticjrtqdyj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic', CHANNEX_PRODUCTION_API_KEY: 'synthetic' };
const detail = { _id: id(1), accountId: GUESTY_ACCOUNT, listingId: GUESTY_CALDERWOOD, confirmationCode: 'SYNTHETIC-CODE',
  status: 'confirmed', integration: { platform: 'airbnb2' }, checkInDateLocalized: clocks.start, checkOutDateLocalized: clocks.end,
  plannedArrival: null, plannedDeparture: null, listing: { timezone: clocks.timezone, defaultCheckInTime: '16:00', defaultCheckOutTime: '11:00' } };
const v3 = { _id: id(1), status: 'confirmed', confirmedAt: clocks.confirmedAt,
  stay: [{ unitId: GUESTY_CALDERWOOD, unitTypeId: GUESTY_CALDERWOOD, checkInDateLocalized: clocks.start, checkOutDateLocalized: clocks.end }] };
function fixture() {
  const calls: string[] = []; let guards = 0;
  const context = { canonical, mirror, rules: [rule], automationsEnabled: false,
    renderInputs: { property: { id: '65_calderwood', name: 'Synthetic home', wifi_name: null }, access: null, lockMapped: false, cleanerRecipients: [] as { enabled: boolean; property_ids: string[]; region: string }[],
      bookings: [{ id: uid(1), property_id: '65_calderwood', status: 'confirmed', check_in: clocks.start, check_out: clocks.end, guest_name: 'PRIVATE_GUEST' }] } };
  const deps = { clock: () => now, context: async () => structuredClone(context),
    verifyDormant: async () => { guards++; }, token: async () => 'synthetic-token',
    fetcher: (async (input, init) => {
      const url = new URL(String(input)); calls.push(url.pathname);
      assert.equal(url.origin, 'https://open-api.guesty.com'); assert.equal(init?.method, 'GET');
      assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error'); assert.ok(init.signal);
      assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer synthetic-token');
      if (url.pathname.endsWith('reservations-v3')) {
        assert.deepEqual(url.searchParams.getAll('reservationIds[]'), [id(1)]);
        return Response.json([{ ...v3, guest: 'PRIVATE_GUEST', money: 'PRIVATE_MONEY' }]);
      }
      assert.equal(url.pathname, `/v1/reservations/${id(1)}`);
      assert.equal(url.searchParams.get('fields')?.includes('guest'), false);
      return Response.json({ ...detail, unused: 'PRIVATE_UNUSED' });
    }) as typeof fetch };
  return { deps, calls, guards: () => guards };
}
test('production review binds exact stays, double-reads source, and returns no content or send authority', async () => {
  const f = fixture(), r = await reviewMessagePreparation(env, f.deps);
  assert.equal(r.sourceReads, 4); assert.equal(f.guards(), 2); assert.equal(r.currentAndUpcomingStays, 1);
  assert.equal(r.stays[0].canonicalId, uid(1)); assert.equal(r.stays[0].timings[0].at, '2026-11-07T18:20:22.123Z');
  assert.equal(r.readyForAutomaticMessaging, false); assert.equal(r.guestyQueueVerified, false);
  assert.equal(r.templateParityVerified, false); assert.equal(r.jobsCreated + r.messagesSent, 0);
  for (const secret of ['PRIVATE', 'SYNTHETIC-CODE', 'synthetic-token', GUESTY_ACCOUNT, GUESTY_CALDERWOOD])
    assert.equal(JSON.stringify(r).includes(secret), false);
});
test('missing overrides remain unknown through real orchestration, without blocking other known times', async () => {
  const f = fixture(); const read = f.deps.fetcher;
  f.deps.fetcher = async (url, init) => {
    const response = await read(url, init);
    if (String(url).includes('/reservations/')) { const d = await response.json(); delete d.plannedArrival; return Response.json(d); }
    return response;
  };
  const r = await reviewMessagePreparation(env, f.deps);
  assert.equal(r.stays[0].timings.find(t => t.key === 'checkin_day')?.status, 'unverified');
});
test('source changes in status, dates, account, listing or confirmation code cannot pass', async () => {
  for (const patch of [{ status: 'cancelled' }, { checkOutDateLocalized: '2026-11-29' }, { accountId: id(8) },
    { listingId: id(8) }, { confirmationCode: 'DIFFERENT' }]) {
    const f = fixture(); f.deps.fetcher = async () => Response.json({ ...detail, ...patch });
    await assert.rejects(reviewMessagePreparation(env, f.deps), /SOURCE_READ_FAILED/);
  }
});
test('V3 exact stay identity and duplicate/omitted results are checked', async () => {
  for (const data of [[], [v3, v3], [{ ...v3, _id: id(2) }], [{ ...v3, status: 'cancelled' }],
    [{ ...v3, stay: [{ ...v3.stay[0], unitId: id(8) }] }]]) {
    const f = fixture(); const read = f.deps.fetcher;
    f.deps.fetcher = (url, init) => String(url).includes('reservations-v3') ? Promise.resolve(Response.json(data)) : read(url, init);
    await assert.rejects(reviewMessagePreparation(env, f.deps), /SOURCE_READ_FAILED/);
  }
});
test('clock drift between two source scans discards the report', async () => {
  const f = fixture(); const read = f.deps.fetcher; let localReads = 0;
  f.deps.fetcher = async (url, init) => {
    const response = await read(url, init);
    return String(url).includes('/reservations/') && ++localReads === 2 ? Response.json({ ...detail, plannedArrival: '18:00' }) : response;
  };
  await assert.rejects(reviewMessagePreparation(env, f.deps), /SOURCES_CHANGED/);
});
test('changed template content invalidates the review even with unchanged rule identifiers', async () => {
  const f = fixture(); const read = f.deps.context; let reads = 0;
  f.deps.context = async () => { const c = await read(); if (++reads === 2) c.rules[0].body = 'Changed'; return c; };
  await assert.rejects(reviewMessagePreparation(env, f.deps), /SOURCES_CHANGED/);
});
test('changed render data discards the review and its private comparison digest never leaves the server', async () => {
  const f = fixture(); const read = f.deps.context; let reads = 0;
  f.deps.context = async () => { const c = await read(); if (++reads === 2) c.renderInputs.bookings[0].guest_name = 'CHANGED'; return c; };
  await assert.rejects(reviewMessagePreparation(env, f.deps), /SOURCES_CHANGED/);
  const clean = await reviewMessagePreparation(env, fixture().deps);
  assert.equal(clean.format, 3);
  assert.equal('privateRenderRevision' in clean, false); assert.equal('renderInputs' in clean, false);
});

test('recipient rotation during the double review discards the entire rehearsal without exposing the token', async () => {
  const f = fixture(), read = f.deps.context; let reads = 0;
  f.deps.context = async () => {
    const c = await read();
    c.renderInputs.cleanerRecipients = [{ enabled: true, property_ids: ['65_calderwood'], region: 'bridgeport_ct',
      ...{ phone: '+12025550100', portal_token: (++reads === 1 ? 'a' : 'b').repeat(32), language: 'en' } }];
    return c;
  };
  await assert.rejects(reviewMessagePreparation(env, f.deps), /SOURCES_CHANGED/);
});
test('environment and dormant boundaries are checked before token and network access', async () => {
  const f = fixture(); let tokens = 0; f.deps.token = async () => { tokens++; return 'synthetic-token'; };
  await assert.rejects(reviewMessagePreparation({ ...env, VERCEL_ENV: 'preview' }, f.deps));
  f.deps.verifyDormant = async () => { throw Error('not dormant'); };
  await assert.rejects(reviewMessagePreparation(env, f.deps));
  assert.equal(tokens + f.calls.length, 0);
});
test('enabled home automation and ambiguous mirror matches stop before provider access', async () => {
  for (const enabled of [true, false]) {
    const f = fixture(), read = f.deps.context;
    f.deps.context = async () => { const c = await read(); c.automationsEnabled = enabled;
      if (!enabled) c.mirror.push({ ...mirror[0], guesty_reservation_id: id(2) }); return c; };
    await assert.rejects(reviewMessagePreparation(env, f.deps)); assert.equal(f.calls.length, 0);
  }
});
test('empty scope has no provider calls and never implies readiness', async () => {
  const f = fixture(), read = f.deps.context;
  f.deps.context = async () => { const c = await read(); c.canonical.rows = []; return c; };
  const r = await reviewMessagePreparation(env, f.deps);
  assert.equal(f.calls.length, 0); assert.equal(r.currentAndUpcomingStays, 0); assert.equal(r.readyForAutomaticMessaging, false);
});
test('non-200, redirects, malformed JSON and oversized bodies are sanitized', async () => {
  for (const response of [new Response('PRIVATE', { status: 429 }), new Response('PRIVATE', { status: 302 }),
    new Response('PRIVATE'), new Response('x'.repeat(100001))]) {
    const f = fixture(); f.deps.fetcher = async () => response;
    await assert.rejects(reviewMessagePreparation(env, f.deps), e => e instanceof Error && e.message === 'SOURCE_READ_FAILED');
  }
});
test('time limit is checked across context reads, not just individual requests', async () => {
  const f = fixture(); let time = now; f.deps.clock = () => time;
  const read = f.deps.context; f.deps.context = async () => { const c = await read(); time += 81000; return c; };
  await assert.rejects(reviewMessagePreparation(env, f.deps), /READ_LIMIT_REACHED/); assert.equal(f.calls.length, 0);
});
test('the maximum 12-stay review splits V3 batches at ten and stays within 28 GETs', async () => {
  const f = fixture(), source = f.deps.context;
  f.deps.context = async () => {
    const c = await source();
    c.canonical.rows = Array.from({ length: 12 }, (_, i) => ({ ...canonical.rows[0], id: uid(i + 1), code: `SYNTH-${i + 1}` }));
    c.mirror = Array.from({ length: 12 }, (_, i) => ({ ...mirror[0], guesty_reservation_id: id(i + 1), confirmation_code: `SYNTH-${i + 1}` }));
    c.renderInputs.bookings = Array.from({ length: 12 }, (_, i) => ({ ...c.renderInputs.bookings[0], id: uid(i + 1) }));
    return c;
  };
  const batches: number[] = []; let requests = 0;
  f.deps.fetcher = async (url, init) => {
    assert.equal(init?.method, 'GET'); requests++; const u = new URL(String(url));
    if (u.pathname.endsWith('reservations-v3')) {
      const ids = u.searchParams.getAll('reservationIds[]'); batches.push(ids.length);
      return Response.json(ids.map(_id => ({ ...v3, _id })));
    }
    const _id = u.pathname.split('/').at(-1)!;
    return Response.json({ ...detail, _id, confirmationCode: `SYNTH-${parseInt(_id, 16)}` });
  };
  const r = await reviewMessagePreparation(env, f.deps);
  assert.equal(r.currentAndUpcomingStays, 12); assert.equal(requests, 28); assert.deepEqual(batches, [10, 2, 10, 2]);
});
test('larger scope, invalid tokens and mid-review midnight never produce a partial report', async () => {
  const large = fixture(), source = large.deps.context;
  large.deps.context = async () => { const c = await source(); c.canonical.rows = Array.from({ length: 13 }, (_, i) => ({ ...canonical.rows[0], id: uid(i + 1) })); return c; };
  await assert.rejects(reviewMessagePreparation(env, large.deps)); assert.equal(large.calls.length, 0);
  const invalid = fixture(); invalid.deps.token = async () => 'PRIVATE\ninvalid';
  await assert.rejects(reviewMessagePreparation(env, invalid.deps), /SOURCE_READ_FAILED/); assert.equal(invalid.calls.length, 0);
  const midnight = fixture(); let reads = 0;
  midnight.deps.clock = () => Date.parse(++reads === 1 ? '2026-11-08T04:59:59Z' : '2026-11-08T05:00:01Z');
  await assert.rejects(reviewMessagePreparation(env, midnight.deps), /READ_LIMIT_REACHED/);
});


test('cleaner scope changes during a review invalidate the entire result', async () => {
  const f = fixture(), read = f.deps.context; let reads = 0;
  f.deps.context = async () => {
    const c = await read();
    if (++reads === 2) c.renderInputs.cleanerRecipients.push({ enabled: true, property_ids: ['65_calderwood'], region: 'bridgeport_ct' });
    return c;
  };
  await assert.rejects(reviewMessagePreparation(env, f.deps), /SOURCES_CHANGED/);
});
