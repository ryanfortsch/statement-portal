/**
 * A quote's record reads as sentences, not a column dump.
 *
 * The quote detail page used to end on an "Audit" block of about twenty
 * snake_case rows with raw ISO timestamps (created_at, accept_ip,
 * guesty_listing_id). It now says what happened in plain sentences, as the
 * agreement page does, and keeps the ids behind "Show ids".
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../../app/guests/quotes/[id]/page.tsx', import.meta.url), 'utf8');

test('no snake_case label prints on the quote page', () => {
  for (const raw of ['created_at', 'updated_at', 'accept_ip', 'guesty_listing_id', 'terms_version', 'balance_paid_at', 'status']) {
    assert.ok(!page.includes(`<div>${raw}:`), `${raw} prints as a label again`);
  }
});

test('the record is sentences, the ids folded', () => {
  assert.ok(page.includes('{quoteRecordSentences(q).join(\' \')}'));
  assert.ok(page.includes('>Show ids</summary>'));
});
