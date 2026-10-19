/**
 * The house Button (src/components/Button.tsx, audit 2026-10-17 Phase 4):
 * four faces, one pending state, SubmitButton's watchdog. The class list is
 * pure and tested directly; the rest is one line each that compiles cleanly
 * without it, so it is read from the source. scripts/confirm-dialog-smoke.mjs
 * checks the faces and the pending hold in Chromium.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buttonClass } from '../button-class.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('buttonClass', () => {
  test('four faces, md by default', () => {
    assert.equal(buttonClass('primary'), 'rt-btn rt-btn--primary');
    assert.equal(buttonClass('secondary'), 'rt-btn rt-btn--secondary');
    assert.equal(buttonClass('danger'), 'rt-btn rt-btn--danger');
    assert.equal(buttonClass(), 'rt-btn rt-btn--secondary');
  });

  test('quiet is the existing text face, at any size', () => {
    assert.equal(buttonClass('quiet'), 'rt-quiet-btn');
    assert.equal(buttonClass('quiet', 'sm'), 'rt-quiet-btn');
  });

  test('sizes and an extra class', () => {
    assert.equal(buttonClass('primary', 'sm'), 'rt-btn rt-btn--primary rt-btn--sm');
    assert.equal(buttonClass('primary', 'lg', 'rt-no-print'), 'rt-btn rt-btn--primary rt-btn--lg rt-no-print');
  });

  test('every face has its rules in globals.css', () => {
    const css = read('src/app/globals.css');
    for (const face of ['.rt-btn {', '.rt-btn--primary {', '.rt-btn--secondary {', '.rt-btn--danger {', '.rt-btn--sm {', '.rt-btn--lg {', '.rt-quiet-btn {']) {
      assert.ok(css.includes(face), `globals.css lost ${face}`);
    }
    assert.match(css, /\.rt-btn:focus-visible \{ outline: 2px solid var\(--ink\)/, 'the keyboard focus ring');
    assert.match(css, /@media \(max-width: 640px\) \{\s*\/\*[^*]*\*\/\s*\.rt-btn \{ min-height: 44px; \}/, '44px targets on a phone');
  });
});

describe('Button', () => {
  const src = code(read('src/components/Button.tsx'));

  test('pending holds the click, disables, and says so with aria-busy', () => {
    assert.match(src, /if \(pending\) \{ e\.preventDefault\(\); return; \}/);
    assert.match(src, /disabled=\{disabled \|\| pending\}/);
    assert.match(src, /aria-busy=\{pending \|\| undefined\}/);
  });

  test('confirm asks in the modal first; a submit button resubmits through askThenSubmit', () => {
    assert.match(src, /if \(type === 'submit'\) \{ await askThenSubmit\(e, ask, question\); return; \}/);
    assert.match(src, /if \(await ask\(question\)\) onClick\?\.\(e\);/);
  });

  test("runs SubmitButton's watchdog, yielding the 30s reload to unsaved work", () => {
    assert.match(src, /usePendingWatchdog\(pending && watchdog, \{ yieldToUnsavedWork: true \}\);/);
    const hook = code(read('src/lib/use-pending-watchdog.ts'));
    assert.match(hook, /if \(yieldToUnsavedWork && hasUnsavedWork\(\)\) return;\s*window\.location\.reload\(\);/);
    // SubmitButton keeps the unconditional reload it always had.
    assert.match(code(read('src/components/SubmitButton.tsx')), /usePendingWatchdog\(status\.pending\);/);
  });

  test('long-running callers turn the watchdog off', () => {
    // Organize watches the background pass for minutes; Ask Helm and the
    // messaging card wait on a model or the concierge.
    assert.match(read('src/app/work/QueueClient.tsx'), /pendingLabel="Organizing"\s*watchdog=\{false\}/);
    assert.equal((read('src/components/AskHelm.tsx').match(/watchdog=\{false\}/g) || []).length, 2);
    assert.equal((read('src/components/messaging/card/buttons.tsx').match(/watchdog=\{false\}/g) || []).length, 3);
  });

  test('the approval card faces are the house Button', () => {
    const card = code(read('src/components/messaging/card/buttons.tsx'));
    assert.match(card, /<Button variant="primary" size="lg"/);
    assert.match(card, /<Button variant="secondary"/);
    assert.match(card, /<Button variant="quiet"/);
  });
});
