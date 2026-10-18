/**
 * Guest gear is a fact about the homes, so it lives under Properties.
 *
 * The UI/UX audit of 2026-10-17 found the guest gear grid (which home holds
 * which pack 'n play or high chair, and where) as a tab in the daily Work
 * strip, beside the board and the maintenance runs: a reference table in
 * the place people go to do today's work. Phase 3 moved it to a Guest gear
 * tab on the Properties strip and left Work as Board and Maintenance. Each
 * guard below is a line in a different file, so this reads the source.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { HELM_MODULES } from '../helm-modules.ts';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');
const exists = (repoPath: string): boolean => existsSync(new URL(`../../../${repoPath}`, import.meta.url));

describe('the gear grid moved to Properties', () => {
  test('the Work strip is Board and Maintenance', () => {
    const strip = read('src/components/WorkTabs.tsx');
    const hrefs = [...strip.matchAll(/href: '([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(hrefs, ['/work', '/work/maintenance']);
    assert.ok(!exists('src/app/work/gear/page.tsx'), 'a gear page is back under Work');
  });

  test('Properties has a Guest gear tab and page', () => {
    assert.ok(exists('src/app/properties/guest-gear/page.tsx'));
    const bar = read('src/app/properties/PropertiesTabBar.tsx');
    assert.ok(bar.includes("{ id: 'guest-gear' as const, label: 'Guest gear', href: '/properties/guest-gear' },"));
    assert.ok(read('src/app/properties/guest-gear/page.tsx').includes('<PropertiesTabBar active="guest-gear" />'));
  });

  test('the atlas files it under Properties so search finds it there', () => {
    const gear = HELM_MODULES.find((m) => m.id === 'gear');
    assert.ok(gear, 'the gear module is in the atlas');
    assert.equal(gear!.href, '/properties/guest-gear');
    assert.equal(gear!.section, 'properties');
    assert.equal(gear!.title, 'Guest gear');
  });

  test('old links land on the same grid', () => {
    const config = read('next.config.ts');
    assert.ok(/source: '\/work\/gear',\s*destination: '\/properties\/guest-gear',\s*permanent: true,/.test(config));
    for (const f of ['src/app/properties/guest-gear/actions.ts', 'src/app/field/actions.ts']) {
      assert.ok(read(f).includes("revalidatePath('/properties/guest-gear');"), `${f} refreshes the old path`);
    }
  });
});
