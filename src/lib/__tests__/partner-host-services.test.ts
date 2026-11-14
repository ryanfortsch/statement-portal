/**
 * A partner home's host asks about one of our paid services on
 * staycapeann.com/host/services, and an owner answers with the price
 * (src/lib/partner-host-services.ts, partner-host-services-db.ts, the routes
 * under src/app/api/pms/host/services/, the Partner home panel).
 *
 * These hold:
 *   - the menu is the four rungs, the same four the database allows; the
 *     walk is not one (it is free, before a home lists) and neither is full
 *     management, and the words are Stay Cape Ann's, never Rising Tide's;
 *   - an ask is a question: nothing here books, schedules or charges;
 *   - a host asks only on one of their own homes, an owner answers only an
 *     ask on the home in front of them, and only once;
 *   - the answer is a price, so it is owners only end to end: the actions,
 *     the panel's section, the page's read, the feed's line;
 *   - the bridge key first and the session header on every route, never a
 *     query string.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PARTNER_SERVICES,
  SERVICE_ASK_LIMITS,
  hostServicesHome,
  isPartnerService,
  parseServiceAsk,
  parseServiceReply,
  serviceOf,
  serviceQueueCard,
  serviceReplyEmail,
  type ServiceAskRow,
} from '../partner-host-services.ts';

const root = new URL('../../../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const code = (p: string): string =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const MIGRATION = 'supabase/migrations/20261114020000_partner_service_asks.sql';
const MENU_MIGRATION = 'supabase/migrations/20261114030000_partner_service_asks_walk_free.sql';
const DB = 'src/lib/partner-host-services-db.ts';
const ROUTE = 'src/app/api/pms/host/services/route.ts';
const WITHDRAW = 'src/app/api/pms/host/services/withdraw/route.ts';
const ACTIONS = 'src/app/properties/[id]/partner-actions.ts';
const PANEL = 'src/app/properties/[id]/PartnerHomePanel.tsx';
const PAGE = 'src/app/properties/[id]/page.tsx';
const FEED = 'src/components/ForMeFeed.tsx';

function row(over: Partial<ServiceAskRow> = {}): ServiceAskRow {
  return {
    id: 'a1',
    property_id: 'partner_home',
    host_email: 'host@example.com',
    service: 'photo_shoot',
    note: null,
    status: 'open',
    created_at: '2026-11-14T15:00:00.000Z',
    reply: null,
    answered_at: null,
    answered_by: null,
    host_emailed_at: null,
    closed_at: null,
    closed_by: null,
    ...over,
  };
}

describe('the menu', () => {
  test('the four rungs above listing, in ladder order', () => {
    assert.deepEqual(PARTNER_SERVICES.map((s) => s.key), ['photo_shoot', 'guest_app', 'turnovers', 'guest_messages']);
  });

  test('the database allows exactly the same four', () => {
    const src = read(MENU_MIGRATION);
    const checks = [...src.matchAll(/check \(service in \(([^)]*)\)\)/g)].map((m) => m[1].split(',').map((s) => s.trim().replace(/'/g, '')));
    assert.equal(checks.length, 2, 'the validated and the not-valid branch');
    for (const allowed of checks) assert.deepEqual(allowed, PARTNER_SERVICES.map((s) => s.key));
    assert.match(src, /drop constraint partner_service_asks_service_check/);
    assert.doesNotMatch(src, /\bdelete\b/i, 'an old walk ask is closed and kept, never deleted');
  });

  test('the walk is free: every partner home gets it before it lists, so a host cannot ask about it', () => {
    assert.equal(isPartnerService('verified_walk'), false);
    assert.ok(!PARTNER_SERVICES.some((s) => /walk|verified/i.test(`${s.key} ${s.name} ${s.line}`)));
    assert.equal(parseServiceAsk({ service: 'verified_walk' }).ok, false);
  });

  test('the words are Stay Cape Ann\'s: Rising Tide is the name owners know, never guests', () => {
    assert.ok(!PARTNER_SERVICES.some((s) => /rising tide/i.test(`${s.name} ${s.phrase} ${s.line}`)));
    const email = serviceReplyEmail('Stay at the Point', 'photo_shoot', '$400, the week of May 12.', 'https://staycapeann.com');
    assert.doesNotMatch(JSON.stringify(email), /rising tide/i);
  });

  test('full management is not a button: we see how a home books first, and a manager is never offered it', () => {
    assert.equal(isPartnerService('full_management'), false);
    assert.ok(!PARTNER_SERVICES.some((s) => /manage/i.test(`${s.key} ${s.name} ${s.line}`)));
  });

  test('every service has a name, a phrase for a sentence and one line', () => {
    for (const s of PARTNER_SERVICES) {
      assert.ok(s.name && s.phrase && s.line, s.key);
      assert.equal(s.phrase.charAt(0), s.phrase.charAt(0).toLowerCase(), `${s.key}: the phrase reads mid-sentence`);
      assert.ok(s.line.endsWith('.'), s.key);
    }
    assert.equal(serviceOf('photo_shoot').phrase, 'a photo shoot');
  });
});

describe('the host asks', () => {
  test('a known service and a note', () => {
    assert.deepEqual(parseServiceAsk({ service: 'guest_app', note: '  Before June, please.\r\n\r\n\r\nThanks  ' }), {
      ok: true,
      value: { service: 'guest_app', note: 'Before June, please.\n\nThanks' },
    });
  });

  test('no note is no note', () => {
    assert.deepEqual(parseServiceAsk({ service: 'turnovers', note: '   ' }), { ok: true, value: { service: 'turnovers', note: null } });
    assert.deepEqual(parseServiceAsk({ service: 'turnovers' }), { ok: true, value: { service: 'turnovers', note: null } });
  });

  test('an unknown service is refused in the host\'s words', () => {
    for (const service of ['full_management', '', null, 7, 'PHOTO_SHOOT']) {
      const r = parseServiceAsk({ service });
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, 'Pick a service to ask about.');
    }
  });

  test('a note too long is refused, not cut', () => {
    const r = parseServiceAsk({ service: 'photo_shoot', note: 'x'.repeat(SERVICE_ASK_LIMITS.note + 1) });
    assert.equal(r.ok, false);
    assert.ok(parseServiceAsk({ service: 'photo_shoot', note: 'x'.repeat(SERVICE_ASK_LIMITS.note) }).ok);
  });
});

describe('an owner answers', () => {
  test('the answer is required and kept as written', () => {
    assert.equal(parseServiceReply('  ').ok, false);
    assert.deepEqual(parseServiceReply('$400 for the shoot.\r\nWe can come May 12.'), { ok: true, value: '$400 for the shoot.\nWe can come May 12.' });
    assert.equal(parseServiceReply('x'.repeat(SERVICE_ASK_LIMITS.reply + 1)).ok, false);
  });

  test('the email carries the answer word for word, from the home, to the host\'s services page', () => {
    const e = serviceReplyEmail('Stay at the Point', 'photo_shoot', '$400 for the shoot <b>.\n\nWe can come May 12.', 'https://staycapeann.com/');
    assert.equal(e.subject, 'About a photo shoot for The Point');
    assert.ok(e.text.includes('$400 for the shoot <b>.'));
    assert.ok(e.text.includes('We can come May 12.'));
    assert.ok(e.text.includes('https://staycapeann.com/host/services'));
    assert.ok(e.html.includes('&lt;b&gt;'), 'the html is escaped');
    assert.ok(!e.html.includes('<b>'));
  });
});

describe('what the host sees', () => {
  const home = { id: 'partner_home', title: 'Stay at the Point' };

  test('every service, in order, and nothing asked yet', () => {
    const h = hostServicesHome(home, []);
    assert.equal(h.title, 'The Point');
    assert.deepEqual(h.services.map((s) => s.key), PARTNER_SERVICES.map((s) => s.key));
    assert.ok(h.services.every((s) => s.ask === null));
  });

  test('a waiting ask shows without a reply; an answered one shows ours', () => {
    const h = hostServicesHome(home, [
      row({ id: 'w', service: 'photo_shoot', note: 'Before June', reply: 'draft not sent' }),
      row({ id: 'r', service: 'guest_app', status: 'answered', reply: '$150 a year.', answered_at: '2026-11-14T16:00:00.000Z' }),
    ]);
    const shoot = h.services.find((s) => s.key === 'photo_shoot');
    const app = h.services.find((s) => s.key === 'guest_app');
    assert.deepEqual(shoot?.ask, { id: 'w', status: 'open', asked_at: '2026-11-14T15:00:00.000Z', note: 'Before June', reply: null, answered_at: null });
    assert.equal(app?.ask?.reply, '$150 a year.');
    assert.equal(app?.ask?.answered_at, '2026-11-14T16:00:00.000Z');
  });

  test('a closed or withdrawn ask is gone, and another home\'s ask never shows', () => {
    const h = hostServicesHome(home, [
      row({ service: 'photo_shoot', status: 'closed' }),
      row({ service: 'guest_app', status: 'withdrawn' }),
      row({ service: 'turnovers', property_id: 'other_home' }),
    ]);
    assert.ok(h.services.every((s) => s.ask === null));
  });
});

describe('the owners\' queue line', () => {
  const name = (id: string) => (id === 'a' ? '12 Point' : null);

  test('nothing waiting, no line', () => {
    assert.equal(serviceQueueCard([], name), null);
  });

  test('one home goes to its panel, saying how many', () => {
    assert.deepEqual(serviceQueueCard([{ property_id: 'a' }], name), { href: '/properties/a#partner-services', text: 'A host asked about a service: 12 Point' });
    assert.deepEqual(serviceQueueCard([{ property_id: 'a' }, { property_id: 'a' }], name), {
      href: '/properties/a#partner-services',
      text: 'A host asked about 2 services: 12 Point',
    });
  });

  test('several homes go to the partner homes list', () => {
    assert.deepEqual(serviceQueueCard([{ property_id: 'a' }, { property_id: 'b' }], name), {
      href: '/guests/requests#partner-homes',
      text: 'Hosts asked about services: 2 homes to answer',
    });
  });
});

describe('guards spread across files', () => {
  test('both routes check the bridge key first and read the session from its header', () => {
    for (const f of [ROUTE, WITHDRAW]) {
      const src = code(f);
      for (const verb of f === ROUTE ? ['GET', 'POST'] : ['POST']) {
        const body = src.slice(src.indexOf(`export async function ${verb}`));
        const key = body.indexOf('authorizeStayConcierge(req)');
        const session = body.indexOf('hostForSession(req.headers.get(HOST_SESSION_HEADER))');
        assert.ok(key > -1 && session > key, `${f} ${verb}`);
      }
      assert.doesNotMatch(src, /searchParams|nextUrl/, `${f}: no query string`);
    }
  });

  test('a host asks and withdraws only on one of their own homes', () => {
    const src = code(DB);
    for (const fn of ['hostAskService', 'hostWithdrawService']) {
      const body = src.slice(src.indexOf(`export async function ${fn}`));
      const own = body.indexOf('homeOf(session, rawPropertyId)');
      const write = body.search(/\.(insert|update)\(/);
      assert.ok(own > -1 && own < write, fn);
    }
    assert.match(src, /session\.homes\.find\(\(h\) => h\.id === rawPropertyId\)/);
  });

  test('an owner answers only an ask on this home, and only once', () => {
    const src = code(DB);
    const body = src.slice(src.indexOf('export async function answerServiceAsk'), src.indexOf('export async function closeServiceAsk'));
    assert.match(body, /row\.property_id !== propertyId/);
    assert.match(body, /\.eq\('status', 'open'\)/);
    const close = src.slice(src.indexOf('export async function closeServiceAsk'));
    assert.match(close, /row\.property_id !== propertyId/);
  });

  test('nothing here books, schedules or charges', () => {
    const src = code(DB);
    assert.doesNotMatch(src, /from\('(bookings|booking_requests|property_calendar_days|property_rate_days|partner_payment_accounts|work_slips|inspection_plans)'\)/);
    assert.doesNotMatch(src, /stripe|payment|charge/i);
    for (const f of [ROUTE, WITHDRAW]) assert.doesNotMatch(code(f), /stripe|payment|booking/i, f);
  });

  test('the answer is a price, so it is owners only end to end', () => {
    const actions = code(ACTIONS);
    for (const fn of ['answerServiceAskAction', 'closeServiceAskAction']) {
      const body = actions.slice(actions.indexOf(`export async function ${fn}`));
      const owner = body.indexOf('await requireOwnerEmail()');
      const write = body.search(/await (answerServiceAsk|closeServiceAsk)\(/);
      assert.ok(owner > -1 && owner < write, fn);
    }
    assert.match(code(PAGE), /partnerSetup && owner \? await officeServiceAsks\(p\.id\)/);
    assert.match(code(PANEL), /\{owner && serviceAsks && serviceAsks\.length > 0 && <ServiceAsks/);
    assert.match(code(FEED), /owner \? loadServiceAskQueue\(\) : null/);
  });

  test('the table is service role only, with one live ask per home and service', () => {
    const m = read(MIGRATION);
    assert.match(m, /enable row level security/);
    assert.match(m, /grant select, insert, update, delete on public\.partner_service_asks to service_role/);
    assert.match(m, /revoke all on public\.partner_service_asks from anon, authenticated/);
    assert.match(m, /unique index[\s\S]*\(property_id, service\)[\s\S]*where status in \('open', 'answered'\)/);
  });

  test('no em dashes in what this adds', () => {
    const dash = String.fromCharCode(0x2014);
    for (const f of ['src/lib/partner-host-services.ts', DB, ROUTE, WITHDRAW, MIGRATION]) assert.ok(!read(f).includes(dash), f);
  });
});
