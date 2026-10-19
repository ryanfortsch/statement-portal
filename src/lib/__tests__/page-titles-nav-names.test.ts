/**
 * Page titles are the nav name (Phase 1 of the 2026-10-17 UI/UX audit).
 *
 * An operations page opens on the name of the tab or breadcrumb that led
 * there ("Contracts", "Channels"), or on the entity's own name for a detail
 * page, with no italic accent word and no explainer paragraph under it. The
 * one fact that earns a line ("18 live agreements across 22 homes.") rides
 * HelmHero's `line`. This reads each page's source and checks its hero.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = (repoPath: string): string => readFileSync(new URL(repoPath, root), 'utf8');

/** Every `<HelmHero ... />` element in a page, as source text. */
function heroes(src: string): string[] {
  const out: string[] = [];
  let at = src.indexOf('<HelmHero');
  while (at >= 0) {
    // The element ends at the first "/>" that closes it at depth zero.
    let depth = 0;
    let end = -1;
    for (let i = at + 1; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (depth === 0 && c === '/' && src[i + 1] === '>') {
        end = i + 2;
        break;
      }
    }
    assert.ok(end > at, 'an unterminated HelmHero');
    out.push(src.slice(at, end));
    at = src.indexOf('<HelmHero', end);
  }
  return out;
}

/** Page, and the title its hero must print (a literal, or an expression for a detail page). */
const PAGES: Array<[string, string]> = [
  ['src/app/properties/page.tsx', 'title="Properties"'],
  ['src/app/properties/prospects/page.tsx', 'title="Prospects"'],
  ['src/app/properties/contracts/page.tsx', 'title="Contracts"'],
  ['src/app/properties/stay-cape-ann/page.tsx', 'title="Stay Cape Ann listings"'],
  ['src/app/properties/[id]/stay-cape-ann/page.tsx', 'title={property.name}'],
  ['src/app/channels/page.tsx', 'title="Channels"'],
  ['src/app/channels/calendar/page.tsx', 'title="Multi-calendar"'],
  ['src/app/channels/bookings/page.tsx', 'title="Bookings"'],
  ['src/app/channels/bookings/new/page.tsx', "title={isBlock ? 'New block' : 'New booking'}"],
  ['src/app/channels/bookings/[id]/page.tsx', 'title={title}'],
  ['src/app/channels/[propertyId]/page.tsx', 'title={property.name}'],
  ['src/app/channels/[propertyId]/calendar/page.tsx', 'title={property.name}'],
  ['src/app/marketing/page.tsx', 'title="Marketing"'],
  ['src/app/marketing/airdna/page.tsx', 'title="AirDNA market data"'],
  ['src/app/competitors/page.tsx', 'title="Competitors"'],
  ['src/app/competitors/[id]/page.tsx', 'title={competitor.meta.name}'],
  ['src/app/payments/page.tsx', 'title="Stripe lookup"'],
  ['src/app/payments/balance-charges/page.tsx', 'title="Balance charges"'],
  ['src/app/books/[entity_id]/page.tsx', 'title={entity.short}'],
  ['src/app/books/accounts/page.tsx', 'title="Chart of accounts"'],
  ['src/app/revenue/page.tsx', 'title="Revenue"'],
];

for (const [page, title] of PAGES) {
  test(`${page} opens on its nav name, plain`, () => {
    const found = heroes(read(page));
    assert.ok(found.length > 0, 'no HelmHero');
    for (const hero of found) {
      assert.match(hero, /\splain[\s/]/, 'the hero is the plain page head');
      for (const gone of ['emphasis=', 'titleSuffix=', 'description=']) {
        assert.ok(!hero.includes(gone), `${gone} is back`);
      }
    }
    assert.ok(found[0].includes(title), `the first hero reads ${title}`);
  });
}

test('the plain head prints no accent and no paragraph of its own', () => {
  const src = read('src/components/HelmHero.tsx');
  const start = src.indexOf('if (plain)');
  const plain = src.slice(start, src.indexOf('\n  }\n  return (', start));
  assert.ok(start > 0 && plain.length > 100, 'the plain branch is found');
  assert.ok(plain.includes('{title}'));
  assert.ok(!plain.includes('<em'), 'no italic accent in the plain head');
  assert.ok(!plain.includes('description'), 'no explainer in the plain head');
});
