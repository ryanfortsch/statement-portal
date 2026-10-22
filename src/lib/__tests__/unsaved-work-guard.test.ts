/**
 * A reload must not take typing that hasn't been saved.
 *
 * The old VersionGuard hard-reloaded the tab whenever a deploy landed, and on
 * a page whose edits live only in React state that was silent data loss. It
 * happened on the Guesty caption tool (Dotti, 2026-09-27: "tried editing and
 * they all got scrubbed and reloaded and deleted") with 29 photos in flight.
 * VersionGuard was retired on 2026-10-22; platform Skew Protection and Next's
 * deploymentId check handle a stale tab now (next.config.ts).
 *
 * What still holds the line, and is cheap to delete by accident:
 *
 *   1. the registry: a counted claim plus the browser's leave-site prompt
 *   2. AutoRefresh skips its tick while the page holds unsaved work, because
 *      a refresh that lands on a newer deployment is hard-reloaded by Next
 *   3. no timer anywhere reloads the tab for a deploy (VersionGuard stays gone)
 *   4. the caption client mirrors unsaved drafts to localStorage and merges
 *      them back on load, so a reload that happens anyway (or a crash, or a
 *      closed tab) is recoverable
 *
 * Button's 30s lost-response reload yields to unsaved work too; button.test.ts
 * pins that one.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

describe('unsaved work outranks a reload', () => {
  test('the registry counts scopes and arms the browser prompt', () => {
    const src = read('src/lib/unsaved-work.ts');
    assert.ok(src.includes('export function hasUnsavedWork()'), 'hasUnsavedWork is gone');
    assert.ok(src.includes('export function useUnsavedWorkGuard'), 'the hook is gone');
    // A count, not a boolean: two dirty surfaces must not disarm each other.
    assert.ok(src.includes('dirtyScopes += 1') && src.includes('dirtyScopes -= 1'), 'the claim is no longer counted');
    assert.ok(src.includes("addEventListener('beforeunload'"), 'the leave-site prompt is gone');
  });

  test('AutoRefresh does not refresh over unsaved work', () => {
    const src = read('src/components/AutoRefresh.tsx');
    assert.match(src, /if \(cancelled \|\| document\.hidden \|\| hasUnsavedWork\(\)\) return;\s*softRefresh\(\);/,
      'AutoRefresh no longer waits for unsaved work before refreshing');
  });

  test('no timer reloads the tab for a deploy', () => {
    assert.ok(!existsSync(new URL('../../components/VersionGuard.tsx', import.meta.url)), 'VersionGuard is back');
    assert.ok(!existsSync(new URL('../version-skew.ts', import.meta.url)), 'version-skew is back');
    assert.ok(!read('src/app/layout.tsx').includes('VersionGuard'), 'the root layout mounts VersionGuard again');
  });

  test('caption drafts are mirrored to storage and merged back on load', () => {
    const src = read('src/app/properties/[id]/caption-photos/CaptionPhotosClient.tsx');
    assert.ok(src.includes('useUnsavedWorkGuard(changedIds.length > 0)'), 'the caption page no longer claims its unsaved edits');
    assert.ok(src.includes('writeStoredDrafts(propertyId'), 'drafts are no longer mirrored to storage');
    assert.ok(src.includes('readStoredDrafts(propertyId)'), 'drafts are no longer restored on load');
    // Only edits that differ from the live caption are stored, so a saved
    // caption prunes itself instead of shadowing Guesty forever.
    assert.ok(
      src.includes('changedIds.map((id) => [id, drafts[id] ?? \'\'])'),
      'storage is no longer scoped to the changed captions',
    );
  });
});
