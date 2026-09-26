/**
 * Both Quo paths resolve a cleaner's checkout the same way.
 *
 * A cleaner texts "done at 21 Horton" and Helm has to decide WHICH checkout
 * that finished. Two code paths do it: the live webhook (lib/quo-ingest.ts)
 * and the /api/sync-quo sweep, which is a parallel implementation rather
 * than the same pipeline.
 *
 * They had diverged. The webhook was moved onto `bookings` with the
 * confirmed/completed and canonical-row filters and an `asOf`, and its own
 * comment records why (guesty_reservations is wound down and can miss a
 * checkout that only lives in bookings). The sweep was left behind on the
 * old query: guesty_reservations, no status filter, no duplicate_of filter,
 * and always "today" rather than the message's own timestamp.
 *
 * The asOf is the one that bites hardest on the sweep, because the sweep is
 * a BACKFILL: without it, a three-week-old cleaner text files its completion
 * against whatever checkout is most recent now.
 *
 * Nothing here is enforced by types: both functions returned a date string,
 * so the two could answer differently forever without anything failing.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const INGEST = 'src/lib/quo-ingest.ts';
const SWEEP = 'src/app/api/sync-quo/route.ts';

describe('quo checkout resolution', () => {
  test('the sweep does not carry its own resolver', () => {
    const src = read(SWEEP);
    assert.ok(
      !/async function mostRecentCheckout\s*\(/.test(src),
      'sync-quo has defined its own mostRecentCheckout again. Two resolvers is how the two Quo ' +
        'paths started disagreeing about which checkout a cleaner text belongs to.',
    );
    // Match the symbol and its source, not the exact import line: other
    // shared helpers legitimately ride along in the same import (the
    // cleaner-issue slip writer does), and an exact-string assertion here
    // fails on a change that is entirely correct.
    assert.match(
      src,
      /import\s*\{[^}]*\bmostRecentCheckout\b[^}]*\}\s*from\s*'@\/lib\/quo-ingest'/,
      'sync-quo no longer imports the shared resolver from quo-ingest',
    );
  });

  test('the sweep passes the message timestamp, not today', () => {
    const src = read(SWEEP);
    assert.match(
      src,
      /mostRecentCheckout\(propertyId,\s*msg\.createdAt\)/,
      'sync-quo calls the resolver without an asOf. It sweeps Quo history, so a backfilled ' +
        'completion would land on whatever checkout is most recent now rather than the ' +
        'turnover it actually finished.',
    );
  });

  test('the shared resolver reads bookings, canonically, with a status filter', () => {
    const src = read(INGEST);
    const start = src.indexOf('export async function mostRecentCheckout');
    assert.notEqual(start, -1, 'mostRecentCheckout is no longer exported from quo-ingest');
    const body = src.slice(start, src.indexOf('\n}\n', start));

    assert.ok(body.includes(".from('bookings')"), 'the resolver left bookings');
    assert.ok(
      !body.includes('guesty_reservations'),
      'the resolver is back on guesty_reservations, which is wound down and can miss a checkout ' +
        'that only lives in bookings',
    );
    assert.ok(
      body.includes(".is('duplicate_of', null)"),
      'the resolver lost the canonical-row filter, so a superseded twin can win the sort',
    );
    assert.ok(
      body.includes("'confirmed'") && body.includes("'completed'"),
      'the resolver lost its status filter',
    );
    assert.match(body, /asOf/, 'the resolver lost its asOf, so a backfill cannot be dated');
  });
});
