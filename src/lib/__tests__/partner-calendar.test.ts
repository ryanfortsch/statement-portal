/**
 * A partner home's own calendars (src/lib/partner-calendar.ts).
 *
 * The host keeps selling on Airbnb or Vrbo, so Helm reads those calendars in
 * and the host imports Helm's export. These hold the link check, what a feed
 * read keeps, the empty-feed guard, the export rows, the stale-feed stop on
 * Accept, and the guards spread across files:
 *
 *   - a host's nights live in partner_calendar_holds, never in bookings or
 *     channel_listings, so their guests never reach the crew, Work,
 *     statements or the concierge;
 *   - the export for a partner home carries only accepted staycapeann.com
 *     stays, never the host's own nights;
 *   - the bridge's calendar reads the host's nights, and Accept reads the
 *     host's calendars again before it books.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IcalEvent } from '../ical.ts';
import {
  EMPTY_FEED_GUARD,
  FEED_STALE_MS,
  MAX_HOLDS_PER_FEED,
  asAvailability,
  channelFromHost,
  emptyFeedSuspicious,
  exportRowsForRequests,
  feedIsFresh,
  holdsFromEvents,
  isPartnerFeedChannel,
  maskFeedUrl,
  parseFeedUrl,
  staleFeedsBlockAccept,
  type PartnerHold,
} from '../partner-calendar.ts';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p: string): string => readFileSync(join(repo, p), 'utf8');
const code = (p: string): string => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const NOW = new Date('2026-11-13T15:00:00Z');
const TODAY = '2026-11-13';

function ev(over: Partial<IcalEvent> = {}): IcalEvent {
  return { uid: 'u1', summary: 'Reserved', description: null, url: null, dtstart: '2026-12-01', dtend: '2026-12-04', cancelled: false, raw: {}, ...over } as IcalEvent;
}

describe('the calendar link', () => {
  test('takes an https export link and reads the channel off it', () => {
    const r = parseFeedUrl(' https://www.airbnb.com/calendar/ical/123.ics?s=abc ');
    assert.deepEqual(r, { ok: true, url: 'https://www.airbnb.com/calendar/ical/123.ics?s=abc', channel: 'airbnb' });
    const v = parseFeedUrl('webcal://www.vrbo.com/icalendar/abc.ics');
    assert.ok(v.ok && v.url.startsWith('https://') && v.channel === 'vrbo', 'webcal reads as https');
    const own = parseFeedUrl('https://app.ownerrez.com/feeds/ical/xyz');
    assert.ok(own.ok && own.channel === null, 'a host we do not know is the office’s pick');
  });

  test('refuses what is not a public calendar', () => {
    for (const bad of [
      '',
      'not a link',
      'http://www.airbnb.com/calendar/ical/1.ics',
      'ftp://example.com/cal.ics',
      'https://user:pass@example.com/cal.ics',
      'https://localhost/cal.ics',
      'https://127.0.0.1/cal.ics',
      'https://10.0.0.5/cal.ics',
      'https://192.168.1.2/cal.ics',
      'https://169.254.169.254/latest',
      'https://172.20.0.1/cal.ics',
      'https://[::1]/cal.ics',
      'https://intranet/cal.ics',
      'https://printer.local/cal.ics',
    ]) {
      assert.equal(parseFeedUrl(bad).ok, false, bad);
    }
  });

  test("refuses Helm's own export, so a calendar never reads itself", () => {
    assert.equal(parseFeedUrl('https://helm.risingtidestr.com/api/channels/ical/abc').ok, false);
    assert.equal(parseFeedUrl('https://risingtidestr.com/x.ics').ok, false);
  });

  test('channels by host, and a masked link for the screen', () => {
    assert.equal(channelFromHost('www.airbnb.com'), 'airbnb');
    assert.equal(channelFromHost('www.airbnb.co.uk'), 'airbnb');
    assert.equal(channelFromHost('www.homeaway.com'), 'vrbo');
    assert.equal(channelFromHost('admin.booking.com'), 'booking_com');
    assert.equal(channelFromHost('notairbnb.example.com'), null);
    assert.equal(maskFeedUrl('https://www.airbnb.com/calendar/ical/123.ics?s=secret'), 'www.airbnb.com/…');
    assert.ok(!maskFeedUrl('https://www.airbnb.com/calendar/ical/123.ics?s=secret').includes('secret'));
    assert.equal(isPartnerFeedChannel('other'), true);
    assert.equal(isPartnerFeedChannel('direct'), false);
  });
});

describe('what a feed read keeps', () => {
  test('stays and blocks with real dates, never a name or a description', () => {
    const holds = holdsFromEvents(
      [
        ev({ uid: 'a', summary: 'Reserved', description: 'Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMABC12345\nPhone: 555' }),
        ev({ uid: 'b', summary: 'Airbnb (Not available)', dtstart: '2026-12-10', dtend: '2026-12-12' }),
      ],
      'airbnb',
      TODAY,
    );
    assert.deepEqual(holds, [
      { kind: 'stay', check_in: '2026-12-01', check_out: '2026-12-04', uid: 'a' },
      { kind: 'block', check_in: '2026-12-10', check_out: '2026-12-12', uid: 'b' },
    ]);
    for (const h of holds) assert.deepEqual(Object.keys(h).sort(), ['check_in', 'check_out', 'kind', 'uid']);
  });

  test('drops cancelled and available nights, bad dates and old stays', () => {
    const holds = holdsFromEvents(
      [
        ev({ uid: 'cancel', cancelled: true }),
        ev({ uid: 'open', summary: 'Available' }),
        ev({ uid: 'backwards', dtstart: '2026-12-04', dtend: '2026-12-01' }),
        ev({ uid: 'zero', dtstart: '2026-12-04', dtend: '2026-12-04' }),
        ev({ uid: 'old', dtstart: '2026-09-01', dtend: '2026-09-05' }),
        ev({ uid: 'recent', dtstart: '2026-10-20', dtend: '2026-10-25' }),
      ],
      'airbnb',
      TODAY,
    );
    assert.deepEqual(holds.map((h) => h.uid), ['recent'], 'a stay ended within thirty days is kept; one long past is not');
  });

  test('a repeated event is kept once, and a runaway feed is capped', () => {
    assert.equal(holdsFromEvents([ev(), ev()], 'airbnb', TODAY).length, 1);
    const many = Array.from({ length: MAX_HOLDS_PER_FEED + 50 }, (_, i) => ev({ uid: `u${i}` }));
    assert.equal(holdsFromEvents(many, 'airbnb', TODAY).length, MAX_HOLDS_PER_FEED);
  });

  test("their own software reads as a direct calendar: every named event holds the nights", () => {
    const holds = holdsFromEvents([ev({ summary: 'Smith family' }), ev({ uid: 'x', summary: 'Owner hold', dtstart: '2026-12-20', dtend: '2026-12-22' })], 'other', TODAY);
    assert.equal(holds.length, 2);
  });

  test('an empty read after stays is not believed', () => {
    assert.equal(emptyFeedSuspicious([], EMPTY_FEED_GUARD), true);
    assert.equal(emptyFeedSuspicious([], EMPTY_FEED_GUARD - 1), false, 'one stay going away is a real change');
    const one: PartnerHold[] = [{ kind: 'stay', check_in: '2026-12-01', check_out: '2026-12-04', uid: 'a' }];
    assert.equal(emptyFeedSuspicious(one, 10), false);
  });

  test('the availability engine reads a stay as booked and a block as a block', () => {
    assert.deepEqual(asAvailability({ kind: 'stay', check_in: '2026-12-01', check_out: '2026-12-04' }), { status: 'confirmed', check_in: '2026-12-01', check_out: '2026-12-04', source: 'partner_calendar' });
    assert.equal(asAvailability({ kind: 'block', check_in: '2026-12-01', check_out: '2026-12-04' }).status, 'block');
  });
});

describe('our calendar, out', () => {
  test('carries each accepted request as a direct stay, by id, never a name', () => {
    const rows = exportRowsForRequests([
      { id: 'req-1', check_in: '2026-12-01', check_out: '2026-12-04' },
      { id: 'req-bad', check_in: '2026-12-04', check_out: '2026-12-04' },
      { id: 'req-junk', check_in: 'soon', check_out: '2026-12-04' },
    ]);
    assert.deepEqual(rows, [{ id: 'req-1', status: 'confirmed', duplicate_of: null, check_in: '2026-12-01', check_out: '2026-12-04', channel: 'direct', hold_kind: null, source: 'booking_request' }]);
  });
});

describe('Accept and a stale calendar', () => {
  const H = 60 * 60_000;
  const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

  test('a feed is fresh for six hours after its last good read', () => {
    assert.equal(FEED_STALE_MS, 6 * H);
    assert.equal(feedIsFresh(at(5 * H), NOW), true);
    assert.equal(feedIsFresh(at(6 * H + 1000), NOW), false);
    assert.equal(feedIsFresh(null, NOW), false);
    assert.equal(feedIsFresh('garbage', NOW), false);
  });

  test('every feed fresh, or none at all, lets Accept go on', () => {
    assert.equal(staleFeedsBlockAccept([], NOW), null, 'a home sold only on staycapeann.com has none');
    assert.equal(staleFeedsBlockAccept([{ channel: 'airbnb', last_synced_at: at(H), last_error: null }], NOW), null);
  });

  test('one stale feed, or feeds that cannot be read, stop it and say why', () => {
    const why = staleFeedsBlockAccept(
      [
        { channel: 'airbnb', last_synced_at: at(H), last_error: null },
        { channel: 'vrbo', last_synced_at: at(9 * H), last_error: 'www.vrbo.com/… answered 503' },
      ],
      NOW,
    );
    assert.ok(why && why.includes('Vrbo') && why.includes('answered 503'), String(why));
    assert.ok(staleFeedsBlockAccept(null, NOW));
    assert.ok(staleFeedsBlockAccept([{ channel: 'other', last_synced_at: null, last_error: null }], NOW)?.includes('their own'));
  });
});

describe('the guards around the host calendars', () => {
  test("a host's nights never become a booking or a channel listing", () => {
    for (const f of ['src/lib/partner-calendar-db.ts', 'src/lib/partner-calendar.ts']) {
      const src = code(f);
      assert.ok(!/from\('bookings'\)|from\('channel_listings'\)|from\('property_calendar_days'\)/.test(src), f);
      assert.ok(!/pms-bridge/.test(src), `${f} never imports the bridge`);
    }
    const sql = read('supabase/migrations/20261113020000_partner_home_setup.sql');
    const start = sql.indexOf('create table if not exists public.partner_calendar_holds (');
    const table = sql.slice(start, sql.indexOf('\n);', start)).replace(/--.*$/gm, '');
    const columns = [...table.matchAll(/^\s{2}([a-z_]+) (?:uuid|text|date|timestamptz)\b/gm)].map((m) => m[1]);
    assert.deepEqual(columns, ['id', 'feed_id', 'property_id', 'kind', 'check_in', 'check_out', 'uid', 'seen_at'], 'the holds table keeps dates and a kind, no guest text');
  });

  test('the OTA import skips a partner home, and its channel page sends the office to the property page', () => {
    const sync = code('src/lib/ical-sync.ts');
    assert.ok(sync.includes('!listingOnPartnerHome(l)'), 'the fleet import never reads a partner home into bookings');
    const save = code('src/app/channels/listings/actions.ts');
    assert.ok(save.includes('if (isPartnerHome('), 'saveListing refuses a partner home');
    const page = code('src/app/channels/[propertyId]/page.tsx');
    assert.ok(page.includes('if (isPartnerHome(property)) redirect('));
  });

  test('the export adds accepted stays for a partner home and never reads the host’s nights', () => {
    const route = code('src/app/api/channels/ical/[token]/route.ts');
    assert.ok(route.includes('exportRowsForRequests(await acceptedStaysForExport(prop.id, fromIso))'));
    assert.ok(!/partner_calendar_holds|partnerHoldsInWindow/.test(route), 'no echo of the host’s own calendars');
  });

  test("the bridge's calendar reads the host's nights on a partner home only", () => {
    const bridge = code('src/lib/pms-bridge.ts');
    assert.ok(bridge.includes('partner ? partnerHoldsInWindow(property.id, start, endExclusive) : Promise.resolve([])'));
    const db = code('src/lib/partner-calendar-db.ts');
    const reader = db.slice(db.indexOf('export async function partnerHoldsInWindow('), db.indexOf('export async function acceptedStaysForExport('));
    assert.ok(reader.includes('selectAllPaged'), 'paged, and a failed page throws');
  });

  test('Accept reads the host’s calendars again and refuses a stale one before it checks the nights', () => {
    const db = code('src/lib/booking-requests-db.ts');
    const accept = db.slice(db.indexOf('export async function acceptBookingRequest('), db.indexOf('export async function markHostTold('));
    const sync = accept.indexOf('await syncPartnerFeeds({ propertyId: row.property_id, now });');
    const stale = accept.indexOf('staleFeedsBlockAccept(await listPartnerFeeds(row.property_id), now)');
    const range = accept.indexOf('rangeCheckForBridge(');
    const claim = accept.indexOf(".update({ status: 'accepted'");
    assert.ok(sync > 0 && stale > sync && range > stale && claim > range, 'read, then the freshness stop, then the nights, then the claim');
  });

  test('the cron reads every partner feed after the OTA import', () => {
    const cron = code('src/app/api/cron/channels-sync/route.ts');
    assert.ok(cron.indexOf('await syncPartnerFeeds()') > cron.indexOf('syncAllListings('));
  });

  test('the holds are replaced whole, in one transaction, by the service role only', () => {
    const sql = read('supabase/migrations/20261113020000_partner_home_setup.sql');
    assert.ok(sql.includes('create or replace function public.replace_partner_calendar_holds(p_feed_id uuid, p_holds jsonb, p_read_at timestamptz)'));
    assert.ok(sql.includes('grant execute on function public.replace_partner_calendar_holds(uuid, jsonb, timestamptz) to service_role;'));
    assert.ok(sql.includes('revoke all on function public.replace_partner_calendar_holds(uuid, jsonb, timestamptz) from public, anon, authenticated;'));
  });
});
