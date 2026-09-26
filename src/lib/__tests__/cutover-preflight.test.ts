/**
 * The cutover preflight: eight checks over loaded facts, pure.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCutoverPreflight,
  isOtaFeedChannel,
  latestPullFor,
  NO_ACKNOWLEDGEMENTS,
  type CutoverCheckKey,
  type CutoverFacts,
  type CutoverFeedFact,
} from '../cutover.ts';

const NOW = new Date('2026-10-01T15:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const feed = (channel: string, patch: Partial<CutoverFeedFact> = {}): CutoverFeedFact => ({
  id: `${channel}-row`,
  channel,
  is_active: true,
  ical_import_url: `https://${channel}.example/ical.ics`,
  last_import_status: 'success',
  last_imported_at: hoursAgo(0.5),
  last_import_error: null,
  export_subscribed: true,
  export_subscribed_at: hoursAgo(20),
  ...patch,
});

/** Every check green, both boxes ticked. Tests knock one thing out at a time. */
function greenFacts(patch: Partial<CutoverFacts> = {}): CutoverFacts {
  return {
    propertyId: '65_calderwood',
    propertyName: '65 Calderwood',
    region: 'bridgeport_ct',
    calendarAuthority: 'guesty',
    guestyListingId: '68aef2c1',
    formerGuestyListingId: null,
    automationsEnabled: false,
    ratePlan: { base_nightly_cents: 35000, min_nights_default: 3 },
    taxConfig: { jurisdiction: 'CT', rate: 0.15 },
    feeds: [feed('airbnb'), feed('vrbo'), feed('booking_com'), feed('direct', { ical_import_url: null, export_subscribed: false })],
    pulls: [
      { channel_guess: 'airbnb', pulled_at: hoursAgo(2) },
      { channel_guess: 'vrbo', pulled_at: hoursAgo(5) },
      { channel_guess: 'booking_com', pulled_at: hoursAgo(9) },
    ],
    bookings: [
      { id: 'a', property_id: '65_calderwood', status: 'confirmed', check_in: '2026-10-10', check_out: '2026-10-14' },
      { id: 'b', property_id: '65_calderwood', status: 'confirmed', check_in: '2026-10-14', check_out: '2026-10-18' },
      { id: 'blk', property_id: '65_calderwood', status: 'block', check_in: '2026-10-12', check_out: '2026-10-13' },
    ],
    recipients: [
      { display_name: 'Rosa', enabled: true, property_ids: [], region: 'cape_ann' },
      { display_name: 'Luana', enabled: true, property_ids: ['65_calderwood'], region: 'bridgeport_ct' },
    ],
    automations: { fleet_rules: 4, property_rules: 1, enabled_rules: 0, configured_in_ota: 2 },
    acknowledgements: { automations_reviewed: true, guesty_disconnect: true },
    now: NOW,
    ...patch,
  };
}

function failing(facts: CutoverFacts): CutoverCheckKey[] {
  return evaluateCutoverPreflight(facts).failing;
}

describe('evaluateCutoverPreflight', () => {
  test('all green when every fact is in order', () => {
    const r = evaluateCutoverPreflight(greenFacts());
    assert.equal(r.ok, true);
    assert.equal(r.dataOk, true);
    assert.deepEqual(r.failing, []);
    assert.equal(r.checks.length, 8);
    assert.deepEqual(
      r.checks.map((c) => c.key),
      [
        'rate_plan',
        'tax_config',
        'feeds_fresh',
        'export_subscribed',
        'no_double_bookings',
        'cleaner_recipient',
        'automations_reviewed',
        'guesty_disconnect_acknowledged',
      ],
    );
    assert.equal(r.checks.filter((c) => c.acknowledgement).length, 2);
  });

  test('no rate plan, or a zero base rate, is red', () => {
    assert.deepEqual(failing(greenFacts({ ratePlan: null })), ['rate_plan']);
    assert.deepEqual(failing(greenFacts({ ratePlan: { base_nightly_cents: 0, min_nights_default: 2 } })), ['rate_plan']);
  });

  test('tax config: a Cape Ann home may fall back to the MA table, any other region may not', () => {
    assert.deepEqual(failing(greenFacts({ taxConfig: null, region: 'cape_ann' })), []);
    const ct = evaluateCutoverPreflight(greenFacts({ taxConfig: null, region: 'bridgeport_ct' }));
    assert.deepEqual(ct.failing, ['tax_config']);
    assert.match(ct.checks[1].detail, /bridgeport_ct/);
  });

  test('feeds: a missing URL, a failed import or a success older than 2h each turn the check red and name the channel', () => {
    const noUrl = evaluateCutoverPreflight(greenFacts({ feeds: [feed('airbnb', { ical_import_url: null }), feed('vrbo')] }));
    assert.ok(noUrl.failing.includes('feeds_fresh'));
    assert.match(noUrl.checks[2].detail, /Airbnb: no iCal URL/);

    const errored = evaluateCutoverPreflight(
      greenFacts({ feeds: [feed('airbnb'), feed('vrbo', { last_import_status: 'error', last_import_error: 'HTTP 403' })] }),
    );
    assert.match(errored.checks[2].detail, /VRBO: last import error \(HTTP 403\)/);

    const old = evaluateCutoverPreflight(greenFacts({ feeds: [feed('airbnb', { last_imported_at: hoursAgo(3) }), feed('vrbo')] }));
    assert.match(old.checks[2].detail, /Airbnb: last success 3h ago, older than 2h/);

    // A retired row does not count.
    const retired = evaluateCutoverPreflight(greenFacts({ feeds: [feed('airbnb'), feed('vrbo', { is_active: false, ical_import_url: null })] }));
    assert.equal(retired.checks[2].ok, true);
  });

  test('no OTA feed rows at all is red: a Guesty-free OTA home must have its feeds wired', () => {
    const r = evaluateCutoverPreflight(greenFacts({ feeds: [feed('direct', { ical_import_url: null })], pulls: [] }));
    assert.ok(r.failing.includes('feeds_fresh'));
    assert.ok(r.failing.includes('export_subscribed'));
  });

  test('the direct pseudo-channel and the Guesty aggregate row are never OTA feeds', () => {
    assert.equal(isOtaFeedChannel('airbnb'), true);
    assert.equal(isOtaFeedChannel('booking_com'), true);
    assert.equal(isOtaFeedChannel('direct'), false);
    assert.equal(isOtaFeedChannel('guesty'), false);
    assert.equal(isOtaFeedChannel('block'), false);
  });

  test('export: every OTA row must be ticked subscribed AND have pulled within 24h, matched by channel', () => {
    const unticked = evaluateCutoverPreflight(greenFacts({ feeds: [feed('airbnb', { export_subscribed: false }), feed('vrbo')] }));
    assert.deepEqual(unticked.failing, ['export_subscribed']);
    assert.match(unticked.checks[3].detail, /Airbnb: export not ticked/);

    const neverPulled = evaluateCutoverPreflight(
      greenFacts({ pulls: [{ channel_guess: 'airbnb', pulled_at: hoursAgo(1) }, { channel_guess: 'booking_com', pulled_at: hoursAgo(1) }] }),
    );
    assert.match(neverPulled.checks[3].detail, /VRBO: never pulled/);

    const stalePull = evaluateCutoverPreflight(
      greenFacts({
        pulls: [
          { channel_guess: 'airbnb', pulled_at: hoursAgo(30) },
          { channel_guess: 'vrbo', pulled_at: hoursAgo(1) },
          { channel_guess: 'booking_com', pulled_at: hoursAgo(1) },
        ],
      }),
    );
    assert.match(stalePull.checks[3].detail, /Airbnb: last pull 30h ago, older than 24h/);

    // A pull with no channel guess is not evidence for any particular OTA.
    const anon = evaluateCutoverPreflight(
      greenFacts({
        feeds: [feed('airbnb')],
        pulls: [{ channel_guess: null, pulled_at: hoursAgo(1) }],
      }),
    );
    assert.ok(anon.failing.includes('export_subscribed'));
    assert.equal(latestPullFor([{ channel_guess: null, pulled_at: hoursAgo(1) }], 'airbnb'), null);
  });

  test('two stays sharing a night is red; a block over a stay and a same-day turnover are not', () => {
    const r = evaluateCutoverPreflight(
      greenFacts({
        bookings: [
          { id: 'a', property_id: '65_calderwood', status: 'confirmed', check_in: '2026-10-10', check_out: '2026-10-14' },
          { id: 'c', property_id: '65_calderwood', status: 'confirmed', check_in: '2026-10-13', check_out: '2026-10-15' },
        ],
      }),
    );
    assert.deepEqual(r.failing, ['no_double_bookings']);
    assert.match(r.checks[4].detail, /2026-10-10 to 2026-10-14 overlaps 2026-10-13 to 2026-10-15 \(1 night\)/);
    // Another property's overlap is not this home's problem.
    const other = evaluateCutoverPreflight(
      greenFacts({
        bookings: [
          { id: 'x', property_id: '21_horton', status: 'confirmed', check_in: '2026-10-10', check_out: '2026-10-14' },
          { id: 'y', property_id: '21_horton', status: 'confirmed', check_in: '2026-10-12', check_out: '2026-10-15' },
        ],
      }),
    );
    assert.equal(other.checks[4].ok, true);
  });

  test('cleaner recipient: by explicit property id, or by region with an empty property list; disabled rows do not count', () => {
    // Rosa's '{}' is Cape Ann; Calderwood is Bridgeport, so only Luana covers it.
    const onlyRosa = evaluateCutoverPreflight(
      greenFacts({ recipients: [{ display_name: 'Rosa', enabled: true, property_ids: [], region: 'cape_ann' }] }),
    );
    assert.deepEqual(onlyRosa.failing, ['cleaner_recipient']);

    const regionWide = evaluateCutoverPreflight(
      greenFacts({ recipients: [{ display_name: 'Luana', enabled: true, property_ids: [], region: 'bridgeport_ct' }] }),
    );
    assert.equal(regionWide.checks[5].ok, true);
    assert.match(regionWide.checks[5].detail, /Luana receives/);

    const disabled = evaluateCutoverPreflight(
      greenFacts({ recipients: [{ display_name: 'Luana', enabled: false, property_ids: ['65_calderwood'], region: 'bridgeport_ct' }] }),
    );
    assert.deepEqual(disabled.failing, ['cleaner_recipient']);

    // A Cape Ann home is covered by Rosa's fleet-wide row.
    const capeAnn = evaluateCutoverPreflight(
      greenFacts({
        propertyId: '21_horton',
        region: 'cape_ann',
        bookings: [],
        recipients: [{ display_name: 'Rosa', enabled: true, property_ids: [], region: 'cape_ann' }],
      }),
    );
    assert.equal(capeAnn.checks[5].ok, true);
  });

  test('the two acknowledgements are red until ticked, and the data checks are reported separately', () => {
    const r = evaluateCutoverPreflight(greenFacts({ acknowledgements: NO_ACKNOWLEDGEMENTS }));
    assert.equal(r.ok, false);
    assert.equal(r.dataOk, true);
    assert.deepEqual(r.failing, ['automations_reviewed', 'guesty_disconnect_acknowledged']);
    assert.match(r.checks[6].detail, /4 fleet rules, 1 override for this home, 0 enabled, 2 marked configured in the OTA/);
    assert.match(r.checks[7].detail, /Guesty listing 68aef2c1 is still mapped/);

    const half = evaluateCutoverPreflight(greenFacts({ acknowledgements: { automations_reviewed: true, guesty_disconnect: false } }));
    assert.deepEqual(half.failing, ['guesty_disconnect_acknowledged']);
  });

  test('an active Guesty aggregate row is named in the disconnect check and never counted as an OTA feed', () => {
    const r = evaluateCutoverPreflight(
      greenFacts({ feeds: [feed('airbnb'), feed('vrbo'), feed('booking_com'), feed('guesty', { export_subscribed: false })] }),
    );
    assert.equal(r.ok, true);
    assert.match(r.checks[7].detail, /Guesty aggregate feed row is retired by the flip/);
  });
});
