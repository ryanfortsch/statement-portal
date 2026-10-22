/**
 * A cleaner's text Helm could not place on a house reaches a person, and
 * placing it writes what a placed text writes.
 *
 * Until 2026-10-22 an unplaced "done" threw inside the Quo ingest and
 * landed in quo_events.process_error, which no page reads: two completions
 * were lost in one week. The pure rules are tested directly; the wiring
 * (the ingest files the text, the home feed shows it, Attach goes through
 * the matched path's own writer) is read from the source, because it is
 * spread across four files and each line is easy to drop.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { attachChoices, textDay, textLine, unfiledTextError, worthFiling } from '../cleaner-unplaced.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

/** The body of a top-level function, from its declaration to the first
 *  closing brace at column 0. */
function fnBody(src: string, decl: string): string {
  const start = src.indexOf(decl);
  assert.notEqual(start, -1, `${decl} is gone`);
  return src.slice(start, src.indexOf('\n}\n', start));
}

const HOMES = [
  { id: '3_south_st', name: '3 South' },
  { id: '21_horton', name: '21 Horton' },
  { id: '53_rocky_neck', name: '53 Rocky Neck' },
  { id: '4_middle', name: '4 Middle' },
  { id: '225_washington', name: '225 Washington' },
];

describe('the house picker', () => {
  test('the homes that checked out that day lead, the cleaner\'s own first', () => {
    const c = attachChoices({
      properties: HOMES,
      checkedOut: ['53_rocky_neck', '21_horton', '225_washington'],
      cleanerHomes: ['225_washington'],
    });
    assert.deepEqual(c.likely.map((h) => h.name), ['225 Washington', '21 Horton', '53 Rocky Neck']);
    assert.deepEqual(c.rest.map((h) => h.name), ['3 South', '4 Middle']);
  });

  test('every house is offered: the text failed precisely when the obvious answer was missing', () => {
    const c = attachChoices({ properties: HOMES, checkedOut: [], cleanerHomes: ['21_horton'] });
    assert.equal(c.likely.length, 0);
    assert.equal(c.rest.length, HOMES.length);
    // Numeric order, the way staff read street numbers.
    assert.deepEqual(c.rest.map((h) => h.name), ['3 South', '4 Middle', '21 Horton', '53 Rocky Neck', '225 Washington']);
  });

  test('a checkout at a house that is not active is not offered', () => {
    const c = attachChoices({ properties: HOMES, checkedOut: ['4_brier_neck'], cleanerHomes: [] });
    assert.equal(c.likely.length, 0);
  });
});

describe('the row', () => {
  test('a 9 PM text belongs to that evening, not the UTC tomorrow', () => {
    // 2026-10-20 21:00 EDT is 2026-10-21 01:00Z.
    assert.equal(textDay('2026-10-21T01:00:00Z'), '2026-10-20');
    assert.equal(textDay('2026-10-20T15:12:00Z'), '2026-10-20');
  });

  test('the text is one line, clipped', () => {
    assert.equal(textLine('done\n\n  all set   at the yellow house'), 'done all set at the yellow house');
    const long = textLine('x'.repeat(200), 20);
    assert.equal(long.length, 20);
    assert.ok(long.endsWith('…'));
  });

  test('only a completion or a problem is filed; chatter is not', () => {
    assert.equal(worthFiling({ issue: false, completion: true }), true);
    assert.equal(worthFiling({ issue: true, completion: false }), true);
    assert.equal(worthFiling({ issue: false, completion: false }), false);
  });

  test('the fallback error names the message id and nothing a person said', () => {
    const msg = unfiledTextError('AC123', 'relation does not exist');
    assert.match(msg, /AC123/);
    assert.ok(!/\d{3}\D?\d{3}\D?\d{4}/.test(msg));
  });
});

describe('the wiring', () => {
  const ingest = read('src/lib/quo-ingest.ts');
  const action = read('src/app/turnovers/unplaced-cleaner-actions.ts');

  test('a placed text and an attached text go through one writer', () => {
    const inbound = fnBody(ingest, 'async function handleInboundMessage');
    assert.match(inbound, /if \(propertyId\) \{\s*await recordCleanerText\(/, 'the matched path no longer calls recordCleanerText');
    assert.ok(action.includes("import { recordCleanerText } from '@/lib/quo-ingest';"), 'Attach does not use the ingest writer');
    assert.match(action, /await recordCleanerText\(\{/, 'Attach no longer calls recordCleanerText');
    // No second copy of the completion write anywhere near Attach.
    assert.ok(!action.includes("from('cleaning_completions')"), 'Attach writes cleaning_completions itself');
    assert.ok(!action.includes("from('cleaning_sessions')"), 'Attach writes cleaning_sessions itself');
  });

  test('the writer keeps the completion, the forward-only finish and the issue slip', () => {
    const writer = fnBody(ingest, 'export async function recordCleanerText');
    assert.ok(writer.includes("from('cleaning_completions')"), 'the completion row is gone');
    assert.ok(writer.includes('completed_at: at'), 'the completion is no longer the text\'s own time');
    assert.ok(writer.includes("source: 'quo'"), 'the completion source moved off quo');
    assert.ok(writer.includes('source_message_id: messageId'), 'the completion lost its idempotency key');
    assert.ok(writer.includes('mirrorQuoFinish(supabase, { propertyId, completedAt: at })'), 'the session finish is gone');
    assert.ok(writer.includes('createCleanerIssueSlip('), 'a reported problem no longer opens a slip');

    const mirror = fnBody(read('src/lib/cleaning-sessions.ts'), 'export async function mirrorQuoFinish');
    assert.ok(mirror.includes('finished_at.is.null,finished_at.lt.'), 'the Quo finish can move backwards');
    assert.ok(mirror.includes('finish_source.is.null,finish_source.neq.manual'), 'the Quo finish can overwrite an operator');
  });

  test('Attach never stamps the tap time or a manual finish', () => {
    const attach = fnBody(action, 'export async function attachUnplacedCleanerTextAction');
    const call = attach.slice(attach.indexOf('recordCleanerText({'), attach.indexOf('});', attach.indexOf('recordCleanerText({')));
    assert.ok(call.includes('at: text.message_at'), 'Attach records the tap, not the text\'s time');
    assert.ok(!attach.includes('confirmCleaningDone'), 'Attach writes a manual finish, which outranks every later signal');
  });

  test('Attach claims the text before it writes, so one clean never lands on two houses', () => {
    const attach = fnBody(action, 'export async function attachUnplacedCleanerTextAction');
    const claim = attach.indexOf(".eq('status', 'open')");
    assert.notEqual(claim, -1, 'the claim lost its open-only filter');
    assert.ok(claim < attach.indexOf('await recordCleanerText('), 'the write runs before the claim');
  });

  test('an unplaced completion or issue is filed, never thrown with what the cleaner said', () => {
    const inbound = fnBody(ingest, 'async function handleInboundMessage');
    const cleaner = inbound.slice(inbound.indexOf('const cleanerHit'), inbound.indexOf('// 2. Contact-touch path.'));
    assert.ok(cleaner.includes('await fileUnplacedCleanerText(cleanerHit, msg, body)'), 'the unplaced text is not filed');
    assert.ok(!/^\s*throw\b/m.test(cleaner), 'the cleaner path throws again');
    const file = fnBody(ingest, 'async function fileUnplacedCleanerText');
    assert.ok(file.includes("from('cleaner_unplaced_texts')"));
    assert.ok(file.includes("onConflict: 'quo_message_id', ignoreDuplicates: true"), 'a replay could reopen a placed text');
  });

  test('the home feed shows it under Cleanings to check', () => {
    const feed = read('src/components/ForMeFeed.tsx');
    assert.ok(feed.includes('loadUnplacedCleanerTexts()'), 'the feed no longer loads the texts');
    const cleanings = feed.slice(feed.indexOf('    cleanings:'), feed.indexOf('    unassigned:'));
    assert.ok(cleanings.includes('<UnplacedCleanerTextRow'), 'the row left the Cleanings to check section');
  });
});
