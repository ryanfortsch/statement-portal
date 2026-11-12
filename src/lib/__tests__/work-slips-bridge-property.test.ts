import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolvePropertyIdFromSlug } from '../payment-links-text.ts';

// The concierge's work-slip bridge keys a home by the concierge's own slug.
// Anne's two paid 3 South nights (2026-11-12) came in as 3_south_street, the
// route looked the id up exactly, answered "skipped", and neither Guesty slip
// reached the board. The route now resolves the slug the way every other
// bridge does before it gives up.

const ROUTE = readFileSync(new URL('../../app/api/work-slips/route.ts', import.meta.url), 'utf8');

test('work-slips bridge: a concierge slug lands on the Helm home', () => {
  const ids = ['3_south_st', '3_windward', '7_sumac', '19_rackliffe', '53_rocky_neck', '53_rocky_neck_2'];
  assert.equal(resolvePropertyIdFromSlug('3_south_street', ids), '3_south_st');
  assert.equal(resolvePropertyIdFromSlug('3_windward_pt', ids), '3_windward');
  assert.equal(resolvePropertyIdFromSlug('7_sumac', ids), '7_sumac');
  assert.equal(resolvePropertyIdFromSlug('53_rocky_neck_2', ids), '53_rocky_neck_2');
  // A home Helm does not have stays unknown; it is never guessed onto another.
  assert.equal(resolvePropertyIdFromSlug('11_rockholm', ids), null);
});

test('work-slips bridge: the route resolves before it skips', () => {
  assert.match(ROUTE, /import \{ resolvePropertyIdFromSlug \} from '@\/lib\/payment-links-text'/);
  const resolveAt = ROUTE.indexOf('resolvePropertyIdFromSlug(sentPropertyId');
  const skipAt = ROUTE.indexOf('skipped: true');
  assert.ok(resolveAt > 0 && skipAt > resolveAt, 'slug resolution must run before the skip');
  // The bare exact lookup was the bug; it must not come back as the only test.
  assert.doesNotMatch(ROUTE, /\.eq\('id', propertyId\)\s*\.maybeSingle\(\)/);
  // Every write after the lookup uses the resolved id, never the sent slug.
  assert.doesNotMatch(ROUTE, /property_id: sentPropertyId/);
  assert.doesNotMatch(ROUTE, /\.eq\('property_id', sentPropertyId\)/);
  // A skip is logged, so a miss is visible on Helm's side too.
  assert.match(ROUTE, /console\.warn\(`work-slips: skipped/);
});
