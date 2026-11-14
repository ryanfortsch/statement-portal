/**
 * A partner home's host asks to change their listing's words on
 * staycapeann.com/host/listing, and the office approves it first
 * (src/lib/partner-host-listing.ts, partner-host-listing-db.ts, the routes
 * under src/app/api/pms/host/listing/, the Partner home panel).
 *
 * These hold:
 *   - a host sees the record in their own terms (title, short summary,
 *     highlights, about, neighborhood) and sends only what changed, under
 *     the record's four columns and no others;
 *   - a phone number, an email or a link in any changed part is refused, so
 *     no host words carry a guest off staycapeann.com;
 *   - an untouched summary in another bullet style is not a change;
 *   - nothing reaches the listing before Approve: the host's routes write
 *     only partner_listing_proposals, and only Approve calls the listing
 *     editor's writer, with the four columns;
 *   - the guards spread across files: the bridge key first and the session
 *     header on every route, never a query string; one of the host's own
 *     homes only.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HOST_LISTING_COLUMNS,
  HOST_LISTING_LIMITS,
  approvalPatch,
  changedParts,
  cleanChanges,
  composeSummary,
  copyWithChanges,
  hostCopyOf,
  hostListingHome,
  listingApprovedEmail,
  listingDeclinedEmail,
  listingQueueCard,
  parseDeclineReason,
  parseHostListingEdit,
  type HostCopy,
  type ListingProposalRow,
} from '../partner-host-listing.ts';
import { splitSummary } from '../listing-copy-shape.ts';

const root = new URL('../../../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const code = (p: string): string =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const CONTENT = {
  title: 'Stay at the Point',
  summary: 'A shingled cottage at the end of the road, the harbor on three sides.\n\n• Water views from every room\n• Five minutes to Good Harbor',
  space: 'The living room opens to the deck.\n\n→ Two kayaks\n→ Outdoor shower',
  neighborhood: 'A quiet lane in East Gloucester.',
};
const LIVE: HostCopy = hostCopyOf(CONTENT, 'Stay at the Point');

const send = (over: Record<string, unknown> = {}) => ({
  title: LIVE.title,
  tagline: LIVE.tagline,
  highlights: LIVE.highlights.join('\n'),
  about: LIVE.about,
  neighborhood: LIVE.neighborhood,
  ...over,
});

const row = (over: Partial<ListingProposalRow> = {}): ListingProposalRow => ({
  id: 'p1',
  property_id: 'partner_home',
  host_email: 'host@example.com',
  changes: { title: 'Stay at Eastern Point' },
  before: { title: 'Stay at the Point' },
  note: null,
  status: 'pending',
  created_at: '2026-11-14T15:00:00.000Z',
  decided_at: null,
  decided_by: null,
  decline_reason: null,
  host_emailed_at: null,
  ...over,
});

describe('the host reads the record in their own terms', () => {
  test('summary splits into a short line and highlights', () => {
    assert.equal(LIVE.tagline, 'A shingled cottage at the end of the road, the harbor on three sides.');
    assert.deepEqual(LIVE.highlights, ['Water views from every room', 'Five minutes to Good Harbor']);
    assert.equal(LIVE.about, CONTENT.space);
  });
  test('no record yet: the home title, the rest empty', () => {
    assert.deepEqual(hostCopyOf(null, 'Stay at the Point'), { title: 'Stay at the Point', tagline: '', highlights: [], about: '', neighborhood: '' });
  });
  test('a composed summary reads back the same', () => {
    const s = composeSummary('A line.', ['One', 'Two']);
    assert.equal(s, 'A line.\n\n✓ One\n✓ Two');
    assert.deepEqual(splitSummary(s), { tagline: 'A line.', highlights: ['One', 'Two'] });
  });
});

describe('what a host sends', () => {
  test('nothing changed is refused, even with the summary in another bullet style', () => {
    const r = parseHostListingEdit(send(), LIVE);
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, /Nothing changed/);
  });
  test('whitespace alone is not a change', () => {
    const r = parseHostListingEdit(send({ title: `  ${LIVE.title}  `, about: `${LIVE.about}\r\n\r\n\r\n` }), LIVE);
    assert.equal(r.ok, false);
  });
  test('only the changed columns, with what they were', () => {
    const r = parseHostListingEdit(send({ title: 'Stay at Eastern Point', highlights: 'Water views from every room\n✓ Kayaks in the shed' }), LIVE);
    assert.ok(r.ok);
    assert.deepEqual(Object.keys(r.value.changes).sort(), ['summary', 'title']);
    assert.equal(r.value.changes.title, 'Stay at Eastern Point');
    assert.equal(r.value.before.title, 'Stay at the Point');
    assert.deepEqual(splitSummary(r.value.changes.summary).highlights, ['Water views from every room', 'Kayaks in the shed']);
  });
  test('clearing the neighborhood is a change to null', () => {
    const r = parseHostListingEdit(send({ neighborhood: '' }), LIVE);
    assert.ok(r.ok);
    assert.deepEqual(r.value.changes, { neighborhood: null });
  });
  test('the parts a listing needs cannot be cleared', () => {
    for (const [field, word] of [
      ['title', /title/],
      ['tagline', /short summary/],
      ['about', /about the home/i],
    ] as const) {
      const r = parseHostListingEdit(send({ [field]: '   ' }), LIVE);
      assert.equal(r.ok, false, field);
      assert.match((r as { reason: string }).reason, word);
    }
  });
  test('lengths', () => {
    assert.equal(parseHostListingEdit(send({ title: 'x'.repeat(HOST_LISTING_LIMITS.title + 1) }), LIVE).ok, false);
    assert.equal(parseHostListingEdit(send({ about: 'x'.repeat(HOST_LISTING_LIMITS.about + 1) }), LIVE).ok, false);
    assert.equal(parseHostListingEdit(send({ highlights: Array.from({ length: HOST_LISTING_LIMITS.highlights + 1 }, (_, i) => `H ${i}`) }), LIVE).ok, false);
    assert.equal(parseHostListingEdit(send({ highlights: ['x'.repeat(HOST_LISTING_LIMITS.highlight + 1)] }), LIVE).ok, false);
  });
  test('a phone number, an email or a link is refused in any part', () => {
    for (const bad of [
      { about: `${LIVE.about}\n\nText me at 978 555 1234 for a better rate.` },
      { neighborhood: 'Write to jo@example.com for directions.' },
      { tagline: 'See more at www.pointcottage.com' },
      { title: 'Stay at pointcottage.com' },
      { highlights: 'Book direct: https://example.org/point' },
    ]) {
      const r = parseHostListingEdit(send(bad), LIVE);
      assert.equal(r.ok, false, JSON.stringify(bad));
      assert.match((r as { reason: string }).reason, /Leave out phone numbers, emails and website links/);
    }
  });
  test('numbers that are not a phone are fine', () => {
    const r = parseHostListingEdit(send({ about: 'Built in 1890, 2,400 square feet, sleeps 8 across 4 bedrooms.' }), LIVE);
    assert.ok(r.ok);
  });
  test('the note to the office is kept and is not checked for contact', () => {
    const r = parseHostListingEdit(send({ title: 'Stay at Eastern Point', note: 'Call me at 978 555 1234 if anything is unclear.' }), LIVE);
    assert.ok(r.ok);
    assert.equal(r.value.note, 'Call me at 978 555 1234 if anything is unclear.');
  });
});

describe('what Approve writes', () => {
  test('the property and the four columns, nothing else', () => {
    const p = approvalPatch('partner_home', { title: 'T', space: 'S', amenities: ['x'], property_id: 'other', source: 'ai_draft' } as never);
    assert.deepEqual(p, { property_id: 'partner_home', title: 'T', space: 'S' });
    assert.deepEqual([...HOST_LISTING_COLUMNS], ['title', 'summary', 'space', 'neighborhood']);
  });
  test('a stored jsonb is cleaned to the four columns', () => {
    assert.deepEqual(cleanChanges({ title: 'T', neighborhood: null, space: 4, hero_photo_id: 'x' }), { title: 'T', neighborhood: null });
    assert.deepEqual(cleanChanges(null), {});
  });
});

describe('what the host sees', () => {
  test('while it waits: their copy laid over the listing, the parts named', () => {
    const h = hostListingHome({ id: 'partner_home', title: 'Stay at the Point' }, LIVE, row(), null);
    assert.equal(h.pending?.copy.title, 'Stay at Eastern Point');
    assert.equal(h.pending?.copy.about, LIVE.about);
    assert.deepEqual(h.pending?.parts, ['the title']);
    assert.equal(h.last, null);
  });
  test('the last answer, once nothing waits', () => {
    const declined = row({ status: 'declined', decided_at: '2026-11-14T16:00:00.000Z', decline_reason: 'Keep the title to the street.' });
    const h = hostListingHome({ id: 'partner_home', title: 'Stay at the Point' }, LIVE, null, declined);
    assert.deepEqual(h.last, { status: 'declined', decided_at: '2026-11-14T16:00:00.000Z', reason: 'Keep the title to the street.', parts: ['the title'] });
    const withdrawn = row({ status: 'withdrawn', decided_at: '2026-11-14T16:00:00.000Z' });
    assert.equal(hostListingHome({ id: 'partner_home', title: null }, LIVE, null, withdrawn).last, null);
  });
  test('copyWithChanges reads a changed summary back into its parts', () => {
    const c = copyWithChanges(LIVE, { summary: composeSummary('New line.', ['A']) });
    assert.equal(c.tagline, 'New line.');
    assert.deepEqual(c.highlights, ['A']);
    assert.equal(c.title, LIVE.title);
  });
  test('the parts in words', () => {
    assert.deepEqual(changedParts({ title: 'x', summary: 'y', space: 'z', neighborhood: null }), ['the title', 'the summary and highlights', 'about the home', 'the neighborhood']);
  });
});

describe('the office', () => {
  test('a decline needs a reason', () => {
    assert.equal(parseDeclineReason('  ').ok, false);
    assert.equal(parseDeclineReason('x'.repeat(HOST_LISTING_LIMITS.declineReason + 1)).ok, false);
    assert.deepEqual(parseDeclineReason(' Too long for the card. '), { ok: true, value: 'Too long for the card.' });
  });
  test('the queue card: one home to its panel, several to the list', () => {
    assert.equal(listingQueueCard([], () => null), null);
    assert.deepEqual(listingQueueCard([{ property_id: 'a' }, { property_id: 'a' }], () => '5 Point'), {
      href: '/properties/a#partner-listing-change',
      text: 'Listing change from a host to review: 5 Point',
    });
    assert.deepEqual(listingQueueCard([{ property_id: 'a' }, { property_id: 'b' }], () => null), {
      href: '/guests/requests#partner-homes',
      text: 'Listing changes from hosts: 2 homes to review',
    });
  });
  test('the emails link the host listing page and carry the reason', () => {
    const ok = listingApprovedEmail('Stay at the Point', ['the title'], 'https://staycapeann.com/');
    assert.match(ok.subject, /are live/);
    assert.match(ok.text, /https:\/\/staycapeann\.com\/host\/listing/);
    const no = listingDeclinedEmail('Stay at the Point', ['the title', 'about the home'], 'Keep <it> short.', 'https://staycapeann.com');
    assert.match(no.text, /the title and about the home/);
    assert.match(no.text, /Why: Keep <it> short\./);
    assert.match(no.html, /Keep &lt;it&gt; short\./);
  });
});

describe('the guards', () => {
  const ROUTES = ['src/app/api/pms/host/listing/route.ts', 'src/app/api/pms/host/listing/withdraw/route.ts'];
  test('every route: the bridge key first, the session from the header, no query string', () => {
    for (const f of ROUTES) {
      const src = code(f);
      const handlers = src.split(/export async function (?:GET|POST)/).slice(1);
      assert.ok(handlers.length > 0, `${f}: handlers found`);
      for (const h of handlers) {
        const key = h.indexOf('authorizeStayConcierge(req)');
        const session = h.indexOf('hostForSession(req.headers.get(HOST_SESSION_HEADER))');
        assert.ok(key > -1 && session > key, `${f}: key then session`);
      }
      assert.doesNotMatch(src, /searchParams|nextUrl/, `${f}: no query string`);
    }
  });

  const db = code('src/lib/partner-host-listing-db.ts');
  const fn = (name: string): string => {
    const start = db.indexOf(`export async function ${name}(`);
    assert.ok(start > -1, `${name} found`);
    const end = db.indexOf('\nexport ', start + 1);
    return db.slice(start, end === -1 ? undefined : end);
  };

  test('the host writes only proposals, and only on one of their homes', () => {
    for (const name of ['hostProposeListing', 'hostWithdrawListing']) {
      const body = fn(name);
      assert.match(body, /homeOf\(session, rawPropertyId\)/, `${name}: their home`);
      assert.doesNotMatch(body, /upsertListingContent|property_listing_content/, `${name}: never the listing`);
    }
    assert.match(fn('hostProposeListing'), /parseHostListingEdit\(body, live\)/);
    assert.match(db, /session\.homes\.find\(\(h\) => h\.id === rawPropertyId\)/);
  });

  test('only Approve writes the listing, through the editor writer, with the four columns', () => {
    const writers = db.match(/upsertListingContent\(/g) ?? [];
    assert.equal(writers.length, 1);
    const approve = fn('approveListingProposal');
    assert.match(approve, /upsertListingContent\(patch, by\)/);
    assert.match(approve, /approvalPatch\(row\.property_id, row\.changes\)/);
    assert.match(approve, /row\.property_id !== propertyId/);
  });

  test('the panel verbs need a signed-in team member', () => {
    const actions = code('src/app/properties/[id]/partner-actions.ts');
    for (const name of ['approveListingChangeAction', 'declineListingChangeAction']) {
      const start = actions.indexOf(`export async function ${name}(`);
      assert.ok(start > -1, name);
      const body = actions.slice(start, actions.indexOf('\nexport ', start + 1) === -1 ? undefined : actions.indexOf('\nexport ', start + 1));
      assert.match(body, /const by = await signedIn\(\);\s*if \(!by\) return/);
    }
  });

  test('the migration grants itself and keeps one pending per home', () => {
    const sql = read('supabase/migrations/20261114010000_partner_listing_proposals.sql');
    assert.match(sql, /enable row level security/);
    assert.match(sql, /grant select, insert, update, delete on public\.partner_listing_proposals to service_role/);
    assert.match(sql, /unique index[\s\S]*\(property_id\)\s*where status = 'pending'/);
  });

  test('no em dashes', () => {
    for (const f of ['src/lib/partner-host-listing.ts', 'src/lib/partner-host-listing-db.ts', ...ROUTES]) {
      assert.doesNotMatch(read(f), /\u2014/, f);
    }
  });
});
