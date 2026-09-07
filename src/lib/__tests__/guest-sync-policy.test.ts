/**
 * Which guests the nightly sync asks Guesty about.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decideGuest } from '../guest-sync-policy.ts';

const policy = { recheckCutoff: '2026-07-08', noEmailRecheckBefore: '2026-08-23T13:00:00.000Z' };

describe('decideGuest', () => {
  test('a guest already on the list is never fetched, whatever else is true', () => {
    assert.equal(decideGuest({ known: true, latestCheckOut: '2026-09-07', lastNoEmailCheckAt: null }, policy), 'known');
    assert.equal(decideGuest({ known: true, latestCheckOut: null, lastNoEmailCheckAt: null }, policy), 'known');
  });

  test('a guest whose last stay is long past is stale', () => {
    assert.equal(decideGuest({ known: false, latestCheckOut: '2025-08-01', lastNoEmailCheckAt: null }, policy), 'stale');
    assert.equal(decideGuest({ known: false, latestCheckOut: null, lastNoEmailCheckAt: null }, policy), 'stale');
  });

  test('a recent guest with a recent "no email" answer waits; an old answer is asked again', () => {
    const recent = { known: false, latestCheckOut: '2026-09-07', lastNoEmailCheckAt: '2026-09-05T13:02:00.000Z' };
    assert.equal(decideGuest(recent, policy), 'recently_checked');
    const old = { ...recent, lastNoEmailCheckAt: '2026-08-01T13:02:00.000Z' };
    assert.equal(decideGuest(old, policy), 'fetch');
  });

  test('a recent guest never asked about is fetched', () => {
    assert.equal(decideGuest({ known: false, latestCheckOut: '2026-09-07', lastNoEmailCheckAt: null }, policy), 'fetch');
    // A stay that lies ahead counts as recent.
    assert.equal(decideGuest({ known: false, latestCheckOut: '2026-12-20', lastNoEmailCheckAt: null }, policy), 'fetch');
  });

  test('the cutoff is inclusive on the stay date and on the check timestamp', () => {
    assert.equal(decideGuest({ known: false, latestCheckOut: '2026-07-08', lastNoEmailCheckAt: null }, policy), 'fetch');
    assert.equal(
      decideGuest({ known: false, latestCheckOut: '2026-07-08', lastNoEmailCheckAt: '2026-08-23T13:00:00.000Z' }, policy),
      'recently_checked',
    );
  });
});
