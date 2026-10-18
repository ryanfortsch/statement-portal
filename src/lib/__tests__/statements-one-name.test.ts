/**
 * One name per file and per verb on /statements.
 *
 * The Guesty reservations export was "Platform CSV" on the upload page and
 * the close strip, "Reservations CSV" on its inputs card and "Upload
 * Reservations CSV" in the Sync menu (a second door to the same file). A
 * data gap was a gap, a flag and a chip. "Reconcile Sends" sounded like a
 * read and wrote flags. Draft All counted what it skipped without naming
 * any of it. This reads the rendered strings, the way the copy tests in
 * this folder do, so a rename cannot quietly come back.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

/** Source with comments blanked: a comment may name the old words. */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const page = code(read('src/app/statements/page.tsx'));
const upload = code(read('src/app/statements/upload/page.tsx'));
const card = code(read('src/components/PlatformCSVUploadCard.tsx'));

describe('the Guesty reservations CSV has one name and one door', () => {
  test('no surface calls it Platform CSV or a bare Reservations CSV', () => {
    for (const [name, src] of [['page', page], ['upload page', upload], ['inputs card', card]] as const) {
      assert.ok(!/['">]Platform CSV/.test(src), `the ${name} says "Platform CSV"`);
      assert.ok(!/['">\s]Reservations CSV/.test(src.replace(/Guesty reservations CSV/g, '')), `the ${name} says "Reservations CSV" without "Guesty"`);
    }
    assert.match(card, /<span className="eyebrow">Guesty reservations CSV<\/span>/);
    assert.match(upload, /label="Guesty reservations CSV"/);
  });

  test('the Sync menu no longer uploads the file the inputs card uploads', () => {
    assert.ok(!page.includes('/api/ingest-guesty-csv'), 'the dashboard posts the reservations CSV itself again');
    assert.ok(!page.includes("lastSync['csv-fallback']"), 'the Sync menu fallback row is back');
  });
});

describe('a data gap is a flag', () => {
  test('the card, its section and its verbs say flag', () => {
    assert.match(page, /\{gaps\.length\} flag\{gaps\.length > 1 \? 's' : ''\}/);
    assert.match(page, /<SectionHead num="05" title="Flags"/);
    assert.ok(!/title="Data Gaps"|>\s*Fill Gap\s*<|Fill Data Gap/.test(page), 'the page says gap again');
    assert.ok(!/open data gap/.test(page), 'a confirm list says "data gap" again');
  });
});

describe('verbs say what they do', () => {
  test('Check sent emails says it can add flags', () => {
    assert.ok(!page.includes('Reconcile Sends'), '"Reconcile Sends" is back');
    assert.match(page, /label=\{reconciling \? 'Checking…' : 'Check sent emails'\}/);
    assert.match(page, /meta="flags a mismatch"/);
    assert.match(page, /A mismatch adds a flag to that property&apos;s card\./);
  });

  test('Draft All names what it skipped', () => {
    assert.match(page, /skipped: \{ property: string; why: string \}\[\]/);
    for (const why of ['already drafted', 'red confidence', 'in a combined owner email']) {
      assert.ok(page.includes(`'${why}'`), `the skipped list no longer names "${why}"`);
    }
    assert.match(page, /bulkDraftResult\.skipped\.filter\(x => x\.why === why\)\.map\(x => x\.property\)/);
  });
});
