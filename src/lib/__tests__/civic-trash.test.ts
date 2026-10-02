/**
 * The Gloucester cart rule, pinned.
 *
 * Gloucester collects with automated Casella carts. Two things have to hold:
 *
 *  1. A Gloucester cart sentence never reaches Rockport (no curbside at all)
 *     or Beverly (its own program, its own specs).
 *  2. The curb return survives every rewrite. Sec. 5-66(q) fines $400 per
 *     occurrence for a cart left out, chained to the rental permit.
 *
 * Plus the street-matcher regressions the cutover audit surfaced: three live
 * Gloucester homes had no collection day on any surface.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  civicForProperty,
  receptacleRuleFor,
  GLOUCESTER_CART_RULE,
} from '../civic.ts';
import type { HelmPropertyRow } from '../properties.ts';

/** Minimal property row. Only the fields civicForProperty reads matter. */
function prop(over: Partial<HelmPropertyRow>): HelmPropertyRow {
  return {
    id: 'test',
    name: 'Test',
    address: '',
    city: 'Gloucester, MA',
    trash_day: null,
    recycling_day: null,
    parking_regulations: null,
    ...over,
  } as HelmPropertyRow;
}

test('the cart rule carries the clauses that cost money, and nothing retired', () => {
  // "come back in" is Sec. 5-66(q), $400 per occurrence. "Lids closed" and
  // "nothing left beside a cart" are why overflow gets the house skipped.
  assert.equal(receptacleRuleFor('Gloucester'), GLOUCESTER_CART_RULE);
  assert.match(GLOUCESTER_CART_RULE, /night before pickup/);
  assert.match(GLOUCESTER_CART_RULE, /come back in/);
  assert.match(GLOUCESTER_CART_RULE, /lids closed/);
  assert.match(GLOUCESTER_CART_RULE, /beside a cart is collected/);
  // The bag program is gone (2026-09-30); no surface may mention it.
  assert.doesNotMatch(GLOUCESTER_CART_RULE, /purple|bags? only/i);
  // House style.
  assert.doesNotMatch(GLOUCESTER_CART_RULE, /—/);
});

test('Gloucester cart wording never leaks to Rockport or Beverly', () => {
  const rockport = receptacleRuleFor('Rockport')!;
  assert.match(rockport, /no curbside collection/);
  assert.doesNotMatch(rockport, /cart/i, 'Rockport has no curbside collection');

  const beverly = receptacleRuleFor('Beverly')!;
  assert.doesNotMatch(beverly, /65/, 'Beverly runs its own cart specs');

  // A city we have no confirmed rule for prints nothing rather than guessing.
  assert.equal(receptacleRuleFor('Somerville'), null);
});

test('two of the three dark Gloucester homes now resolve a collection day', () => {
  // Both had no day on any Helm surface before the cutover audit, and both are
  // single unambiguous rows on the DPW list, checked against it on 2026-09-25.
  // "3 Windward Pt" is the live DB spelling; the list says "windward point",
  // and "pt" was in neither the strip regex nor the synthesis list.
  assert.equal(civicForProperty(prop({ address: '3 Windward Pt' })).trashDay, 'Friday');
  assert.equal(civicForProperty(prop({ address: '7 Sumac Lane' })).trashDay, 'Friday');
});

test('a street the route splits refuses to answer', () => {
  // The DPW list carries "Thatcher Road Fri" AND "Thatcher Road Mon" with no
  // segment note. The table is an object literal, so the duplicate key kept
  // whichever came last and the Information Note printed that as fact. A
  // wrong day puts a cart at the curb for the rest of the week at $400 per
  // occurrence, so the lookup declines and the surface says to confirm.
  assert.equal(civicForProperty(prop({ address: '84 Thatcher Road' })).trashDay, null);
  assert.equal(civicForProperty(prop({ address: '12 Atlantic Road' })).trashDay, null);
  assert.equal(civicForProperty(prop({ address: '12 Main Street' })).trashDay, null);

  // An operator who has actually phoned DPW for one address still wins.
  assert.equal(
    civicForProperty(prop({ address: '84 Thatcher Road', trash_day: 'Friday' })).trashDay,
    'Friday',
  );
});

test('a unit suffix after a comma does not break the street lookup', () => {
  // The suffix pass is end-anchored, so "53 Rocky Neck, Downstairs" used to
  // miss the "rocky neck avenue" key entirely.
  const sub = civicForProperty(prop({ address: '53 Rocky Neck, Downstairs' }));
  assert.equal(sub.trashDay, 'Friday');
});

test('an exact street beats the suffix-synthesis guess', () => {
  // The synthesis pass strips a suffix and tries common ones in order, so on a
  // stem with several entries it answers with whichever it reaches first.
  // These four all used to come back wrong. Resolving the real key first, with
  // a trailing period and an abbreviation both normalized, is what fixes it.
  const day = (address: string) => civicForProperty(prop({ address })).trashDay;

  assert.equal(day('12 Beach Ct'), 'Tuesday'); // not Monday, via 'beach road'
  assert.equal(day('12 Norwood Heights.'), 'Friday'); // not Monday, via 'norwood court'
  // The published list carries both spellings for some streets and they do not
  // agree. The exact key wins rather than the expansion.
  assert.equal(day('12 Patriots Cir'), 'Wednesday'); // 'patriots circle' is Friday
  // And an abbreviated-only key with nothing to expand into still resolves.
  assert.equal(day('12 Mason Sq.'), 'Thursday');
});

test('a no-service sentinel never prints as a weekday', () => {
  // The DPW list carries a literal "None" on one street, and operators have
  // typed "NA" and "DUMP" into the column for homes with no curbside service.
  assert.equal(civicForProperty(prop({ address: '1 Blackburn Drive' })).trashDay, null);
  assert.equal(civicForProperty(prop({ trash_day: 'NA', city: 'Rockport, MA' })).trashDay, null);
  assert.equal(civicForProperty(prop({ trash_day: 'DUMP', city: 'Rockport, MA' })).trashDay, null);
});

test('an overridden trash day moves recycling with it', () => {
  // Gloucester is single-stream, same day. The recycling fallback used to
  // read the raw street lookup, so an override printed two different days.
  const c = civicForProperty(prop({ address: '84 Thatcher Road', trash_day: 'Tuesday' }));
  assert.equal(c.trashDay, 'Tuesday');
  assert.equal(c.recyclingDay, 'Tuesday');
});

test('civicForProperty carries the receptacle rule for its own city', () => {
  const g = civicForProperty(prop({ address: '21 Horton Street' }));
  assert.equal(g.receptacleRule, GLOUCESTER_CART_RULE);

  const r = civicForProperty(prop({ address: '3 South Street', city: 'Rockport, MA' }));
  assert.doesNotMatch(r.receptacleRule!, /cart/i);
});
