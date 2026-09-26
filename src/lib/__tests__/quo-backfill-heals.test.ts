/**
 * The Quo safety net heals what it claims to heal.
 *
 * /api/cron/sync-quo runs every six hours and its own docblock states the
 * reason: the webhook is the ONLY live path, so a single missed delivery
 * silently drops a cleaner ping with no automatic recovery, and this re-pull
 * makes the feed self-heal.
 *
 * It did not. The sweep carries its own inbound handler rather than the
 * webhook's dispatcher, and that handler filed the cleaning completion but
 * never the work slip. So a cleaner texting "the dishwasher at 53 is broken"
 * during a missed delivery had the turnover marked done and the reported
 * problem thrown away, twice over: once by the missed webhook, once by the
 * net that exists to catch it.
 *
 * Safe to heal because the slip insert carries `from_quo_message_id`, which
 * has a unique index in production (checked 2026-09-26), so a message the
 * webhook already handled is swallowed as a 23505 replay.
 *
 * Owner stamping is deliberately still absent and this asserts that too, so
 * nobody adds it casually: it is last-write-wins on owner_last_contacted_at,
 * and a backfill walking history could move that timestamp BACKWARDS over a
 * newer live one.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const SWEEP = 'src/app/api/sync-quo/route.ts';
const INGEST = 'src/lib/quo-ingest.ts';

describe('quo backfill', () => {
  test('a cleaner-reported problem becomes a slip on the backfill path too', () => {
    const src = read(SWEEP);
    assert.ok(
      src.includes('createCleanerIssueSlip('),
      'the sync-quo sweep no longer files cleaner-issue slips, so a problem reported during a ' +
        'missed webhook delivery is lost by both the live path and the net meant to catch it',
    );
    assert.ok(
      src.includes('looksLikeIssue('),
      'the sweep files slips without the issue test, so every cleaner text becomes a work slip',
    );
  });

  test('both paths use the same slip writer, not two', () => {
    const sweep = read(SWEEP);
    assert.ok(
      sweep.includes("from '@/lib/quo-ingest'"),
      'the sweep stopped importing from quo-ingest, so it is free to grow its own slip writer',
    );
    assert.ok(
      !/function createCleanerIssueSlip\s*\(/.test(sweep),
      'the sweep has defined its own createCleanerIssueSlip. One writer, or the two paths drift ' +
        'again the way the checkout resolver did.',
    );
  });

  test('the slip writer stays idempotent on the Quo message id', () => {
    const src = read(INGEST);
    const start = src.indexOf('export async function createCleanerIssueSlip');
    assert.notEqual(start, -1, 'createCleanerIssueSlip is no longer exported');
    const body = src.slice(start, start + 2000);
    assert.ok(
      body.includes('from_quo_message_id'),
      'the slip no longer records from_quo_message_id, so the backfill would file a duplicate ' +
        'for every message the webhook already handled',
    );
  });

  test('owner stamping is forward only, in the writer not the callers', () => {
    const src = read(INGEST);
    const start = src.indexOf('export async function stampOwnerContact');
    assert.notEqual(start, -1, 'stampOwnerContact is no longer exported');
    const body = src.slice(start, src.indexOf('\n}\n', start));

    assert.match(
      body,
      /owner_last_contacted_at\.is\.null,owner_last_contacted_at\.lt\./,
      'stampOwnerContact lost its forward-only guard. It is a blind update again, so an ' +
        'out-of-order delivery, an event replay, or the six-hourly history sweep can set ' +
        'owner_last_contacted_at to an OLDER message than the one already recorded.',
    );
  });

  test('the backfill stamps owners, now that it is safe to', () => {
    const sweep = read(SWEEP);
    assert.ok(
      sweep.includes('stampOwnerContact('),
      'the sweep stopped stamping owner last-contacted, so an owner text that arrives during a ' +
        'missed webhook delivery never updates the column the owner queue reads',
    );
    assert.ok(
      !/async function stampOwnerContact\s*\(/.test(sweep),
      'the sweep defined its own stampOwnerContact, which would not carry the guard',
    );
  });

});
