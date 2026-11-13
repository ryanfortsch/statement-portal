/**
 * The Stay Cape Ann guest app (/h/<token>).
 *
 * The link is permanent and printed in the house, so the one rule that
 * matters most is structural: nothing that opens a door can reach it. These
 * tests read the source as well as run the builder, because the guarantee
 * lives in what the loader selects, and a later "while I'm here" select('*')
 * would break it without failing anything else.
 *
 * Run: npm test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildGuestApp,
  clockLabel,
  GUEST_APP_PROPERTY_COLS,
  missingFacts,
  phoneDisplay,
  smsHref,
  splitLong,
  wifiJoinUri,
  type GuestAppHome,
  type GuestAppInput,
} from '../guest-app.ts';
import { findGuideListing, nearbyPlaces, NEARBY_LIMIT, type GuideData } from '../guest-app-nearby.ts';
import { QUO_LINES } from '../quo-lines.ts';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');
const GUIDE = JSON.parse(read('src/data/sca-guide.json')) as GuideData;

/** property_access's credential columns, read from the module's own list. */
const ACCESS_COLUMNS: string[] = (() => {
  const src = read('src/lib/property-access.ts');
  const list = src.slice(src.indexOf('export const ACCESS_COLUMNS = ['), src.indexOf('] as const;'));
  return [...list.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
})();

const SEVENTEEN_BEACH = '695d5c8afb0a0500153d5d1c';

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
    trash_notes: 'The carts live beside the garage.',
    carts_handled_by_us: false,
    heating: 'forced hot water',
    cooling: 'mini splits',
    thermostat_brand: null,
    internet_provider: 'Comcast',
    smart_tv: null,
    wifi_name: 'Harbor Net',
    wifi_label: null,
    wifi_name_2: null,
    wifi_label_2: null,
    has_pack_n_play: true,
    has_high_chair: false,
    has_pullout_bed: false,
    pullout_linens_location: null,
    quiet_hours: null,
    pet_policy: null,
    smoking_policy: null,
    house_rules: null,
    default_checkout_time: '10:00',
    smart_lock_brand: 'Yale',
    fire_extinguisher_locations: 'Under the kitchen sink',
    smoke_detector_locations: 'Every bedroom and the hall',
    fire_exit_locations: null,
    water_shutoff_location: 'Basement, left of the stairs',
    gas_shutoff_location: null,
    oil_shutoff_location: null,
    electrical_panel_location: 'Basement, back wall',
    home_guide_overrides: null,
    ...over,
  };
}

function input(over: Partial<GuestAppInput> = {}, homeOver: Partial<GuestAppHome> = {}): GuestAppInput {
  return {
    home: home(homeOver),
    wifi: { password: 'synthetic-wifi-pass', password2: null },
    rooms: [],
    notes: [],
    checkInTime: '16:00',
    heroPhotoUrl: null,
    nearby: [],
    bookAgainUrl: null,
    welcomeNote: null,
    // Wednesday 2026-11-11, noon Eastern.
    now: new Date('2026-11-11T17:00:00Z'),
    ...over,
  };
}

const COLS = GUEST_APP_PROPERTY_COLS.split(',').map((c) => c.trim()).filter(Boolean);

describe('nothing that opens a door reaches the guest app', () => {
  test('the properties select and the GuestAppHome type name the same columns', () => {
    const src = read('src/lib/guest-app.ts');
    const block = src.slice(src.indexOf('export type GuestAppHome = {'), src.indexOf('};', src.indexOf('export type GuestAppHome = {')));
    const typed = [...block.matchAll(/^\s+([a-z0-9_]+):/gm)].map((m) => m[1]).sort();
    assert.deepEqual([...COLS].sort(), typed);
  });

  test('no access column, and no owner or money column, is selected', () => {
    assert.ok(ACCESS_COLUMNS.includes('smart_lock_code') && ACCESS_COLUMNS.length >= 9);
    for (const c of ACCESS_COLUMNS) assert.ok(!COLS.includes(c), `${c} must never be in the guest app select`);
    for (const c of ['smart_lock_code', 'gate_code', 'garage_code', 'alarm_system', 'thermostat_code', 'key_code_location', 'arrival_brief', 'wifi_password', 'wifi_password_2']) {
      assert.ok(!GUEST_APP_PROPERTY_COLS.includes(c), c);
    }
    for (const c of ['management_fee_pct', 'owner_name', 'owner_email', 'owner_emails', 'bank_last4', 'tax_cert_id']) {
      assert.ok(!COLS.includes(c), `${c} is owner data`);
    }
  });

  test('guest check-in is the rate plan, never the cleaner deadline', () => {
    assert.ok(!COLS.includes('default_checkin_time'));
    assert.match(read('src/lib/guest-app-db.ts'), /from\('property_rate_plans'\)\.select\('checkin_time'\)/);
  });

  test("a Guesty-run home takes Guesty's check-in time, never the cleaner deadline", () => {
    const db = read('src/lib/guest-app-db.ts');
    const fn = db.slice(db.indexOf('export async function guestyCheckinTime'), db.indexOf('export async function loadGuestApp'));
    assert.match(fn, /from\('guesty_listings'\)\.select\('checkin_time'\)/);
    // Two listings that disagree give no time, not the first one.
    assert.match(fn, /times\.size === 1/);
    // The rate plan wins; Guesty's time only fills a blank.
    assert.match(db, /checkin_time \|\| guestyCheckin/);
    assert.match(read('src/lib/guest-app-stays-db.ts'), /t\?\.checkin \|\| guestyCheckin/);
    for (const f of ['src/lib/guest-app-db.ts', 'src/lib/guest-app-stays-db.ts']) {
      assert.ok(!read(f).replace(/^\s*(\/\/|\*).*$/gm, '').includes('default_checkin_time'), `${f} must not read the cleaner deadline`);
    }

    // The sync writes the listing's time to guesty_listings, and only there.
    const sync = read('src/app/api/sync-guesty/route.ts').replace(/^\s*(\/\/|\*).*$/gm, '');
    assert.match(sync, /\.from\('guesty_listings'\)\s*\.update\(\{ checkin_time:/);
    assert.ok(!/default_checkin_time\s*:/.test(sync), 'sync-guesty must never write the cleaner deadline');
  });

  test('the loader reads Wi-Fi through the two-column read and nothing broader', () => {
    const db = read('src/lib/guest-app-db.ts');
    assert.match(db, /getGuestWifiPasswords\(propertyId\)/);
    for (const broad of ['getPropertyAccess(', 'getPropertyAccessMap(', 'readMessageAccess(', "from('property_access')", ".select('*')", '.select("*")', '.select()']) {
      assert.ok(!db.includes(broad), `guest-app-db.ts must not call ${broad}`);
    }
    assert.match(db, /\.select\(cols\)/);
    assert.match(db, /guestRoomFacts\(/);
    assert.match(db, /\.eq\('guest_facing', true\)/);
    assert.match(db, /\.is\('resolved_at', null\)/);

    const access = read('src/lib/property-access.ts');
    const fn = access.slice(access.indexOf('export async function getGuestWifiPasswords'));
    assert.match(fn.slice(0, fn.indexOf('\n}\n')), /\.select\('wifi_password, wifi_password_2'\)/);
  });

  test('the public page and its client body never import the access module', () => {
    for (const f of ['src/app/h/[token]/page.tsx', 'src/app/h/[token]/GuestAppScreen.tsx', 'src/app/h/[token]/GuestAppBody.tsx', 'src/lib/guest-app.ts']) {
      const src = read(f);
      assert.ok(!src.includes('property-access'), `${f} imports property-access`);
      assert.ok(!src.includes('guest-locks'), `${f} imports guest-locks`);
    }
  });

  test('a code smuggled onto the row never renders', () => {
    const smuggled = { ...home(), smart_lock_code: '480213', gate_code: '771204', alarm_system: 'code 990311' } as unknown as GuestAppHome;
    const out = JSON.stringify(buildGuestApp(input({ home: smuggled })));
    for (const code of ['480213', '771204', '990311']) assert.ok(!out.includes(code), `${code} leaked`);
    // The door is described, and when the code arrives (Dotti, 2026-11-13).
    assert.match(out, /Your door code arrives between 3:30 and 4 PM on check-in day\./);
  });

  test('the proxy opens /h/ and the card is a self-guarded document', () => {
    const proxy = read('src/proxy.ts');
    assert.match(proxy, /"\/h\/",/);
    assert.match(proxy, /\|guest-app-card\)/);
    const tokenSrc = read('src/lib/property-document-token.ts');
    assert.match(tokenSrc, /'guest-app-card'/);
  });

  test('the card prints the home\'s permanent link and only when the app is on', () => {
    const card = read('src/app/properties/[id]/guest-app-card/page.tsx');
    assert.match(card, /row\?\.enabled\s*\?\s*await renderQrForPlacard\(\{\s*uri: guestAppUrl\(row\.token\)/);
  });

  test('the open counter is the service role only', () => {
    const sql = read('supabase/migrations/20261111120000_guest_app_homes.sql');
    assert.match(sql, /alter table public\.guest_app_homes enable row level security/i);
    assert.match(sql, /revoke all on public\.guest_app_homes from anon, authenticated/i);
    assert.match(sql, /revoke all on function public\.guest_app_opened\(text\) from public, anon, authenticated/i);
    assert.match(sql, /grant execute on function public\.guest_app_opened\(text\) to service_role/i);
  });
});

describe('what the guest reads', () => {
  test('Wi-Fi first, with a join code the placard would print', () => {
    const app = buildGuestApp(input());
    assert.equal(app.sections[0].id, 'wifi');
    assert.deepEqual(app.wifi.map((w) => w.ssid), ['Harbor Net']);
    assert.equal(app.wifi[0].joinUri, 'WIFI:T:WPA;S:Harbor Net;P:synthetic-wifi-pass;H:false;;');
    assert.equal(wifiJoinUri('A;B', 'p:"q'), 'WIFI:T:WPA;S:A\\;B;P:p\\:\\"q;H:false;;');
    assert.equal(wifiJoinUri('Open', null), 'WIFI:T:nopass;S:Open;;');
  });

  test('check-in and checkout read as clock times', () => {
    const app = buildGuestApp(input());
    assert.equal(app.checkIn, '4:00 PM');
    assert.equal(app.checkOut, '10:00 AM');
    assert.equal(clockLabel('00:30'), '12:30 AM');
    assert.equal(clockLabel('12:00'), '12:00 PM');
    assert.equal(clockLabel(''), null);
    const checkout = app.sections.find((s) => s.id === 'checkout');
    assert.equal(checkout?.intro, 'Checkout is 10:00 AM. No chores required.');
  });

  test('every way to reach us is a text to the GUESTS line naming the home', () => {
    const app = buildGuestApp(input());
    const line = QUO_LINES.guests.number;
    assert.equal(line, '+19788652575');
    assert.equal(app.contact.phoneDisplay, '(978) 865-2575');
    assert.equal(phoneDisplay(line), '(978) 865-2575');
    for (const href of [app.contact.text, app.contact.extend]) {
      assert.ok(href.startsWith(`sms:${line}?&body=`), href);
      assert.ok(decodeURIComponent(href).includes('Stay by the Harbor (12 Test)'), href);
    }
    assert.equal(smsHref(line, 'a b&c'), 'sms:+19788652575?&body=a%20b%26c');
  });

  test('Gloucester trash lives in its section, back-in clause included', () => {
    const app = buildGuestApp(input());
    const trash = app.sections.find((s) => s.id === 'trash');
    assert.ok(trash?.items.some((i) => i.label === 'The City rule'));
    assert.ok(trash?.items.some((i) => i.text === 'The carts live beside the garage.'));
    // Sec. 5-66(q): a cart left at the curb is $400 a day, so "back in" is never dropped.
    assert.match(JSON.stringify(trash), /back in/);
    const checkout = app.sections.find((s) => s.id === 'checkout');
    assert.match(JSON.stringify(checkout), /We bring them back in\./);
  });

  test('Rockport gets no cart night and no cart wording', () => {
    const app = buildGuestApp(input({}, { city: 'Rockport', trash_day: null }));
    const text = JSON.stringify(app.sections);
    assert.ok(!/roll the carts/i.test(text));
    assert.ok(!/purple bag/i.test(JSON.stringify(app)));
  });

  test('the home screen carries no chips: trash is in its tile, no sunset (Dotti, 2026-11-13)', () => {
    const app = buildGuestApp(input({ now: new Date('2026-11-10T13:00:00Z') }));
    assert.ok(!('today' in app));
    const body = readFileSync(new URL('../../app/h/[token]/GuestAppBody.tsx', import.meta.url), 'utf8');
    assert.ok(!body.includes('ga-today'));
    assert.ok(!/sunset/i.test(readFileSync(new URL('../guest-app.ts', import.meta.url), 'utf8')));
  });

  test('checkout ends on one more night, never a late-checkout tease', () => {
    const app = buildGuestApp(input());
    const checkout = app.sections.find((s) => s.id === 'checkout');
    const last = checkout?.items.at(-1);
    assert.equal(last?.text, 'Looking to extend your stay another night?');
    assert.equal(last?.link?.label, 'Text us to extend');
    assert.equal(last?.link?.href, app.contact.extend);
    const body = decodeURIComponent(app.contact.extend);
    assert.match(body, /Stay by the Harbor \(12 Test\)\. Could we extend our stay another night\?$/);
    assert.ok(!/late checkout/i.test(JSON.stringify(app)), 'no late checkout line anywhere');
  });

  test('safety leads with 911 and the nearest emergency department', () => {
    const app = buildGuestApp(input());
    const safety = app.sections.find((s) => s.id === 'safety');
    assert.match(safety?.intro ?? '', /call 911 first/);
    assert.equal(app.emergency.address, '12 Test Street, Gloucester, MA');
    assert.equal(app.emergency.hospital?.name, 'Addison Gilbert Hospital');
    assert.ok(safety?.items.some((i) => i.label === 'Water shutoff'));
    assert.ok(safety?.items.some((i) => i.label === 'Poison control'));
  });

  test('a welcome note replaces the house welcome; blank keeps it', () => {
    assert.match(buildGuestApp(input()).welcome, /We are so glad you are here/);
    assert.equal(buildGuestApp(input({ welcomeNote: '  Fresh flowers on the table.  ' })).welcome, 'Fresh flowers on the table.');
  });
});

describe('on a phone: tiles, pages, fewer words', () => {
  test('every section has a tile name and a one-line answer', () => {
    const app = buildGuestApp(input());
    for (const s of app.sections) {
      assert.ok(s.nav, `${s.id} has no tile name`);
      assert.ok(s.glance && s.glance.length <= 32, `${s.id} glance "${s.glance}"`);
    }
    assert.equal(app.sections.find((s) => s.id === 'checkout')?.glance, '10:00 AM');
    assert.equal(app.sections.find((s) => s.id === 'trash')?.glance, 'Tuesday pickup');
    assert.equal(app.sections.find((s) => s.id === 'arrival')?.glance, 'Check-in 4:00 PM');
  });

  test('the house and its how-tos are one page', () => {
    const app = buildGuestApp(input());
    const ids = app.sections.map((s) => s.id as string);
    assert.ok(!ids.includes('howto'));
    assert.equal(new Set(ids).size, ids.length);
  });

  test('a page heading says TV only when the home has TV facts', () => {
    const plain = buildGuestApp(input({ rooms: [] }, { smart_tv: null }));
    assert.equal(plain.sections[0].title, 'Wi-Fi');
    const tv = buildGuestApp(input({}, { smart_tv: 'Roku in the living room' }));
    assert.equal(tv.sections[0].title, 'Wi-Fi & TV');
  });

  test('a long paragraph shows its first sentence and keeps the rest', () => {
    const noise =
      'Gloucester prohibits excessive noise that crosses property lines and disrupts neighbors’ comfort, especially between 10 p.m. and 7 a.m. Music, hot tubs, and outdoor gatherings should be kept quiet during these hours.';
    const split = splitLong(noise);
    assert.ok(split);
    assert.equal(split![0], 'Gloucester prohibits excessive noise that crosses property lines and disrupts neighbors’ comfort, especially between 10 p.m. and 7 a.m.');
    assert.equal(`${split![0]} ${split![1]}`, noise);
    assert.equal(splitLong('Short and sweet.'), null);
    // One run-on sentence with nowhere to cut reads whole.
    assert.equal(splitLong('a'.repeat(400)), null);
  });

  test('one Text us button, and nothing asks a guest what went wrong', () => {
    const body = read('src/app/h/[token]/GuestAppBody.tsx');
    assert.equal((body.match(/className="ga-action"/g) ?? []).length, 1);
    for (const f of ['src/app/h/[token]/GuestAppBody.tsx', 'src/lib/guest-app.ts']) {
      const src = read(f);
      assert.ok(!/Something(&rsquo;|'|’)s wrong/i.test(src), `${f} asks what went wrong`);
      assert.ok(!/needs attention/i.test(src), `${f} asks what needs attention`);
    }
  });

  test('a section is its own screen, chosen by the URL, not by script', () => {
    const css = read('src/app/h/[token]/guest-app-css.ts');
    assert.match(css, /\.ga-page \{ display: none; \}/);
    assert.match(css, /\.ga-page:target \{ display: block; \}/);
    assert.match(css, /\.ga:has\(\.ga-page:target\) \.ga-home \{ display: none; \}/);
  });
});

describe('blank is reported, not hidden', () => {
  test('a filled-in home has little missing', () => {
    const labels = missingFacts(input({ rooms: [{ name: 'Primary', room_type: 'bedroom', beds: ['1x queen'], sofa_beds: [], sofa_linens: '', tv: '', tv_remote: '', amenities: [], guest_summary: '' }], notes: [{ title: 'Coffee', body: 'Keurig on the counter.' }], heroPhotoUrl: 'https://example.test/p.jpg' })).map((m) => m.label);
    assert.deepEqual(labels, []);
  });

  test('a bare home names each gap and where to fill it', () => {
    const bare = input(
      { wifi: { password: null, password2: null }, checkInTime: null },
      {
        wifi_name: null,
        default_checkout_time: null,
        parking: null,
        trash_notes: null,
        heating: null,
        cooling: null,
        fire_extinguisher_locations: null,
        smoke_detector_locations: null,
        water_shutoff_location: null,
        electrical_panel_location: null,
        latitude: null,
        longitude: null,
      },
    );
    const missing = missingFacts(bare);
    const labels = missing.map((m) => m.label);
    for (const l of ['Wi-Fi name and password', 'Checkout time', 'Guest check-in time', 'Parking', 'Water shutoff', 'Map location', 'Rooms and beds']) {
      assert.ok(labels.includes(l), l);
    }
    assert.ok(missing.every((m) => m.where.length > 0));
  });
});

describe('around Cape Ann, the same places staycapeann.com names', () => {
  test('the bundled guide is there and keyed by Guesty listing id', () => {
    assert.ok(GUIDE.attractions.length >= 20);
    assert.ok(GUIDE.listings[SEVENTEEN_BEACH]);
  });

  test('17 Beach: the confirmed walk to Good Harbor leads, its pick is marked', () => {
    const listing = findGuideListing(GUIDE, { guestyListingId: SEVENTEEN_BEACH, formerGuestyListingId: null, name: '17 Beach' });
    assert.ok(listing);
    const places = nearbyPlaces(GUIDE, listing, { lat: null, lng: null });
    assert.ok(places.length > 0 && places.length <= NEARBY_LIMIT);
    assert.equal(places[0].name, 'Good Harbor Beach');
    assert.equal(places[0].walk, true);
    assert.equal(places[0].travel, '4 min walk');
    assert.ok(places.some((p) => p.name === 'Short and Main' && p.ourPick));
    for (const anchor of ['Good Harbor Beach', 'Downtown Gloucester', 'Downtown Rockport']) {
      assert.ok(places.some((p) => p.name === anchor), anchor);
    }
    // Walks first, each group nearest first.
    const firstDrive = places.findIndex((p) => !p.walk);
    if (firstDrive >= 0) assert.ok(places.slice(firstDrive).every((p) => !p.walk));
  });

  test('a home finds its listing by its former id or its name', () => {
    assert.ok(findGuideListing(GUIDE, { guestyListingId: 'unknown', formerGuestyListingId: SEVENTEEN_BEACH, name: 'x' }));
    assert.equal(findGuideListing(GUIDE, { guestyListingId: null, formerGuestyListingId: null, name: '17 Beach' })?.internalName, '17 Beach');
    assert.equal(findGuideListing(GUIDE, { guestyListingId: null, formerGuestyListingId: null, name: 'Nowhere' }), null);
  });

  test('no listing and no map location means no list rather than a guess', () => {
    assert.deepEqual(nearbyPlaces(GUIDE, null, { lat: null, lng: null }), []);
  });
});

test('no em dashes in anything a guest or the team reads', () => {
  for (const f of [
    'src/lib/guest-app.ts',
    'src/lib/guest-app-nearby.ts',
    'src/lib/guest-app-db.ts',
    'src/app/h/[token]/page.tsx',
    'src/app/h/[token]/GuestAppBody.tsx',
    'src/app/h/[token]/GuestAppScreen.tsx',
    'src/app/properties/[id]/guest-app-card/page.tsx',
    'src/app/properties/[id]/GuestAppSection.tsx',
    'src/app/properties/[id]/GuestAppPanel.tsx',
    'src/app/properties/[id]/guest-app-actions.ts',
  ]) {
    assert.ok(!read(f).includes('—'), `${f} has an em dash`);
  }
});
