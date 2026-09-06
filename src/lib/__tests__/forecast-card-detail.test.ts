/**
 * Where a card row lands on /forecast, and the escaped ampersand that once
 * put four AT&T bills on the wrong row.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isTelecom, routeCardRow } from '../forecast-card-detail.ts';
import { decodeHtmlEntities, categorizeOverhead, canonicalVendor } from '../overhead-categories.ts';

describe('decodeHtmlEntities', () => {
  test('unescapes the ampersand Chase writes into its card export', () => {
    assert.equal(decodeHtmlEntities('AT&amp;T MOBILITY EPAY'), 'AT&T MOBILITY EPAY');
    assert.equal(decodeHtmlEntities('CRATE&amp;BARREL CB2 NOD'), 'CRATE&BARREL CB2 NOD');
    assert.equal(decodeHtmlEntities('AT&#38;T BILL PAYMENT'), 'AT&T BILL PAYMENT');
    assert.equal(decodeHtmlEntities('AT&#x26;T BILL PAYMENT'), 'AT&T BILL PAYMENT');
  });

  test('leaves a clean description alone', () => {
    assert.equal(decodeHtmlEntities('GEICO  *AUTO'), 'GEICO  *AUTO');
    assert.equal(decodeHtmlEntities('SP FIX LINENS'), 'SP FIX LINENS');
    assert.equal(decodeHtmlEntities(''), '');
  });
});

describe('isTelecom', () => {
  test('matches the bill however Chase spelled it', () => {
    assert.equal(isTelecom('AT&T MOBILITY EPAY'), true);
    assert.equal(isTelecom('AT&T BILL PAYMENT'), true);
    assert.equal(isTelecom('ATT*BILL PAYMENT'), true);
    assert.equal(isTelecom('AT&AMP;T MOBILITY EPAY'), true);
    assert.equal(isTelecom('AT&AMP;T BILL PAYMENT'), true);
    assert.equal(isTelecom('AT&#38;T BILL PAYMENT'), true);
  });

  test('does not widen past telephone', () => {
    assert.equal(isTelecom('PURCHASE INTEREST CHARGE'), false);
    assert.equal(isTelecom('REPUBLIC SERVICES TRASH'), false);
    assert.equal(isTelecom('CRATE&AMP;BARREL CB2 NOD'), false);
  });
});

describe('routeCardRow', () => {
  test('an escaped AT&T bill lands on telecom, not travel_other', () => {
    assert.equal(routeCardRow('Other', 'AT&AMP;T MOBILITY EPAY'), 'telecom');
    assert.equal(routeCardRow('Other', 'AT&AMP;T BILL PAYMENT'), 'telecom');
    assert.equal(routeCardRow('Other', 'ATT*BILL PAYMENT'), 'telecom');
    assert.equal(routeCardRow('Other', 'PURCHASE INTEREST CHARGE'), 'travel_other');
  });

  test('the dumpster rides the Office line it is projected on', () => {
    assert.equal(routeCardRow('Rent & office', 'REPUBLIC SERVICES TRASH'), 'office');
  });
});

describe('categorizer sees the decoded name', () => {
  test('an escaped card description categorizes like the clean one', () => {
    const clean = categorizeOverhead({ account: 'card', description: 'CRATE&BARREL CB2 NOD', amount: -349.54, chaseCategory: 'Home' });
    const escaped = categorizeOverhead({ account: 'card', description: 'CRATE&amp;BARREL CB2 NOD', amount: -349.54, chaseCategory: 'Home' });
    assert.equal(escaped, clean);
  });

  test('the drill-down vendor label is the real name', () => {
    assert.equal(canonicalVendor('AT&amp;T MOBILITY EPAY'), canonicalVendor('AT&T MOBILITY EPAY'));
  });
});
