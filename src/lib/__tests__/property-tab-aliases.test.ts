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
 * It also guards the pair that has to agree across two files: the Setup
 * "Edit field" links send `return=setup`, and RETURN_TABS in
 * properties/actions.ts allowlists what a save is allowed to return to. If
 * those drift, saving from a Setup deep link lands the operator on Facts
 * instead of where they came from.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const PAGE = 'src/app/properties/[id]/page.tsx';
const ACTIONS = 'src/app/properties/actions.ts';

/** The four that survive, plus the one that comes and goes. */
const LIVE_TABS = new Set(['now', 'facts', 'owner', 'guest', 'setup']);

/** Every name this route has answered to, across both restructures. */
const HISTORIC_TABS = [
  'today',
  'onboarding',
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
    for (const dead of ['today', 'onboarding', 'operations', 'people', 'growth', 'records']) {
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

  test('the Setup edit-return value is one RETURN_TABS accepts', () => {
    const page = read(PAGE);
    const m = page.match(/return=([a-z]+)\$\{hash/);
    assert.ok(m, 'editHrefWithReturn no longer sets a return tab');
    const sent = m[1];
    const allowed = read(ACTIONS).match(/const RETURN_TABS = new Set\(\[([^\]]*)\]\)/);
    assert.ok(allowed);
    assert.ok(
      allowed[1].includes(`'${sent}'`),
      `Setup sends return=${sent} but RETURN_TABS does not allow it, so a save lands on the fallback tab`,
    );
  });
});
