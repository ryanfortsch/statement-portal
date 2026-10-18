/**
 * The one Growth strip.
 *
 * Growth used to stack the masthead, a Growth strip, a hero and a Guests
 * strip, each rendered by the page, so the second strip appeared on four of
 * eighteen routes and jumped between siblings. Now the three Growth layouts
 * render one strip and no page draws chrome of its own. This checks the
 * tab each path lights, that the layouts own the chrome, and that no page
 * brings it back.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { growthTabFor } from '../growth-tabs.ts';

const root = new URL('../../../', import.meta.url);
const read = (repoPath: string): string => readFileSync(new URL(repoPath, root), 'utf8');

function pagesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(new URL(rel, root))) {
      const child = `${rel}/${name}`;
      if (statSync(new URL(child, root)).isDirectory()) walk(child);
      else if (name === 'page.tsx') out.push(child);
    }
  };
  walk(dir);
  return out;
}

describe('which tab a Growth path lights', () => {
  const cases: Array<[string, ReturnType<typeof growthTabFor>]> = [
    ['/marketing', 'marketing'],
    ['/marketing/airdna', 'marketing'],
    ['/guests', 'reviews'],
    ['/guests/', 'reviews'],
    ['/guests/contacts', 'contacts'],
    ['/guests/0b9c3e7a-uuid', 'contacts'],
    ['/guests/campaigns', 'contacts'],
    ['/guests/campaigns/new', 'contacts'],
    ['/guests/agreements', 'agreements'],
    ['/guests/agreements/new', 'agreements'],
    ['/guests/agreements/abc', 'agreements'],
    ['/guests/agreements/abc/edit', 'agreements'],
    ['/guests/quotes', 'quotes'],
    ['/guests/quotes/abc/edit', 'quotes'],
    ['/competitors', 'competitors'],
    ['/competitors/atlantic-vacation-homes', 'competitors'],
    // The document preview prints as the guest's PDF: no chrome at all.
    ['/guests/agreements/abc/doc', null],
  ];
  for (const [path, tab] of cases) {
    test(`${path} -> ${tab}`, () => assert.equal(growthTabFor(path), tab));
  }
  test('Reviews lights only on the bare /guests, never on a guest record', () => {
    assert.notEqual(growthTabFor('/guests/abc'), 'reviews');
  });
});

describe('the Growth layouts own the chrome', () => {
  test('one strip, six tabs, in reading order, Quotes handed to SectionTabs', () => {
    const src = read('src/components/GrowthTabs.tsx');
    const labels = [...src.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(labels, ['Marketing', 'Reviews', 'Contacts', 'Agreements', 'Quotes', 'Competitors']);
    assert.ok(src.includes('<SectionTabs'), 'the strip is a SectionTabs wrapper, so the role filter applies');
    assert.ok(!src.includes("label: 'Guests'"), 'no tab is called Guests');
  });

  for (const dir of ['guests', 'marketing', 'competitors']) {
    test(`src/app/${dir}/layout.tsx renders the Growth frame`, () => {
      const src = read(`src/app/${dir}/layout.tsx`);
      assert.ok(src.includes('<GrowthFrame masthead={<HelmMasthead />}>{children}</GrowthFrame>'));
    });
  }

  test('the old per-page strips are gone', () => {
    assert.ok(!existsSync(new URL('src/components/MarketingTabs.tsx', root)));
    assert.ok(!existsSync(new URL('src/app/guests/GuestsTabBar.tsx', root)));
  });

  const pages = ['src/app/guests', 'src/app/marketing', 'src/app/competitors'].flatMap(pagesUnder);
  test('the Growth pages were found', () => assert.ok(pages.length >= 15, `only ${pages.length} pages`));
  for (const page of pages) {
    test(`${page} draws no chrome of its own`, () => {
      const src = read(page);
      for (const chrome of ['HelmMasthead', 'MarketingTabs', 'GuestsTabBar', 'min-h-screen']) {
        assert.ok(!src.includes(chrome), `${page} still renders ${chrome}; the Growth layout owns it`);
      }
    });
  }

  test('Contacts, Agreements and Quotes open on their lists, with no hero', () => {
    for (const page of ['src/app/guests/contacts/page.tsx', 'src/app/guests/agreements/page.tsx', 'src/app/guests/quotes/page.tsx', 'src/app/guests/page.tsx']) {
      const src = read(page);
      assert.ok(!src.includes('HelmHero') && !src.includes('<h1'), `${page} still has a hero`);
    }
  });

  test('Reviews opens on 30 days, the window the Marketing five-star tile reads', () => {
    const src = read('src/app/guests/ReviewsTab.tsx');
    assert.ok(src.includes('const DEFAULT_WINDOW: WindowDays = 30;'));
    assert.ok(src.includes(': DEFAULT_WINDOW;'));
  });
});
