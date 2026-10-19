/**
 * Every tab name the property route has ever answered to still resolves.
 *
 * The record went from six tabs to four plus a conditional Setup. Nothing
 * about that is enforced by the type system: `?tab=` is a string, an unknown
 * value falls through to the first tab, and the failure is silent. A
 * bookmark, a server-action redirect or one of the 55 onboarding-catalog
 * links pointing at a retired name does not error, it just quietly lands
 * somewhere else, which is the hardest kind of breakage to notice.
 *
 * So this reads the alias map out of the page and asserts the whole history
 * is covered, and that the destinations are tabs that actually exist.
 *
 * It also guards RETURN_TABS in properties/actions.ts, the allowlist of
 * tabs an edit-form save may return to: every one must be a live tab.
 *
 * And the anchors: Guest & listing was rebuilt into open sections on
 * 2026-10-19, and a `#rates` that no longer matched an id would land at the
 * top of the tab, as silently as a dead tab name. So every ?tab=…#anchor
 * link in the repo that resolves to Guest & listing must hit an id the tab
 * renders, and the old section anchors must still exist.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const PAGE = 'src/app/properties/[id]/page.tsx';
const ACTIONS = 'src/app/properties/actions.ts';

/** The four that survive. Setup retired 2026-10-18 (Launch is the one list). */
const LIVE_TABS = new Set(['now', 'facts', 'owner', 'guest']);

/** Every name this route has answered to, across both restructures. */
const HISTORIC_TABS = [
  'today',
  'onboarding',
  'setup',
  'operations',
  'people',
  'growth',
  'records',
  'overview',
  'history',
  'documents',
  'deliverables',
];

function aliasMap(src: string): Record<string, string> {
  const block = src.slice(
    src.indexOf('const TAB_ALIASES'),
    src.indexOf('};', src.indexOf('const TAB_ALIASES')),
  );
  assert.ok(block.length > 0, 'TAB_ALIASES is gone from the property page');
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/^\s*([a-z]+):\s*'([a-z]+)',/gm)) out[m[1]] = m[2];
  return out;
}

describe('property tab aliases', () => {
  test('every retired tab name still maps somewhere', () => {
    const map = aliasMap(read(PAGE));
    for (const old of HISTORIC_TABS) {
      assert.ok(map[old], `?tab=${old} no longer resolves; deep links to it land on the first tab`);
    }
  });

  test('every alias points at a tab that exists', () => {
    const map = aliasMap(read(PAGE));
    for (const [from, to] of Object.entries(map)) {
      assert.ok(LIVE_TABS.has(to), `${from} -> ${to}, which is not a tab`);
    }
  });

  test('the live tabs are the ones the strip renders', () => {
    const src = read(PAGE);
    for (const id of LIVE_TABS) {
      assert.ok(
        src.includes(`<TabSection tab="${id}">`),
        `no <TabSection tab="${id}">, so anything aliased to it renders nothing`,
      );
    }
    // The six that are gone must not linger as panels, or a stale link would
    // reach a panel with no tab button to return from.
    for (const dead of ['today', 'onboarding', 'setup', 'operations', 'people', 'growth', 'records']) {
      assert.ok(!src.includes(`<TabSection tab="${dead}">`), `<TabSection tab="${dead}"> still exists`);
    }
  });

  test('RETURN_TABS agrees with the tabs that exist', () => {
    const src = read(ACTIONS);
    const m = src.match(/const RETURN_TABS = new Set\(\[([^\]]*)\]\)/);
    assert.ok(m, 'RETURN_TABS is gone from properties/actions.ts');
    const allowed = [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
    assert.ok(allowed.length > 0, 'RETURN_TABS is empty');
    for (const t of allowed) {
      assert.ok(LIVE_TABS.has(t), `RETURN_TABS allows '${t}', which is not a tab`);
    }
  });


  test('every link to a Guest & listing anchor lands on an element that exists', () => {
    const page = read(PAGE);
    const guest = page.slice(page.indexOf('<TabSection tab="guest">'), page.indexOf('</PropertyTabs>'));
    // What the tab renders: the page's sections, the listing's blocks, the
    // home guide form (a fold HashOpenScript opens).
    const sources = [guest, read('src/app/properties/[id]/ListingPanel.tsx'), read('src/components/properties/HomeGuideCustomizeForm.tsx')];
    const ids = new Set(sources.flatMap((src) => [...src.matchAll(/\bid="([a-z0-9-]+)"/g)].map((m) => m[1])));
    const prefixes = new Set(sources.flatMap((src) => [...src.matchAll(/\bid=\{`([a-z-]+-)\$\{/g)].map((m) => m[1])));

    // The anchors the old sections answered to, whether or not a link names them today.
    for (const anchor of ['listing', 'how-we-sell-it', 'guest-documents', 'guest-placards', 'home-guide-customize', 'rates', 'automations']) {
      assert.ok(ids.has(anchor), `#${anchor} no longer exists on Guest & listing`);
    }
    // ...and each lands on the section of that job.
    for (const [anchor, title] of [['listing', 'Listing'], ['guest-documents', 'Guest documents'], ['rates', 'Pricing'], ['automations', 'Automations']]) {
      assert.match(guest, new RegExp(`id="${anchor}"\\s+title="${title}"`), `#${anchor} is not the ${title} section`);
    }

    const map = aliasMap(page);
    const root = new URL('../../../src/', import.meta.url);
    const files = (readdirSync(root, { recursive: true }) as string[]).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('__tests__'));
    let checked = 0;
    for (const file of files) {
      const src = readFileSync(new URL(file, root), 'utf8');
      for (const m of src.matchAll(/\?tab=([a-z]+)#([a-z0-9-]+)/g)) {
        const tab = map[m[1]] ?? m[1];
        if (tab !== 'guest') continue;
        const anchor = m[2];
        checked++;
        assert.ok(ids.has(anchor) || prefixes.has(anchor), `src/${file}: ?tab=${m[1]}#${anchor} lands on nothing`);
      }
    }
    assert.ok(checked >= 15, `only ${checked} Guest & listing anchor links found; the scan is not reading the repo`);
  });
});
