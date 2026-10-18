/**
 * One outfitting walkthrough per home, prospect to property (UI/UX audit
 * 2026-10-17, appendix 05: the readiness walk and the outfitting order were
 * "same groups, same taps, two tables").
 *
 * Run: npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { haveCounts, mergeLegacyStates, normalizeWalkthroughState, withHave, withNote } from '../home-walkthrough.ts';

const root = new URL('../../../', import.meta.url).pathname;
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const groups = [{ items: [{ label: 'Cups', count: 4 }, { label: 'Plates', count: 6 }, { label: 'Bath towels (large)', count: 10 }] }];

test('saved counts show, and a legacy checked label reads as all of it', () => {
  const state = normalizeWalkthroughState({ have: { Cups: 1 }, checked: ['Plates', 'Cups'], notes: { wifi: 'x' } });
  assert.deepEqual(haveCounts(state, groups), { Cups: 1, Plates: 6 });
});

test('the two retired stores fold the way the migration folds them: the property wins per key', () => {
  const merged = mergeLegacyStates(
    { have: { Cups: 2, Plates: 3 }, checked: ['Bath towels (large)'], notes: { supply_closet: 'Hall', wifi: 'Net' }, updated_at: '2026-09-01T00:00:00Z' },
    { have: { Plates: 6 }, notes: { supply_closet: 'Basement', order_notes: 'PO 12' }, updated_at: '2026-10-01T00:00:00Z' },
  );
  assert.deepEqual(merged.have, { Cups: 2, Plates: 6 });
  assert.deepEqual(merged.notes, { supply_closet: 'Basement', wifi: 'Net', order_notes: 'PO 12' });
  assert.deepEqual(merged.checked, ['Bath towels (large)']);
  assert.equal(merged.updated_at, '2026-10-01T00:00:00Z');
  assert.deepEqual(mergeLegacyStates(null, undefined), { have: {}, notes: {} });
});

test('a write sets one count (dropping its legacy tick) or one note', () => {
  const s = withHave({ have: { Cups: 1 }, checked: ['Cups', 'Plates'] }, 'Cups', 3.4);
  assert.deepEqual(s.have, { Cups: 3 });
  assert.deepEqual(s.checked, ['Plates']);
  assert.deepEqual(withHave({}, 'Cups', -2).have, { Cups: 0 });
  assert.deepEqual(withNote({ notes: { a: 'x' } }, 'a', '  ').notes, {});
  assert.deepEqual(withNote({}, 'b', 'y').notes, { b: 'y' });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name) && !rel.includes('__tests__')) out.push(rel);
  }
  return out;
}

test('nothing writes the retired stores; one page, one client, one table', () => {
  for (const file of walk('src')) {
    const src = read(file);
    assert.ok(!/update\(\{\s*readiness_state/.test(src), `${file} writes projections.readiness_state`);
    if (src.includes("from('property_order_checklist')")) {
      assert.equal(file, 'src/lib/home-walkthrough-db.ts', `${file} touches the retired property_order_checklist`);
      assert.ok(!/property_order_checklist'\)\s*\.(insert|update|upsert|delete)/.test(src));
    }
  }
  assert.ok(!existsSync(join(root, 'src/components/projections/ReadinessChecklistClient.tsx')));
  assert.ok(!existsSync(join(root, 'src/app/properties/[id]/order-checklist/OrderChecklistClient.tsx')));
  const count = read('src/app/prospects/[id]/readiness/page.tsx');
  const order = read('src/app/properties/[id]/order-checklist/page.tsx');
  for (const page of [count, order]) {
    assert.ok(page.includes('<OutfittingClient') && page.includes('<HelmMasthead />') && page.includes('<HelmBreadcrumb'));
    assert.ok(page.includes('loadWalkthrough('));
  }
  // The prospect's page follows the home once it is a property.
  assert.ok(count.includes('redirect(`/properties/${projection.property_id}/order-checklist`)'));
  assert.ok(count.includes("kind: 'counting'") && order.includes("kind: 'ordering'"));
  // Back links go to the home or the prospect, never a tab that may be gone.
  assert.ok(order.includes('backHref={`/properties/${id}`}') && count.includes('backHref={`/prospects/${id}`}'));
  // The review email reads the walkthrough, not the retired column.
  const email = read('src/lib/readiness-email.ts');
  assert.ok(email.includes('await loadWalkthrough(') && !email.includes('projection.readiness_state'));
});
