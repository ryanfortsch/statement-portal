/**
 * A deploy must not reload away typing that hasn't been saved.
 *
 * VersionGuard hard-reloads the tab whenever /api/version reports a new
 * deployment id: on a 60s interval AND on every tab focus. This repo ships
 * many times an hour, so on a page whose edits live only in React state
 * that reload is silent data loss. It happened on the Guesty caption tool
 * (Dotti, 2026-09-27: "tried editing and they all got scrubbed and
 * reloaded and deleted") with 29 photos in flight.
 *
 * The fix is two one-line guards that nothing else holds in place:
 *
 *   1. version-skew consults hasUnsavedWork() BEFORE reloading, and when it
 *      defers it must NOT mark the deployment as reloaded-for, or the loop
 *      guard swallows the real reload once the work is saved.
 *   2. the caption client mirrors unsaved drafts to localStorage and merges
 *      them back on load, so a reload that happens anyway (or a crash, or a
 *      closed tab) is recoverable.
 *
 * Both are cheap to delete by accident and expensive to lose, so this reads
 * the source and asserts they are still there.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

describe('unsaved work outranks the skew reload', () => {
  test('the registry counts scopes and arms the browser prompt', () => {
    const src = read('src/lib/unsaved-work.ts');
    assert.ok(src.includes('export function hasUnsavedWork()'), 'hasUnsavedWork is gone');
    assert.ok(src.includes('export function useUnsavedWorkGuard'), 'the hook is gone');
    // A count, not a boolean: two dirty surfaces must not disarm each other.
    assert.ok(src.includes('dirtyScopes += 1') && src.includes('dirtyScopes -= 1'), 'the claim is no longer counted');
    assert.ok(src.includes("addEventListener('beforeunload'"), 'the leave-site prompt is gone');
  });

  test('the skew reload defers to unsaved work, and does not burn the guard', () => {
    const src = read('src/lib/version-skew.ts');
    assert.ok(src.includes('hasUnsavedWork'), 'version-skew no longer consults unsaved work');
    const deferAt = src.indexOf('if (hasUnsavedWork()) return true;');
    const markAt = src.indexOf('markReloadedFor(serverId);');
    const reloadAt = src.indexOf('window.location.reload()');
    assert.ok(deferAt > 0, 'the unsaved-work check is gone');
    assert.ok(markAt > deferAt, 'the deploy is marked reloaded-for before the unsaved-work check');
    assert.ok(reloadAt > deferAt, 'the tab reloads before the unsaved-work check');
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
