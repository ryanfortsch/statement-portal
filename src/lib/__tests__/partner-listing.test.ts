/**
 * Partner home setup: the listing bar and the switch (src/lib/partner-listing.ts).
 *
 * A partner home reaches staycapeann.com only when an owner lists it, and an
 * owner can list it only once every line of the bar is green. These hold the
 * bar's lines, the add form, the id and name a new home gets, and the guards
 * spread across files:
 *
 *   - the site's fleet names only listed partner homes, and a request for an
 *     unlisted one is refused before it is priced;
 *   - listing reads the bar again on the server, and only an owner lists or
 *     takes a home off;
 *   - the migration keeps every row on a partner home, locked to the service
 *     role.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHECK_COLUMNS,
  MIN_PHOTOS,
  PERSON_CHECKS,
  hostNameParts,
  internalNameFromAddress,
  isListed,
  isPersonCheck,
  isoDay,
  listingState,
  parseNewPartnerHome,
  propertyIdBase,
  readyToList,
  setupItems,
  type PartnerListingRow,
  type PartnerSetupFacts,
} from '../partner-listing.ts';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p: string): string => readFileSync(join(repo, p), 'utf8');
const code = (p: string): string => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const NOW = new Date('2026-11-13T15:00:00Z');
const HOUR = 60 * 60_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

function checks(over: Partial<PartnerListingRow> = {}): PartnerListingRow {
  return {
    property_id: '12_main',
    walked_on: '2026-11-01',
    walked_by: 'delaney@risingtidestr.com',
    insurance_checked_on: '2026-11-01',
    insurance_expires_on: '2027-06-30',
    insurance_checked_by: 'allie@risingtidestr.com',
    agreement_signed_on: '2026-11-02',
    agreement_recorded_by: 'ryan@risingtidestr.com',
    photos_ok_on: '2026-11-03',
    photos_ok_by: 'allie@risingtidestr.com',
    listed_at: null,
    listed_by: null,
    unlisted_at: null,
    unlisted_by: null,
    unlisted_reason: null,
    ...over,
  };
}

/** A home that clears every line. Each test breaks one thing. */
function facts(over: { property?: Partial<PartnerSetupFacts['property']>; listing?: Partial<NonNullable<PartnerSetupFacts['listing']>> | null } & Partial<Omit<PartnerSetupFacts, 'property' | 'listing'>> = {}): PartnerSetupFacts {
  const { property, listing, ...rest } = over;
  return {
    property: {
      id: '12_main',
      name: '12 Main',
      address: '12 Main Street',
      city: 'Gloucester',
      latitude: 42.61,
      longitude: -70.66,
      owner_full: 'Pat Host',
      owner_emails: ['pat@example.com'],
      owner_phone: '978-555-0100',
      tax_cert_id: 'C0123456789',
      str_registration_id: 'STR-2026-014',
      str_insurance_carrier: 'Proper',
      default_checkout_time: '10:00 AM',
      cancellation_policy: 'Full refund up to 30 days before arrival.',
      house_rules: 'No parties. No smoking.',
      calendar_authority: 'helm',
      ...property,
    },
    listing:
      listing === null
        ? null
        : {
            hasOwnTitle: true,
            title: 'Harbor light on Main',
            tagline: 'Two bedrooms over the harbor',
            description: 'A bright two bedroom a block from the water.',
            photoCount: 24,
            bedrooms: 2,
            bathrooms: 1,
            accommodates: 4,
            basePrice: 325,
            ...listing,
          },
    feeds: [
      { channel: 'airbnb', last_synced_at: ago(0.5 * HOUR), last_error: null },
      { channel: 'vrbo', last_synced_at: ago(0.5 * HOUR), last_error: null },
    ],
    exportPulls: { airbnb: ago(3 * HOUR), vrbo: ago(20 * HOUR) },
    paymentsReady: true,
    feeSet: true,
    checks: checks(),
    ...rest,
  };
}

const item = (f: PartnerSetupFacts, key: string) => {
  const found = setupItems(f, NOW).find((i) => i.key === key);
  assert.ok(found, `no ${key} line`);
  return found;
};

describe('the listing bar', () => {
  test('a complete home clears every line, in the order the office works them', () => {
    const items = setupItems(facts(), NOW);
    assert.deepEqual(
      items.map((i) => i.key),
      ['host', 'location', 'listing', 'photos', 'rooms', 'rates', 'policy', 'permits', 'insurance', 'walk', 'agreement', 'calendar_in', 'calendar_out', 'payments'],
    );
    assert.deepEqual(items.filter((i) => !i.ok).map((i) => i.key), []);
    assert.equal(readyToList(items), true);
  });

  test('one open line stops the listing', () => {
    const items = setupItems(facts({ checks: checks({ walked_on: null }) }), NOW);
    assert.equal(readyToList(items), false);
    assert.deepEqual(items.filter((i) => !i.ok).map((i) => i.key), ['walk']);
    assert.equal(readyToList([]), false, 'an empty bar is not a cleared one');
  });

  test('the host needs a name, an email and a phone', () => {
    const host = item(facts({ property: { owner_phone: null, owner_emails: [''] } }), 'host');
    assert.equal(host.ok, false);
    assert.equal(host.detail, 'Needs an email and a phone');
    assert.equal(host.fix, 'facts');
  });

  test('the address needs a map pin', () => {
    const loc = item(facts({ property: { latitude: null } }), 'location');
    assert.equal(loc.ok, false);
    assert.equal(loc.detail, 'Needs the map pin');
  });

  test('listing copy needs its own title, a summary and a description', () => {
    assert.equal(item(facts({ listing: { hasOwnTitle: false } }), 'listing').ok, false, 'a title borrowed from the address is not a title');
    assert.equal(item(facts({ listing: null }), 'listing').detail, 'Needs a title, a summary and a description');
  });

  test('photos need the count and a person who looked at them', () => {
    const few = item(facts({ listing: { photoCount: MIN_PHOTOS - 1 } }), 'photos');
    assert.equal(few.ok, false);
    assert.equal(few.fix, 'listing', 'too few: add photos first');
    const unchecked = item(facts({ checks: checks({ photos_ok_on: null }) }), 'photos');
    assert.equal(unchecked.ok, false);
    assert.equal(unchecked.fix, 'checks');
    assert.match(unchecked.detail, /not checked yet/);
  });

  test('rooms need bedrooms, bathrooms and how many guests', () => {
    const rooms = item(facts({ listing: { accommodates: 0 } }), 'rooms');
    assert.equal(rooms.ok, false);
    assert.equal(rooms.fix, 'facts', 'guest count is a property fact');
  });

  test('a rate needs a saved plan and a calendar Helm holds', () => {
    assert.equal(item(facts({ listing: { basePrice: 0 } }), 'rates').ok, false);
    const notHelm = item(facts({ property: { calendar_authority: 'guesty' } }), 'rates');
    assert.equal(notHelm.ok, false);
    assert.equal(notHelm.detail, 'Helm does not hold this calendar');
  });

  test('policy needs cancellation, house rules and a checkout time', () => {
    const p = item(facts({ property: { house_rules: '  ' } }), 'policy');
    assert.equal(p.ok, false);
    assert.equal(p.detail, 'Needs house rules');
  });

  test('permits need the state certificate and the city permit', () => {
    const p = item(facts({ property: { tax_cert_id: null, str_registration_id: null } }), 'permits');
    assert.equal(p.ok, false);
    assert.equal(p.detail, 'Needs the MA certificate and the city permit');
  });

  test('insurance needs a carrier, a proof seen and an expiry still ahead', () => {
    assert.equal(item(facts({ property: { str_insurance_carrier: null } }), 'insurance').fix, 'facts');
    assert.equal(item(facts({ checks: checks({ insurance_checked_on: null }) }), 'insurance').ok, false);
    assert.equal(item(facts({ checks: checks({ insurance_expires_on: null }) }), 'insurance').ok, false, 'a proof with no end date is not a proof');
    const expired = item(facts({ checks: checks({ insurance_expires_on: '2026-11-12' }) }), 'insurance');
    assert.equal(expired.ok, false);
    assert.match(expired.detail, /expired 2026-11-12/);
    assert.equal(item(facts({ checks: checks({ insurance_expires_on: '2026-11-13' }) }), 'insurance').ok, true, 'good through its last day');
  });

  test('the walk and the agreement are a person’s word, with the date', () => {
    assert.equal(item(facts({ checks: null }), 'walk').ok, false);
    assert.equal(item(facts({ checks: null }), 'agreement').ok, false);
    assert.equal(item(facts(), 'walk').detail, 'Passed delaney, 2026-11-01');
  });

  test("the host's calendars must be read in the last six hours", () => {
    assert.equal(item(facts({ feeds: [] }), 'calendar_in').detail, 'No calendar added');
    const stale = item(
      facts({ feeds: [{ channel: 'airbnb', last_synced_at: ago(7 * HOUR), last_error: 'www.airbnb.com/… answered 404' }] }),
      'calendar_in',
    );
    assert.equal(stale.ok, false);
    assert.equal(stale.detail, 'Airbnb not read lately: www.airbnb.com/… answered 404');
    assert.equal(item(facts({ feeds: [{ channel: 'airbnb', last_synced_at: null, last_error: null }] }), 'calendar_in').ok, false);
  });

  test('every channel the host sells on must pull our export', () => {
    const notVrbo = item(facts({ exportPulls: { airbnb: ago(HOUR), vrbo: null } }), 'calendar_out');
    assert.equal(notVrbo.ok, false);
    assert.equal(notVrbo.detail, 'Vrbo has not read it yet');
    const neither = item(facts({ exportPulls: {} }), 'calendar_out');
    assert.equal(neither.detail, 'Airbnb and Vrbo have not read it yet');
    const stale = item(facts({ exportPulls: { airbnb: ago(4 * 24 * HOUR), vrbo: ago(HOUR) } }), 'calendar_out');
    assert.equal(stale.ok, false, 'a pull four days old no longer counts');
    assert.equal(item(facts({ exportPulls: null }), 'calendar_out').ok, false, 'an unread export log fails closed');
    assert.equal(item(facts({ feeds: [] }), 'calendar_out').ok, false, 'no feeds, nothing to vouch for');
  });

  test("their own software is the office's word: it has no pull to check", () => {
    const own = facts({ feeds: [{ channel: 'other', last_synced_at: ago(HOUR), last_error: null }], exportPulls: {} });
    assert.equal(item(own, 'calendar_in').ok, true);
    assert.equal(item(own, 'calendar_out').ok, false, 'a home with only its own software still needs a channel to vouch');
    const mixed = facts({
      feeds: [
        { channel: 'airbnb', last_synced_at: ago(HOUR), last_error: null },
        { channel: 'other', last_synced_at: ago(HOUR), last_error: null },
      ],
      exportPulls: { airbnb: ago(HOUR) },
    });
    assert.equal(item(mixed, 'calendar_out').ok, true);
  });

  test('payments need the fee and the host’s Stripe', () => {
    assert.equal(item(facts({ paymentsReady: false, feeSet: false }), 'payments').detail, 'Our fee is not set');
    assert.equal(item(facts({ paymentsReady: false }), 'payments').detail, 'The host has not finished Stripe');
  });
});

describe('on or off the site', () => {
  test('listed means listed and not taken off since', () => {
    assert.equal(isListed(null), false);
    assert.equal(isListed({ listed_at: null, unlisted_at: null }), false);
    assert.equal(isListed({ listed_at: '2026-11-10T12:00:00Z', unlisted_at: null }), true);
    assert.equal(isListed({ listed_at: '2026-11-10T12:00:00Z', unlisted_at: '2026-11-11T12:00:00Z' }), false);
    assert.equal(listingState(undefined), 'not_listed');
    assert.equal(listingState({ listed_at: '2026-11-10T12:00:00Z', unlisted_at: null }), 'listed');
    assert.equal(listingState({ listed_at: '2026-11-10T12:00:00Z', unlisted_at: '2026-11-11T12:00:00Z' }), 'taken_off');
  });

  test('the four person checks write a date and a name', () => {
    assert.deepEqual([...PERSON_CHECKS], ['walk', 'insurance', 'agreement', 'photos']);
    for (const c of PERSON_CHECKS) {
      assert.ok(String(CHECK_COLUMNS[c].on).endsWith('_on'), c);
      assert.ok(/_by$/.test(String(CHECK_COLUMNS[c].by)), c);
    }
    assert.equal(isPersonCheck('walk'), true);
    assert.equal(isPersonCheck('listed'), false);
  });

  test('a check date is a real calendar day', () => {
    assert.equal(isoDay('2026-11-13'), '2026-11-13');
    assert.equal(isoDay(' 2026-11-13 '), '2026-11-13');
    assert.equal(isoDay('2026-02-30'), null);
    assert.equal(isoDay('11/13/2026'), null);
    assert.equal(isoDay(20261113), null);
  });
});

describe('a new partner home', () => {
  test('the form needs a street address with a house number, a town and the host', () => {
    const ok = parseNewPartnerHome({ address: ' 12  Main Street, Gloucester MA ', city: 'Gloucester', host_name: 'Pat  Host', host_email: 'Pat@Example.com', host_phone: '' });
    assert.deepEqual(ok, { ok: true, home: { address: '12 Main Street', city: 'Gloucester', host_name: 'Pat Host', host_email: 'pat@example.com', host_phone: null } });
    assert.equal(parseNewPartnerHome({ address: 'Main Street', city: 'Gloucester', host_name: 'Pat', host_email: 'p@x.com' }).ok, false);
    assert.equal(parseNewPartnerHome({ address: '12 Main Street', city: '', host_name: 'Pat', host_email: 'p@x.com' }).ok, false);
    assert.equal(parseNewPartnerHome({ address: '12 Main Street', city: 'Gloucester', host_name: '', host_email: 'p@x.com' }).ok, false);
    assert.equal(parseNewPartnerHome({ address: '12 Main Street', city: 'Gloucester', host_name: 'Pat', host_email: 'not an email' }).ok, false);
    assert.equal(parseNewPartnerHome({ address: '12 Main Street', city: 'Gloucester', host_name: 'Pat', host_email: 'p@x.com', host_phone: 'call me' }).ok, false);
    assert.equal(parseNewPartnerHome({ address: '12A Main Street', city: 'Rockport', host_name: 'Pat', host_email: 'p@x.com', host_phone: '+1 (978) 555-0100' }).ok, true);
  });

  test('its name and id follow the house convention', () => {
    assert.equal(internalNameFromAddress('12 Main Street'), '12 Main');
    assert.equal(internalNameFromAddress('7 Rocky Neck Ave.'), '7 Rocky Neck');
    assert.equal(internalNameFromAddress("3 O'Malley Lane"), '3 OMalley');
    assert.equal(propertyIdBase('12 Main Street'), '12_main');
    assert.equal(propertyIdBase('7 Rocky Neck Ave., Gloucester'), '7_rocky_neck');
    assert.equal(propertyIdBase('12A Main St'), '12a_main');
  });

  test('the host fills the owner columns', () => {
    assert.deepEqual(hostNameParts('Pat Q. Host'), { owner_full: 'Pat Q. Host', owner_last: 'Host', owner_greeting: 'Pat' });
    assert.deepEqual(hostNameParts('Cher'), { owner_full: 'Cher', owner_last: 'Cher', owner_greeting: 'Cher' });
  });
});

describe('the guards around the switch', () => {
  test("the site's fleet names only listed partner homes", () => {
    const bridge = code('src/lib/pms-bridge.ts');
    assert.ok(bridge.includes('const listed = await listedPartnerIds();'));
    assert.ok(bridge.includes('props = props.filter((p) => !isPartnerHome(p) || listed.has(p.id));'));
    const listed = code('src/lib/partner-listed.ts');
    assert.ok(listed.includes(".not('listed_at', 'is', null)") && listed.includes(".is('unlisted_at', null)"));
    assert.ok(/if \(error\) \{[\s\S]*?return new Set\(\);/.test(listed), 'a failed read lists nobody');
  });

  test('a request for an unlisted partner home is refused before it is priced', () => {
    const db = code('src/lib/booking-requests-db.ts');
    const create = db.slice(db.indexOf('export async function createBookingRequest('));
    const gate = create.indexOf("if (!(await isListedPartner(property.id))) return { ok: false, error: 'not_found' };");
    assert.ok(gate > 0, 'the listing gate is there');
    assert.ok(gate < create.indexOf('quoteForBridge('), 'and comes before the price');
  });

  test('listing reads the bar again on the server', () => {
    const db = code('src/lib/partner-listing-db.ts');
    const list = db.slice(db.indexOf('export async function listPartnerHome('), db.indexOf('export async function unlistPartnerHome('));
    assert.ok(list.includes('const setup = await loadPartnerSetup(propertyId, now);'));
    assert.ok(list.indexOf('if (!setup.ready)') < list.indexOf('listed_at: now.toISOString()'), 'the bar is checked before the write');
    const unlist = db.slice(db.indexOf('export async function unlistPartnerHome('));
    assert.ok(unlist.includes("if (!why) return { ok: false, reason: 'Say why it comes off, for the record.' };"));
  });

  test('only an owner lists, takes off or adds a partner home', () => {
    const actions = code('src/app/properties/[id]/partner-actions.ts');
    for (const fn of ['listPartnerHomeAction', 'unlistPartnerHomeAction']) {
      const start = actions.indexOf(`export async function ${fn}(`);
      assert.ok(start >= 0, fn);
      const body = actions.slice(start, actions.indexOf('\n}', start));
      assert.ok(body.includes('await requireOwnerEmail()'), `${fn} checks the owner`);
    }
    const requests = code('src/app/guests/requests/actions.ts');
    const create = requests.slice(requests.indexOf('export async function createPartnerHomeAction('));
    assert.ok(create.includes('await requireOwnerEmail()'));
  });

  test('every partner listing write names a partner home, in the database too', () => {
    const sql = read('supabase/migrations/20261113020000_partner_home_setup.sql');
    assert.ok(sql.includes("where id = new.property_id and kind = 'partner'"), 'the trigger reads the kind');
    for (const t of ['partner_listings', 'partner_calendar_feeds']) {
      assert.ok(new RegExp(`before insert or update of property_id on public\\.${t}`).test(sql), `${t} is guarded`);
    }
    for (const t of ['partner_listings', 'partner_calendar_feeds', 'partner_calendar_holds']) {
      assert.ok(sql.includes(`alter table public.${t} enable row level security;`), `${t} has RLS`);
      assert.ok(sql.includes(`revoke all on public.${t} from public, anon, authenticated;`), `${t} is closed to clients`);
      assert.ok(new RegExp(`grant [a-z, ]+ on public\\.${t} to service_role;`).test(sql), `${t} grants the service role`);
    }
    assert.ok(sql.includes('check (listed_at is null or listed_by is not null)'), 'a listing names who listed it');
  });

  test('a new partner home starts off the site and inactive', () => {
    const db = code('src/lib/partner-listing-db.ts');
    const create = db.slice(db.indexOf('export async function createPartnerHome('), db.indexOf('export type PartnerSetup'));
    for (const s of ['kind: PARTNER_KIND', 'is_active: false', 'is_rising_tide_owned: false', "calendar_authority: 'helm'", 'management_fee_pct: 0']) {
      assert.ok(create.includes(s), s);
    }
    assert.ok(!/listed_at/.test(create), 'adding a home never lists it');
  });
});
