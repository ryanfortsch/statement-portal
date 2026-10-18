/**
 * A property note is a fact or an issue (UI/UX audit 2026-10-17, Properties,
 * Phase 3; appendix 04 bug 15).
 *
 * "Resolve" on a permanent, guest-facing fact used to strike it through and
 * drop it from the guest AI's knowledge (/api/kb-facts reads open notes), with
 * no way back. Now a fact lives in What we know and has no Resolve, an issue
 * lives on Now and has Resolve and Reopen, and the database refuses a resolved
 * fact. This pins each half where a later edit would undo it.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

test('the default kind follows the Guest KB flag in the backfill, the trigger and the form', () => {
  assert.match(read('src/app/properties/actions.ts'), /rawKind === 'fact' \|\| rawKind === 'issue' \? rawKind : guest_facing \? 'fact' : 'issue'/);
  const sql = read('supabase/migrations/20261018170000_property_notes_kind.sql');
  assert.match(sql, /set kind = case when guest_facing then 'fact' else 'issue' end/);
  assert.match(sql, /new\.kind := case when coalesce\(new\.guest_facing, false\) then 'fact' else 'issue' end/);
});

test('the database refuses a resolved fact', () => {
  const sql = read('supabase/migrations/20261018170000_property_notes_kind.sql');
  assert.match(sql, /property_notes_fact_never_resolved check \(kind = 'issue' or resolved_at is null\)/);
});

test('the Guest KB still reads open guest-facing notes, which a fact always is', () => {
  const kb = read('src/app/api/kb-facts/route.ts');
  assert.match(kb, /\.eq\('guest_facing', true\)\s*\n\s*\.is\('resolved_at', null\)/);
});

test('What we know lists facts with Edit and no Resolve; Now lists issues', () => {
  const page = read('src/app/properties/[id]/page.tsx');
  const start = page.indexOf('title="What we know"');
  assert.ok(start > 0, 'the notebook is named What we know');
  const end = page.indexOf('</CollapsibleSection>', start);
  const notebook = page.slice(start, end);
  assert.match(notebook, /knownFacts\.map/);
  assert.doesNotMatch(notebook, /ResolveFlagButton|resolved_at/);
  assert.match(page, /const knownFacts = propertyNotes\.filter\(\(n\) => n\.kind !== 'issue'\)/);
  assert.match(read('src/lib/property-flags-load.ts'), /\.eq\('kind', 'issue'\)/);
});

test('one word for guest-facing on the property surfaces: Guest KB', () => {
  for (const file of [
    'src/components/properties/NoteEditorForm.tsx',
    'src/app/properties/[id]/QuickCapture.tsx',
    'src/app/properties/[id]/WalkthroughCapture.tsx',
  ]) {
    const src = read(file);
    assert.match(src, /Guest KB/, `${file} names it Guest KB`);
    assert.doesNotMatch(src, /Guest-facing knowledge|\['Guest', true\]|>guest</, `${file} still uses an old name`);
  }
  const page = read('src/app/properties/[id]/page.tsx');
  assert.doesNotMatch(page, />\s*Guest\s*<\/span>/, 'a bare "Guest" pill is back on the property page');
});
