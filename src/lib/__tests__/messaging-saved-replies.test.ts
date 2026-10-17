/**
 * Saved replies read as replies, not a form, and Retire has a way back
 * (2026-10-17). Reads the library source; each affordance is one line.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

describe('saved replies', () => {
  const src = read('src/app/messaging/blurbs/BlurbsLibrary.tsx');

  test('Retire asks once and lands on a Retired tab with Restore', () => {
    assert.ok(src.includes("confirmRetire ? 'Sure? Retire it' : 'Retire'"), 'Retire is two taps');
    assert.ok(src.includes("retired: 'retired'"), 'a Retired tab exists');
    assert.ok(src.includes("setBlurbStatusAction(blurb.id, 'unapprove'), () => onRestored(blurb.id)"), 'Restore puts it back as a draft');
    assert.ok(src.includes('setRetiredHere'), 'a reply retired this session stays restorable after the refresh');
  });

  test('the title is text with a pencil, the body text with Edit', () => {
    assert.ok(src.includes('aria-label="Edit title"'), 'the title has a pencil');
    assert.ok(src.includes('setEditingBody(true)'), 'the body has Edit');
    assert.ok(!src.includes("borderBottom: '1px dashed transparent'"), 'no invisible input');
  });

  test('no explainer paragraph, and the Add form offers an area scope', () => {
    assert.ok(!src.includes('Drafts never reach a guest'), 'the explainer is gone');
    assert.ok(src.includes('value={`area:${town}`}'), 'an area option exists');
    assert.ok(src.includes("const AREAS = ['gloucester', 'rockport', 'beverly']"));
  });

  test('the page wears the messaging shell', () => {
    assert.ok(read('src/app/messaging/blurbs/page.tsx').includes('<MessagingFooter />'));
  });
});
