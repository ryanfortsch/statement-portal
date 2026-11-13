/**
 * Partner homes never reach Rising Tide's operations.
 *
 * A partner home (properties.kind = 'partner') is a Cape Ann home listed on
 * staycapeann.com and run by its own host. Rising Tide does not clean it,
 * inspect it, message its guests, bill it or pay it out. It rides
 * is_active = false, as prospect and HQ rows do, and a database constraint
 * keeps it there, so every surface that filters is_active skips it.
 *
 * What this file holds:
 *   - the gate itself (isPartnerHome, isCapeAnnOps, runsGuestsInHelm);
 *   - the migration's two constraints;
 *   - no reader names kinds negatively ("not managed" admits a partner home);
 *   - no reader opts partner homes into a kind list except the booking path;
 *   - every roster read of the properties table (one that lists homes rather
 *     than looking one up by id) filters is_active or kind, or is listed in
 *     REVIEWED with why a partner home cannot leak through it. A new roster
 *     read that does neither fails here: filter it, or list it with its
 *     reason.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capeAnnIds, isCapeAnnOps, isPartnerHome, PARTNER_KIND, runsGuestsInHelm } from '../property-scope.ts';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** Source with // and block comments removed, so a comment cannot satisfy a rule. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const files = sourceFiles(join(repo, 'src')).map((full) => ({ rel: relative(repo, full), src: code(full) }));

describe('the gate', () => {
  test('isPartnerHome reads the kind', () => {
    assert.equal(PARTNER_KIND, 'partner');
    assert.equal(isPartnerHome({ kind: 'partner' }), true);
    assert.equal(isPartnerHome({ kind: 'managed' }), false);
    assert.equal(isPartnerHome({ kind: null }), false);
    assert.equal(isPartnerHome({}), false);
  });

  test('a partner home in Cape Ann is never Cape Ann ops', () => {
    assert.equal(isCapeAnnOps({ region: 'cape_ann', kind: 'partner' }), false);
    assert.equal(isCapeAnnOps({ region: null, kind: 'partner' }), false);
    assert.equal(isCapeAnnOps({ region: 'cape_ann', kind: 'managed' }), true);
    assert.equal(isCapeAnnOps({ region: 'cape_ann', kind: null }), true);
    assert.equal(isCapeAnnOps({ region: 'bridgeport_ct', kind: 'managed' }), false);
  });

  test('Helm holds a partner calendar but never answers its guests', () => {
    assert.equal(runsGuestsInHelm({ calendar_authority: 'helm', kind: 'managed' }), true);
    assert.equal(runsGuestsInHelm({ calendar_authority: 'helm', kind: 'partner' }), false);
    assert.equal(runsGuestsInHelm({ calendar_authority: 'guesty', kind: 'managed' }), false);
  });

  test('capeAnnIds drops partner homes', () => {
    const rows = [
      { id: '21_horton', region: 'cape_ann', kind: 'managed' },
      { id: 'partner_home', region: 'cape_ann', kind: 'partner' },
    ];
    assert.deepEqual([...capeAnnIds(rows)], ['21_horton']);
  });
});

test('the migration allows partner and keeps it inactive and not ours', () => {
  const sql = readFileSync(join(repo, 'supabase/migrations/20261112200000_property_kind_partner.sql'), 'utf8');
  assert.match(sql, /check \(kind in \('managed', 'prospect', 'hq', 'partner'\)\)/);
  assert.match(sql, /check \(kind <> 'partner' or \(is_active = false and is_rising_tide_owned = false\)\)/);
});

test('no reader names kinds negatively', () => {
  // "kind is not managed" admits a partner home along with prospect and HQ.
  // Name the kinds you mean (the Field loader: kind.in.(prospect,hq)). The
  // one negative allowed is "not a partner", which is the guard itself.
  const negative = /kind\.neq\.(?!partner\b)|\.neq\(\s*['"]kind['"]\s*,(?!\s*['"]partner['"])/;
  const offenders = files.filter((f) => negative.test(f.src)).map((f) => f.rel);
  assert.deepEqual(offenders, []);
});

test('the negative-kind check catches what it bans and allows the guard', () => {
  const negative = /kind\.neq\.(?!partner\b)|\.neq\(\s*['"]kind['"]\s*,(?!\s*['"]partner['"])/;
  assert.ok(negative.test(".or('is_active.eq.true,kind.neq.managed')"));
  assert.ok(negative.test(".neq('kind', 'managed')"));
  assert.ok(!negative.test(".neq('kind', 'partner')"));
  assert.ok(!negative.test("kind.neq.partner"));
});

/**
 * The only files that may put partner homes into a kind filter. Empty until
 * the booking path (the PMS bridge and the staycapeann.com listing feed)
 * opts them in; add each such file here with the change that needs it.
 */
const PARTNER_OPT_IN: Record<string, string> = {
  'src/lib/pms-bridge.ts':
    'the staycapeann.com fleet list, only when the caller passes include=partner; the create path refuses partner homes (partner_not_bookable)',
  'src/lib/partner-host-db.ts':
    "a host's sign-in and their requests on staycapeann.com: reads partner homes only, to match the host's email to their own homes",
  'src/lib/partner-host-email.ts':
    'tells a partner home\'s host a request landed: reads that one partner home, so only a partner home ever emails a host',
};

const OPT_IN = /kind\.in\.\([^)]*partner|kind\.eq\.(partner\b|\$\{PARTNER_KIND\})|\.in\(\s*['"]kind['"]\s*,\s*\[[^\]]*['"]partner['"]|kinds\s*:\s*\[[^\]]*['"]partner['"]|\.eq\(\s*['"]kind['"]\s*,\s*(['"]partner['"]|PARTNER_KIND)/;

test('only the booking path opts partner homes in', () => {
  const offenders = files
    .filter((f) => OPT_IN.test(f.src) && !(f.rel in PARTNER_OPT_IN))
    .map((f) => f.rel);
  assert.deepEqual(offenders, []);
  for (const rel of Object.keys(PARTNER_OPT_IN)) {
    assert.ok(OPT_IN.test(files.find((f) => f.rel === rel)?.src ?? ''), `${rel} is listed as opting partner homes in but no longer does; drop it from PARTNER_OPT_IN`);
  }
});

test('the opt-in check sees every way of naming partner homes', () => {
  for (const s of [
    ".in('kind', ['managed', 'partner'])",
    ".eq('kind', 'partner')",
    ".eq('kind', PARTNER_KIND)",
    "kind.in.(managed,partner)",
    "and(is_active.eq.true,kind.eq.managed),kind.eq.partner",
    "kind.eq.${PARTNER_KIND}",
    "kinds: ['partner']",
  ]) {
    assert.ok(OPT_IN.test(s), s);
  }
  assert.ok(!OPT_IN.test(".neq('kind', 'partner')"));
});

test('the bridge lists partner homes only on request and never books one', () => {
  const src = files.find((f) => f.rel === 'src/lib/pms-bridge.ts')?.src ?? '';
  assert.match(src, /opts\.includePartners \? `and\(is_active\.eq\.true,kind\.eq\.managed\),kind\.eq\.\$\{PARTNER_KIND\}` : 'and\(is_active\.eq\.true,kind\.eq\.managed\)'/);
  const create = src.slice(src.indexOf('export async function createReservationFromBridge('), src.indexOf('async function afterCreate('));
  const guard = create.indexOf("error: 'partner_not_bookable'");
  assert.ok(guard > 0, 'createReservationFromBridge refuses a partner home');
  assert.ok(guard < create.indexOf('findBySourceRef(sourceRef)'), 'the refusal comes before anything is read or written');
  // The picker and every default caller pass no includePartners.
  assert.ok(src.includes("let props = await listBridgeProperties('helm');"));
  const route = files.find((f) => f.rel === 'src/app/api/pms/properties/route.ts')?.src ?? '';
  assert.ok(route.includes("url.searchParams.get('include') === 'partner'"));
});

/* ---------------------------------------------------------------------------
 * Roster reads of the properties table.
 *
 * A roster read lists homes. A partner row is is_active = false, so a read
 * that filters is_active (or names the kinds it wants) skips it. A read that
 * looks one home up by key (id, Guesty listing id, projection id, a single
 * row) lists nothing. Everything else is here, with why a partner home
 * cannot leak through it. The count is how many such reads the file holds.
 * ------------------------------------------------------------------------- */

const NAME_MAP = 'an id-to-name (or region) lookup that labels rows read from another table; it lists no home';
const BOOKING_PATH = 'booking path: partner homes need a calendar and an export here when they are opted in';

const REVIEWED: Record<string, [number, string]> = {
  'src/app/api/cron/stripe-disputes/route.ts': [1, NAME_MAP],
  'src/app/api/messaging/queue/route.ts': [1, NAME_MAP],
  'src/app/api/sync-guesty/route.ts': [1, 'maps Guesty listings to homes; a partner home has no Guesty listing'],
  'src/app/crm/[id]/page.tsx': [1, 'the CRM property picker: a partner host is someone we work with (the funnel)'],
  'src/app/crm/page.tsx': [1, 'the CRM property picker: a partner host is someone we work with (the funnel)'],
  'src/app/fieldwork/shoots/actions.ts': [2, 'a title check and a lookup of the picked home; a shoot is a paid service a partner may buy'],
  'src/app/me/page.tsx': [1, NAME_MAP],
  'src/app/messaging/quality/page.tsx': [1, 'names homes on concierge threads; a partner home has none'],
  'src/app/projections/actions.ts': [1, 'an id collision check for a new prospect id'],
  'src/app/properties/trash-notices/page.tsx': [1, 'isTrashNoticeHome keeps active managed Gloucester homes'],
  'src/app/search/page.tsx': [2, 'Cmd+K finds every registry row on purpose and opens its property page; the second is a name map'],
  'src/app/statements/actions.ts': [1, 'owner config keyed by the id of a statement; a partner home has no statement'],
  'src/app/work/organize-actions.ts': [1, NAME_MAP],
  'src/components/ConciergeAlerts.tsx': [1, NAME_MAP],
  'src/components/ForMeFeed.tsx': [1, NAME_MAP],
  'src/components/TeamActivity.tsx': [2, 'a name map, and owner last-contacted activity: a partner host is someone we talk to'],
  'src/lib/calendar-days.ts': [1, 'the known-home guard for Guesty calendar rows; ' + BOOKING_PATH],
  'src/lib/channels.ts': [1, BOOKING_PATH],
  'src/lib/cleaner-digest.ts': [1, NAME_MAP + '; the schedule it scopes skips inactive homes'],
  'src/lib/cleaning-schedule.ts': [1, NAME_MAP],
  'src/lib/field-work-board.ts': [1, NAME_MAP],
  'src/lib/finance-backfill.ts': [1, 'writes only bookings matched to a Guesty reservation; a partner home has none'],
  'src/lib/fleet.ts': [1, 'builds the query in steps: is_active, then kinds, defaulting to managed'],
  'src/lib/guests-guesty-sync.ts': [1, NAME_MAP],
  'src/lib/guesty-backfill.ts': [1, 'guards the foreign key; it writes only Guesty reservations, and a partner home has none'],
  'src/lib/ical-sync.ts': [1, BOOKING_PATH],
  'src/lib/known-numbers-server.ts': [1, 'names a texting number by its household; a partner host who texts should be named'],
  'src/lib/maintenance-runs.ts': [1, NAME_MAP],
  'src/lib/marketing/queries.ts': [1, 'names site listings by Guesty listing id; a partner home has none'],
  'src/lib/messages-to-slips.ts': [1, NAME_MAP],
  'src/lib/mine-checkout-changes.ts': [1, 'names homes on concierge threads; a partner home has none'],
  'src/lib/open-work-for.ts': [1, NAME_MAP],
  'src/lib/organize-work-slips.ts': [1, NAME_MAP],
  'src/lib/partner-listing-db.ts': [1, 'an id collision check for a new partner home id'],
  'src/lib/payment-links.ts': [1, NAME_MAP],
  'src/lib/pms-guards.ts': [1, 'strict dedupe for Helm calendars; ' + BOOKING_PATH],
  'src/lib/reservation-gap-backfill.ts': [1, 'counts Guesty-run homes\' cached Guesty reservations; a partner home has none'],
  'src/lib/search.ts': [2, 'Cmd+K finds every registry row on purpose and opens its property page; the second is a name map'],
  'src/lib/turnover-notes.ts': [1, NAME_MAP],
  'src/lib/work-briefs.ts': [1, NAME_MAP],
};

function skipString(s: string, i: number): number {
  const q = s[i];
  i++;
  while (i < s.length && s[i] !== q) {
    if (s[i] === '\\') i++;
    i++;
  }
  return i + 1;
}

/** The method chain right after .from('properties'): .select(...).eq(...)... */
function chainAfter(s: string, start: number): string {
  let i = start;
  for (;;) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] === '?' && s[i + 1] === '.') i++;
    if (s[i] !== '.') break;
    i++;
    while (i < s.length && /[\w$]/.test(s[i])) i++;
    if (s[i] !== '(') break;
    let depth = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === "'" || c === '"' || c === '`') {
        i = skipString(s, i);
        continue;
      }
      if (c === '(') depth++;
      if (c === ')') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
      i++;
    }
  }
  return s.slice(start, i);
}

const WRITE = /^\s*\.(update|insert|upsert|delete)\(/;
const FILTERED = /is_active|\bkind\b|\.eq\(\s*['"]is_rising_tide_owned['"]\s*,\s*true/;
const BY_KEY = /\.(eq|in)\(\s*['"](id|guesty_listing_id|projection_id)['"]|\.(maybeSingle|single)\(/;

function rosterReads(src: string): number {
  let n = 0;
  for (const m of src.matchAll(/\.from\(\s*['"]properties['"]\s*\)/g)) {
    const chain = chainAfter(src, (m.index ?? 0) + m[0].length);
    if (WRITE.test(chain) || FILTERED.test(chain) || BY_KEY.test(chain)) continue;
    n++;
  }
  return n;
}

describe('roster reads of the properties table', () => {
  test('the scanner tells a roster read from a filtered or keyed one', () => {
    assert.equal(rosterReads("sb.from('properties').select('id, name').order('name');"), 1);
    assert.equal(rosterReads("sb.from('properties').select('id').eq('is_active', true);"), 0);
    assert.equal(rosterReads("sb.from('properties').select('id').neq('kind', 'partner');"), 0);
    assert.equal(rosterReads("sb.from('properties').select('*').eq('id', id).maybeSingle();"), 0);
    assert.equal(rosterReads("sb.from('properties').update({ name }).eq('id', id);"), 0);
    // The chain ends where the call ends: a filter on the next query in a
    // Promise.all does not cover this one.
    assert.equal(rosterReads("Promise.all([sb.from('properties').select('id, name'), sb.from('bookings').select('id').eq('is_active', true)]);"), 1);
  });

  test('every roster read filters is_active or kind, or is reviewed', () => {
    const found: Record<string, number> = {};
    for (const f of files) {
      const n = rosterReads(f.src);
      if (n > 0) found[f.rel] = n;
    }
    const unreviewed = Object.keys(found).filter((rel) => !(rel in REVIEWED));
    assert.deepEqual(unreviewed, [], 'filter these with is_active or kind, or add them to REVIEWED with why a partner home cannot leak');
    for (const [rel, [count]] of Object.entries(REVIEWED)) {
      assert.equal(found[rel] ?? 0, count, `${rel}: REVIEWED counts ${count} roster reads, the file has ${found[rel] ?? 0}. Review the change.`);
    }
  });
});
