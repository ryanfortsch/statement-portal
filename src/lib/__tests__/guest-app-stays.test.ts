/**
 * The guest app's stay links (/h/s/<token>, phase 2).
 *
 * A stay link shows one stay's door code, so the rules that matter are:
 * the stay layer exists only inside its window and expires at checkout;
 * the digits never reach the page's data (only the reveal POST hands them
 * out); and the permanent home page (phase 1) is untouched. Several tests
 * read the source, because those guarantees live in what each file imports
 * and selects, and a later convenience edit would break them without
 * failing anything else.
 *
 * Run: npm test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  appForStay,
  buildStayLayer,
  codeIsLive,
  codeState,
  easternMoment,
  opensLine,
  parseLinkRequest,
  joinNotice,
  parseJoinEmail,
  stayMatchesReservation,
  stayMayAskEmail,
  stayPhase,
  stayWindow,
  STAY_JOIN_MAX,
  STAY_TOKEN_LENGTH,
  STAY_TOKEN_RE,
  stayTokenFrom,
  type LiveStayCode,
  type StayLayerInput,
  type StayWindow,
} from '../guest-app-stays.ts';
import { buildGuestApp, type GuestAppHome } from '../guest-app.ts';
import { buildMergeContext, renderTemplate, SECRET_FIELDS, MASK, MERGE_FIELDS } from '../automations-core.ts';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

// A Friday-to-Sunday stay in November (Eastern standard time, UTC-5).
const DATES = { checkIn: '2026-11-13', checkOut: '2026-11-15' };
const TIMES = { checkInTime: '16:00', checkOutTime: '10:00' };
const CODE = '4821';

function win(): StayWindow {
  const w = stayWindow(DATES, TIMES);
  assert.ok(w);
  return w!;
}

function home(over: Partial<GuestAppHome> = {}): GuestAppHome {
  return {
    id: 'test_house',
    name: '12 Test',
    title: 'Stay by the Harbor',
    address: '12 Test Street',
    city: 'Gloucester',
    region: 'cape_ann',
    kind: 'managed',
    latitude: 42.6159,
    longitude: -70.662,
    guesty_listing_id: null,
    former_guesty_listing_id: null,
    bedrooms: 3,
    bathrooms: 2,
    max_occupancy: 6,
    parking: 'Two cars in the driveway',
    parking_regulations: null,
    trash_day: 'Tuesday',
    recycling_day: null,
    trash_notes: null,
    carts_handled_by_us: false,
    heating: null,
    cooling: null,
    thermostat_brand: null,
    internet_provider: null,
    smart_tv: null,
    wifi_name: 'Harbor Net',
    wifi_label: null,
    wifi_name_2: null,
    wifi_label_2: null,
    has_pack_n_play: false,
    has_high_chair: false,
    has_pullout_bed: false,
    pullout_linens_location: null,
    quiet_hours: null,
    pet_policy: null,
    smoking_policy: null,
    house_rules: null,
    default_checkout_time: '10:00',
    smart_lock_brand: 'Schlage',
    fire_extinguisher_locations: null,
    smoke_detector_locations: null,
    fire_exit_locations: null,
    water_shutoff_location: null,
    gas_shutoff_location: null,
    oil_shutoff_location: null,
    electrical_panel_location: null,
    home_guide_overrides: null,
    ...over,
  };
}

const NOW_OPEN = new Date('2026-11-13T20:00:00Z'); // Friday 3 PM Eastern
const app = buildGuestApp({
  home: home(),
  wifi: { password: 'synthetic-wifi-pass', password2: null },
  rooms: [],
  notes: [],
  checkInTime: '16:00',
  heroPhotoUrl: null,
  nearby: [],
  bookAgainUrl: null,
  welcomeNote: null,
  now: NOW_OPEN,
});

function live(over: Partial<LiveStayCode> = {}): LiveStayCode {
  return {
    code: CODE,
    // How guest-locks.ts issues it: midnight on check-in day to 11 AM checkout day.
    starts_at: '2026-11-13T05:00:00Z',
    ends_at: '2026-11-15T16:00:00Z',
    doorCount: 1,
    ...over,
  };
}

function layerInput(now: Date, over: Partial<StayLayerInput> = {}): StayLayerInput {
  const window = win();
  return {
    dates: DATES,
    times: TIMES,
    window,
    app,
    lockBrand: 'Schlage',
    lockMapped: true,
    code: codeState(live(), now, window),
    now,
    ...over,
  };
}

describe('the window: 10 AM Eastern the day before check-in to checkout', () => {
  test('opens when the arrival message texts the code, closes at the guest checkout', () => {
    const w = win();
    assert.equal(w.opensAt.toISOString(), '2026-11-12T15:00:00.000Z'); // Thu 10:00 AM EST
    assert.equal(w.closesAt.toISOString(), '2026-11-15T15:00:00.000Z'); // Sun 10:00 AM EST
    assert.equal(opensLine(w), 'Your arrival steps and door code appear here at 10:00 AM on Thursday, November 12.');
  });

  test('daylight time is Eastern too', () => {
    const w = stayWindow({ checkIn: '2026-07-10', checkOut: '2026-07-12' }, { checkInTime: '16:00', checkOutTime: '11:00' });
    assert.equal(w?.opensAt.toISOString(), '2026-07-09T14:00:00.000Z');
    assert.equal(w?.closesAt.toISOString(), '2026-07-12T15:00:00.000Z');
  });

  test('a paid late checkout or a moved day moves the close; no checkout reads as 11', () => {
    const late = stayWindow(DATES, { ...TIMES, adjustedCheckOutTime: '13:00' });
    assert.equal(late?.closesAt.toISOString(), '2026-11-15T18:00:00.000Z');
    const moved = stayWindow(DATES, { ...TIMES, adjustedCheckOut: '2026-11-16' });
    assert.equal(moved?.leaveDay, '2026-11-16');
    assert.equal(moved?.closesAt.toISOString(), '2026-11-16T15:00:00.000Z');
    const none = stayWindow(DATES, { checkInTime: null, checkOutTime: null });
    assert.equal(none?.closesAt.toISOString(), '2026-11-15T16:00:00.000Z');
  });

  test('unreadable dates never open', () => {
    assert.equal(stayWindow({ checkIn: 'soon', checkOut: '2026-11-15' }, TIMES), null);
    assert.equal(stayWindow({ checkIn: '2026-11-15', checkOut: '2026-11-15' }, TIMES), null);
    assert.equal(stayWindow({ checkIn: '2026-11-16', checkOut: '2026-11-15' }, TIMES), null);
  });

  test('before, open, over: the edges', () => {
    const w = win();
    const at = (ms: number) => stayPhase(new Date(ms), w);
    assert.equal(at(w.opensAt.getTime() - 1), 'before');
    assert.equal(at(w.opensAt.getTime()), 'open');
    assert.equal(at(w.closesAt.getTime() - 1), 'open');
    assert.equal(at(w.closesAt.getTime()), 'over');
    assert.equal(at(Date.parse('2027-01-01T00:00:00Z')), 'over');
  });
});

describe('the stay layer never renders outside its window', () => {
  test('null before it opens and from checkout on; present inside', () => {
    const w = win();
    for (const ms of [Date.parse('2026-11-01T12:00:00Z'), w.opensAt.getTime() - 1, w.closesAt.getTime(), Date.parse('2026-11-20T12:00:00Z')]) {
      assert.equal(buildStayLayer(layerInput(new Date(ms))), null, new Date(ms).toISOString());
    }
    assert.ok(buildStayLayer(layerInput(w.opensAt)));
    assert.ok(buildStayLayer(layerInput(new Date(w.closesAt.getTime() - 1))));
  });

  test('inside: dates, the door step and the close, in the guest\'s words', () => {
    const stay = buildStayLayer(layerInput(NOW_OPEN));
    assert.ok(stay);
    assert.equal(stay!.arriveDay, 'Friday, November 13');
    assert.equal(stay!.arriveTime, '4:00 PM');
    assert.equal(stay!.leaveDay, 'Sunday, November 15');
    assert.equal(stay!.leaveTime, '10:00 AM');
    assert.equal(stay!.nights, 2);
    assert.equal(stay!.code?.available, true);
    const door = stay!.steps.find((s) => s.label === 'The door');
    assert.match(door?.text ?? '', /Show my door code above, then enter it on the Schlage keypad\./);
    assert.ok(stay!.steps.some((s) => s.label === 'Parking'));
    assert.ok(stay!.steps.some((s) => s.label === 'Address'));
    assert.match(stay!.until, /works until 10:00 AM on Sunday, November 15\./);
  });

  test('no Seam lock, or no live code: the code is promised in the check-in message', () => {
    const noLock = buildStayLayer(layerInput(NOW_OPEN, { lockMapped: false }));
    assert.equal(noLock?.code, null);
    assert.match(noLock?.steps.find((s) => s.label === 'The door')?.text ?? '', /comes in your check-in message/);
    const noCode = buildStayLayer(layerInput(NOW_OPEN, { code: codeState(null, NOW_OPEN, win()) }));
    assert.equal(noCode?.code?.available, false);
    assert.match(noCode?.steps.find((s) => s.label === 'The door')?.text ?? '', /comes in your check-in message/);
  });
});

describe('the digits never reach the page', () => {
  test('codeState keeps when the code works and drops the digits', () => {
    const before = new Date('2026-11-12T18:00:00Z'); // Thursday afternoon, window open, code not yet live on the lock
    const state = codeState(live(), before, win());
    assert.equal(state.available, true);
    assert.equal(state.worksFrom, '12:00 AM on Friday, November 13');
    assert.equal(state.worksUntil, '11:00 AM on Sunday, November 15');
    assert.ok(!JSON.stringify(state).includes(CODE));
    assert.deepEqual(Object.keys(state).sort(), ['available', 'doorCount', 'worksFrom', 'worksUntil']);
  });

  test('the stay layer and the stay\'s app carry no digits', () => {
    const stay = buildStayLayer(layerInput(NOW_OPEN, { code: codeState(live({ code: '907315' }), NOW_OPEN, win()) }));
    assert.ok(stay);
    const out = JSON.stringify({ stay, app: appForStay(app, stay) });
    assert.ok(!out.includes('907315'));
    assert.match(out, /Your door code is under Your stay, at the top of this page\./);
  });

  test('an ended code, a code for other dates or a malformed one is not live', () => {
    const w = win();
    assert.equal(codeIsLive(live({ ends_at: '2026-11-13T19:00:00Z' }), NOW_OPEN, w), false);
    assert.equal(codeIsLive(live({ starts_at: '2026-11-20T05:00:00Z', ends_at: '2026-11-22T16:00:00Z' }), NOW_OPEN, w), false);
    assert.equal(codeIsLive(live({ code: '12' }), NOW_OPEN, w), false);
    assert.equal(codeIsLive(live({ code: '12ab' }), NOW_OPEN, w), false);
    assert.equal(codeIsLive(live({ starts_at: null, ends_at: null }), NOW_OPEN, w), true);
    assert.equal(codeState(live({ ends_at: '2026-11-13T19:00:00Z' }), NOW_OPEN, w).available, false);
  });

  test('two doors with one code say so', () => {
    const stay = buildStayLayer(layerInput(NOW_OPEN, { code: codeState(live({ doorCount: 2 }), NOW_OPEN, win()) }));
    assert.match(stay?.steps.find((s) => s.label === 'The door')?.text ?? '', /works on every keypad/);
  });

  test('only the reveal route reads the digits; the page and its card cannot', () => {
    for (const f of ['src/app/h/s/[stay]/page.tsx', 'src/app/h/s/[stay]/StayCard.tsx', 'src/lib/guest-app-stays.ts']) {
      const src = read(f);
      // Imports and calls, not prose: the docs name these on purpose.
      for (const banned of ['revealStayCode(', 'getLiveStayCode(', "guest-locks'", "property-access'"]) {
        assert.ok(!src.includes(banned), `${f} must not use ${banned}`);
      }
    }
    const route = read('src/app/h/s/[stay]/code/route.ts');
    assert.match(route, /export async function POST\(/);
    assert.ok(!/export (async )?function (GET|HEAD)\b/.test(route), 'the reveal answers POST only');
    assert.match(route, /revealStayCode\(token\)/);
    assert.match(route, /'Cache-Control': 'no-store, max-age=0'/);

    const card = read('src/app/h/s/[stay]/StayCard.tsx');
    assert.match(card, /fetch\(`\/h\/s\/\$\{token\}\/code`, \{ method: 'POST'/);
  });

  test('the loader turns the code into a state before the page sees it', () => {
    const db = read('src/lib/guest-app-stays-db.ts');
    const load = db.slice(db.indexOf('export async function loadGuestStay'), db.indexOf('export type StayCodeReveal'));
    assert.match(load, /code: codeState\(live, now, stay\.window\)/);
    assert.ok(!/\blive\.code\b/.test(load), 'loadGuestStay must not touch the digits');
    // Digits leave this module in one place.
    assert.equal(db.match(/live\.code/g)?.length, 1);
    assert.match(db.slice(db.indexOf('export async function revealStayCode')), /code: live\.code/);
    // The reveal re-checks the window at the tap.
    assert.match(db.slice(db.indexOf('export async function revealStayCode')), /stayPhase\(now, stay\.window\) !== 'open'/);
  });

  test('the code is the stay\'s Seam code, never the standing house code', () => {
    const db = read('src/lib/guest-app-stays-db.ts');
    for (const banned of ['property-access', "from('property_access')", 'smart_lock_code', 'getPropertyAccess', 'readMessageAccess', ".select('*')"]) {
      assert.ok(!db.includes(banned), `guest-app-stays-db.ts must not use ${banned}`);
    }
    const locks = read('src/lib/guest-locks.ts');
    const fn = locks.slice(locks.indexOf('export async function getLiveStayCode'), locks.indexOf('/** Short code valid now'));
    assert.match(fn, /\.from\('guest_access_codes'\)/);
    assert.match(fn, /\.is\('removed_at', null\)/);
    assert.match(fn, /\.in\('booking_id', ids\)/);
    assert.match(fn, /mapped\.has\(r\.device_id\)/);
    assert.ok(!fn.includes('property_access') && !fn.includes('smart_lock_code'));
  });
});

describe('phase 1 stays as it was', () => {
  test('the permanent page and its loader know nothing of stays', () => {
    for (const f of ['src/lib/guest-app-db.ts', 'src/app/h/[token]/page.tsx', 'src/lib/guest-app.ts']) {
      const src = read(f);
      for (const banned of ['guest-app-stays', 'guest_app_stays', 'guest-locks', 'guest_access_codes']) {
        assert.ok(!src.includes(banned), `${f} must not reference ${banned}`);
      }
    }
  });

  test('a stay token is 16 characters from 62, and the 32-hex links already sent still work', () => {
    assert.ok(STAY_TOKEN_RE.test('Xq3vB7kP9mR2tL4w'), 'new: 16 base62');
    assert.ok(STAY_TOKEN_RE.test('0123456789abcdef0123456789abcdef'), 'sent before 2026-11-13: 32 hex');
    assert.ok(!STAY_TOKEN_RE.test('0123456789ABCDEF0123456789ABCDEF'), 'old shape is lowercase only');
    assert.ok(!STAY_TOKEN_RE.test('Xq3vB7kP9mR2tL4'), 'too short');
    assert.ok(!STAY_TOKEN_RE.test('Xq3vB7kP9mR2tL4wZ'), 'too long');
    assert.ok(!STAY_TOKEN_RE.test('Xq3vB7kP9mR2tL4-'), 'letters and digits only');
    const db = read('src/lib/guest-app-stays-db.ts');
    assert.match(db, /stayTokenFrom\(\(n\) => randomBytes\(n\)\)/, 'node:crypto, never Math.random');
    assert.match(db, /`\$\{guestAppOrigin\(\)\}\/s\/\$\{token\}`/, 'the short link');
  });

  test('a new token uses every character evenly and throws away bytes that would skew it', () => {
    // Bytes 248-255 are dropped: 256 is not a multiple of 62.
    const bytes = [248, 255, 0, 61, 62, 247, ...Array.from({ length: 26 }, (_, i) => i)];
    const t = stayTokenFrom(() => Uint8Array.from(bytes));
    assert.equal(t.length, STAY_TOKEN_LENGTH);
    assert.ok(STAY_TOKEN_RE.test(t));
    assert.equal(t.slice(0, 4), '0z0z', '0 -> 0, 61 -> z, 62 -> 0, 247 -> z (247 % 62 = 61)');
    // A source that hands out only rejected bytes at first still finishes.
    let calls = 0;
    const t2 = stayTokenFrom((n) => Uint8Array.from({ length: n }, (_, i) => (calls++ === 0 ? 250 : i % 62)));
    assert.equal(t2.length, STAY_TOKEN_LENGTH);
  });

  test('the short link redirects to the stay page on both hosts', () => {
    const config = read('next.config.ts');
    assert.match(config, /source: '\/s\/:token',\s*destination: '\/h\/s\/:token',/);
    const sql = read('supabase/migrations/20261113150000_guest_app_stays_short_tokens.sql');
    assert.match(sql, /check \(token ~ '\^\(\[A-Za-z0-9\]\{16\}\|\[a-f0-9\]\{32\}\)\$'\)/);
  });
});

describe('the stay link\'s table and offline copy', () => {
  test('service role only, one live link per stay, no dates or code stored', () => {
    const sql = read('supabase/migrations/20261111140000_guest_app_stays.sql');
    assert.match(sql, /alter table public\.guest_app_stays enable row level security/i);
    assert.match(sql, /revoke all on public\.guest_app_stays from anon, authenticated/i);
    assert.match(sql, /grant all on public\.guest_app_stays to service_role/i);
    assert.match(sql, /revoke all on function public\.guest_app_stay_seen\(text, boolean\) from public, anon, authenticated/i);
    assert.match(sql, /on public\.guest_app_stays \(booking_id\)\s+where revoked_at is null/i);
    assert.match(sql, /check \(token ~ '\^\[a-f0-9\]\{32\}\$'\)/);
    const table = sql.slice(sql.indexOf('create table'), sql.indexOf(');', sql.indexOf('create table')));
    for (const col of ['check_in', 'check_out', 'code text', 'starts_at', 'ends_at']) assert.ok(!table.includes(col), `${col} must not be stored`);
  });

  test('the service worker keeps stay pages and never touches a POST', () => {
    const sw = read('src/app/h/sw.js/route.ts');
    assert.match(sw, /if \(req\.method !== 'GET'\) return;/);
    assert.ok(sw.includes('(?:s\\\\/(?:[A-Za-z0-9]{16}|[a-f0-9]{32})|[a-f0-9]{16,64})'));
  });

  test('a stay page offers no install manifest (it would leak the home token)', () => {
    const page = read('src/app/h/s/[stay]/page.tsx');
    // Explicitly null: leaving the key out inherits Helm's own manifest from
    // the root layout, and Add to Home Screen would install Helm.
    assert.equal(page.match(/manifest:/g)?.length, 1);
    assert.match(page, /manifest: null,/);
    assert.match(page, /applicationName: name,/);
    assert.match(page, /appleWebApp: \{ capable: false, title: name \}/);
  });
});

describe('{{guest_app_link}}', () => {
  test('a merge field, filled from the stay link and masked in every stored copy', () => {
    assert.ok((MERGE_FIELDS as readonly string[]).includes('guest_app_link'));
    assert.ok(SECRET_FIELDS.has('guest_app_link'));
    const url = 'https://helm.example.test/h/s/0123456789abcdef0123456789abcdef';
    const ctx = buildMergeContext({
      booking: { guest_name: 'Pat Example', check_in: DATES.checkIn, check_out: DATES.checkOut },
      property: { name: '12 Test', title: 'Stay by the Harbor', address: '12 Test Street', wifi_name: null, parking: null },
      plan: { checkin_time: '16:00', checkout_time: '10:00' },
      adjustment: null,
      access: null,
      stayCode: null,
      lockMapped: false,
      trashDay: null,
      guestAppLink: url,
      now: new Date('2026-11-12T15:00:00Z'),
    });
    const r = renderTemplate('Your guide for the stay: {{guest_app_link}}', ctx);
    assert.equal(r.text, `Your guide for the stay: ${url}`);
    assert.equal(r.masked, `Your guide for the stay: ${MASK}`);
    assert.deepEqual(r.missing, []);
    const none = renderTemplate('{{guest_app_link}}', { ...ctx, guest_app_link: '' });
    assert.deepEqual(none.missing, ['guest_app_link']);
  });

  test('automations mint the stay link only when sending, never for a preview', () => {
    const src = read('src/lib/automations.ts');
    assert.match(src, /guestAppLinkForBooking\(booking\.id, booking\.property_id, 'automations', linkMode === 'mint'\)/);
    // The send and the OTA paste mint; the test text and the panel preview do not.
    assert.equal(src.match(/linkModeFor\(true,/g)?.length, 2);
    assert.equal(src.match(/linkModeFor\(false,/g)?.length, 2);
  });

  test('a failed mint still sends the home link, in automations and the bridge', () => {
    const db = read('src/lib/guest-app-stays-db.ts');
    for (const fn of ['guestAppLinkForReservation', 'guestAppLinkForBooking']) {
      const start = db.indexOf(`export async function ${fn}(`);
      assert.ok(start > 0, `${fn} exists`);
      const end = db.indexOf('\nexport ', start + 1);
      const body = db.slice(start, end < 0 ? undefined : end);
      assert.match(body, /await ensureStayLink\([^)]*\)\.catch\(/, `${fn} catches a failed mint`);
    }
  });

  test('kb-facts carries the home\'s permanent link and never a stay link', () => {
    const kb = read('src/app/api/kb-facts/route.ts');
    assert.match(kb, /\.from\('guest_app_homes'\)/);
    assert.match(kb, /guest_app_url:/);
    assert.ok(!kb.includes('guest_app_stays') && !kb.includes('guest-app-stays'));
  });

  test('the concierge bridge is header-guarded and returns no code', () => {
    const proxy = read('src/proxy.ts');
    assert.match(proxy, /"\/api\/guest-app-links",/);
    const route = read('src/app/api/guest-app-links/route.ts');
    const post = route.slice(route.indexOf('export async function POST'));
    assert.ok(post.indexOf('authorizeStayConcierge(req)') > 0 && post.indexOf('authorizeStayConcierge(req)') < post.indexOf('req.json()'));
    for (const banned of ['revealStayCode', 'getLiveStayCode', 'guest-locks', 'property-access', 'searchParams']) {
      assert.ok(!route.includes(banned), `the bridge must not use ${banned}`);
    }
  });
});

describe('which stay a reservation is', () => {
  const ical = { source: 'ical_import', external_booking_id: '65a1b2c3d4e5f60718293a4b', external_confirmation_code: 'HMABC123' };
  const guesty = { source: 'guesty_legacy', external_booking_id: '65a1b2c3d4e5f60718293a4b', external_confirmation_code: null };

  test('no ids asked, or none on file: the home and the dates decide', () => {
    assert.equal(stayMatchesReservation([guesty], {}), true);
    assert.equal(stayMatchesReservation([{ source: 'ical_import', external_booking_id: null, external_confirmation_code: null }], { reservationId: 'x1' }), true);
  });

  test('a matching reservation id or confirmation code is the stay', () => {
    assert.equal(stayMatchesReservation([guesty], { reservationId: '65a1b2c3d4e5f60718293a4b' }), true);
    assert.equal(stayMatchesReservation([ical], { confirmationCode: 'hmabc123' }), true);
  });

  test('a stay naming a different reservation is refused', () => {
    assert.equal(stayMatchesReservation([guesty], { reservationId: '75ffffffffffffffffffffff' }), false);
    assert.equal(stayMatchesReservation([ical, guesty], { confirmationCode: 'HMZZZ999' }), false);
  });

  test('an iCal row\'s pooled booking id vouches for nothing', () => {
    const pooled = { source: 'ical_import', external_booking_id: '75ffffffffffffffffffffff', external_confirmation_code: null };
    assert.equal(stayMatchesReservation([pooled], { reservationId: '75ffffffffffffffffffffff' }), true); // nothing native on file
    assert.equal(stayMatchesReservation([pooled, guesty], { reservationId: '75ffffffffffffffffffffff' }), false);
  });
});

describe('the bridge request', () => {
  test('a good body', () => {
    const r = parseLinkRequest({ property_id: '21_horton', check_in: '2026-11-13', check_out: '2026-11-15T00:00:00Z', reservation_id: '65a1b2c3d4e5f60718293a4b', extra: 1 });
    assert.ok(r.ok);
    if (r.ok) {
      assert.deepEqual(r.value, { property: '21_horton', checkIn: '2026-11-13', checkOut: '2026-11-15', reservationId: '65a1b2c3d4e5f60718293a4b', confirmationCode: null });
    }
    const byListing = parseLinkRequest({ listing_id: '695d5c8afb0a0500153d5d1c', check_in: '2026-11-13', check_out: '2026-11-15' });
    assert.ok(byListing.ok && byListing.value.property === '695d5c8afb0a0500153d5d1c');
  });

  test('bad bodies say what was wrong', () => {
    assert.deepEqual(parseLinkRequest(null), { ok: false, error: 'body' });
    assert.deepEqual(parseLinkRequest({ check_in: '2026-11-13', check_out: '2026-11-15' }), { ok: false, error: 'property_id' });
    assert.deepEqual(parseLinkRequest({ property_id: "x'; drop", check_in: '2026-11-13', check_out: '2026-11-15' }), { ok: false, error: 'property_id' });
    assert.deepEqual(parseLinkRequest({ property_id: 'x', check_in: '2026-11-15', check_out: '2026-11-13' }), { ok: false, error: 'dates' });
    assert.deepEqual(parseLinkRequest({ property_id: 'x', check_in: 'Friday', check_out: '2026-11-13' }), { ok: false, error: 'dates' });
  });
});

describe('the email line: direct bookings only', () => {
  test('a plainly direct stay may ask; anything an OTA touched may not', () => {
    assert.equal(stayMayAskEmail('direct', ['direct']), true);
    // The Guesty feed's copy, and the OTA calendars closing the same nights.
    assert.equal(stayMayAskEmail('direct', ['direct', 'direct', 'block']), true);
    for (const ota of ['airbnb', 'vrbo', 'booking_com']) {
      assert.equal(stayMayAskEmail(ota, [ota]), false, `${ota} must never ask`);
      assert.equal(stayMayAskEmail(ota, [ota, 'block']), false);
      // A direct canonical with an OTA twin is not plainly ours.
      assert.equal(stayMayAskEmail('direct', ['direct', ota]), false, `direct with a ${ota} twin must not ask`);
    }
    for (const unclear of ['manual', 'other', 'guesty', null]) {
      assert.equal(stayMayAskEmail(unclear, [unclear]), false, `${unclear} must not ask`);
      assert.equal(stayMayAskEmail('direct', ['direct', unclear]), false, `direct with a ${unclear} twin must not ask`);
    }
    // A block is never a stay of its own.
    assert.equal(stayMayAskEmail('block', ['block']), false);
  });

  test('the email is checked and lowercased; the notice reads only its own words', () => {
    assert.equal(parseJoinEmail('  Ann.Lee@Example.COM '), 'ann.lee@example.com');
    for (const bad of ['', 'ann', 'ann@', 'ann@example', 'a b@example.com', null, 42, `${'x'.repeat(320)}@example.com`]) {
      assert.equal(parseJoinEmail(bad), null, `${String(bad)} is not an email`);
    }
    for (const n of ['joined', 'invalid', 'full', 'failed'] as const) assert.equal(joinNotice(n), n);
    for (const n of ['closed', '<script>', '', undefined, ['joined']]) assert.equal(joinNotice(n), null);
    assert.ok(STAY_JOIN_MAX > 0 && STAY_JOIN_MAX <= 30);
  });

  test('the printed home link never asks for anything', () => {
    for (const f of ['src/app/h/[token]/page.tsx', 'src/app/h/[token]/GuestAppScreen.tsx', 'src/app/h/[token]/GuestAppBody.tsx', 'src/lib/guest-app-db.ts', 'src/lib/guest-app.ts']) {
      const src = read(f);
      for (const banned of ['<form', 'type="email"', "type='email'", '<StayJoin', "StayJoin'", "audience-subscribe'", "guest-app-join'", ".from('audience_"]) {
        assert.ok(!src.includes(banned), `${f} must not carry ${banned}`);
      }
    }
    // The permanent page passes no email line into the shared screen.
    assert.ok(!/\bjoin=\{/.test(read('src/app/h/[token]/page.tsx')));
  });

  test('the stay page shows it only when the loader says the stay may ask', () => {
    const page = read('src/app/h/s/[stay]/page.tsx');
    assert.match(page, /view\.join \? <StayJoin /);
    assert.equal(page.match(/<StayJoin /g)?.length, 1, 'one place renders the line, behind the gate');
    const db = read('src/lib/guest-app-stays-db.ts');
    assert.match(db, /mayAskEmail: stayMayAskEmail\(found\.canonical\.channel, found\.cluster\.map\(\(r\) => r\.channel\)\)/);
    assert.match(db, /const BOOKING_COLS = '[^']*\bchannel\b/);
    const load = db.slice(db.indexOf('export async function loadGuestStay'), db.indexOf('export async function resolveStayForJoin'));
    assert.match(load, /const join = stay\.mayAskEmail;/);
    assert.equal(load.match(/, join \}/g)?.length, 3, 'every page view carries the gate');
    // The line itself asks for an email and nothing else.
    const line = read('src/app/h/s/[stay]/StayJoin.tsx');
    assert.equal(line.match(/<input/g)?.length, 2, 'the email and the honeypot');
    assert.match(line, /name="email"/);
    assert.match(line, /action=\{`\/h\/s\/\$\{token\}\/join`\}/);
    for (const banned of ['name="phone"', 'type="tel"', 'name="first_name"', 'name="name"']) assert.ok(!line.includes(banned));
  });

  test('the write re-checks the stay before anything is stored', () => {
    const join = read('src/lib/guest-app-join.ts');
    const gate = join.indexOf('if (!stay || !stay.mayAskEmail) return');
    assert.ok(gate > 0, 'joinStayList refuses a stay that may not ask');
    assert.ok(gate < join.indexOf("from('audience_events')") && gate < join.indexOf('subscribeAudienceContact('), 'the gate comes before any read or write');
    assert.match(join, /resolveStayForJoin\(token\)/);
    assert.match(join, /if \(count >= STAY_JOIN_MAX\) return 'full';/);
    // One writer of a typed signup: the stay line and staycapeann.com share it.
    assert.match(join, /subscribeAudienceContact\(/);
    const sub = read('src/app/api/guests/subscribe/route.ts');
    assert.match(sub, /subscribeAudienceContact\(/);
    assert.ok(!sub.includes("from('audience_contacts')"), 'the public route writes through the shared writer');

    const route = read('src/app/h/s/[stay]/join/route.ts');
    assert.match(route, /export async function POST\(/);
    assert.ok(!/export (async )?function (GET|HEAD)\b/.test(route), 'the email line answers POST only');
    assert.match(route, /if \(!sameOrigin\(req\)\) return new Response\(null, \{ status: 403/);
    assert.match(route, /joinStayList\(token, form\.get\('email'\)\)/);
    assert.match(route, /'Cache-Control': 'no-store, max-age=0'/);
  });
});

test('easternMoment reads as the guest reads a clock', () => {
  assert.equal(easternMoment(new Date('2026-11-15T15:00:00Z')), '10:00 AM on Sunday, November 15');
});

test('no em dashes in anything a guest or the team reads', () => {
  for (const f of [
    'src/lib/guest-app-stays.ts',
    'src/lib/guest-app-stays-db.ts',
    'src/app/h/s/[stay]/page.tsx',
    'src/app/h/s/[stay]/StayCard.tsx',
    'src/app/h/s/[stay]/code/route.ts',
    'src/app/h/s/[stay]/join/route.ts',
    'src/app/h/s/[stay]/StayJoin.tsx',
    'src/lib/guest-app-join.ts',
    'src/lib/audience-subscribe.ts',
    'src/app/api/guest-app-links/route.ts',
    'src/app/properties/[id]/StayLinkControl.tsx',
    'supabase/migrations/20261111140000_guest_app_stays.sql',
  ]) {
    assert.ok(!read(f).includes('\u2014'), `${f} has an em dash`);
  }
});
