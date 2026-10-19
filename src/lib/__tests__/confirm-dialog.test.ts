/**
 * ConfirmDialog is the one confirm style in Helm (audit 2026-10-17, Phase 4).
 *
 * The wording helpers are pure and tested directly. The modal's promises
 * (focus stays inside, Escape and the backdrop cancel, the typed-word gate
 * holds the button, the provider is mounted for the whole app, SubmitButton
 * asks through it) are each one line that compiles cleanly without it, so
 * they are read from the source, the way statements-reversible.test.ts does.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { askFromSentence, typedWordMatches } from '../confirm-question.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('askFromSentence', () => {
  test('splits the question from what it does at the first "? "', () => {
    assert.deepEqual(
      askFromSentence('Retire Pat? They move to the Retired list. Their link stops working.'),
      { title: 'Retire Pat?', body: 'They move to the Retired list. Their link stops working.' },
    );
  });

  test('a lone question is all title', () => {
    assert.deepEqual(askFromSentence('Delete this comment?'), { title: 'Delete this comment?' });
    assert.deepEqual(askFromSentence('There are no overrides. Clear the range anyway?'), { title: 'There are no overrides. Clear the range anyway?' });
  });

  test('newlines from the old native strings fold into one line', () => {
    assert.deepEqual(
      askFromSentence('Clear all contract edits?\n\nThe prospect record stays intact.'),
      { title: 'Clear all contract edits?', body: 'The prospect record stays intact.' },
    );
  });
});

describe('typedWordMatches', () => {
  test('ignores case and surrounding spaces', () => {
    assert.equal(typedWordMatches('  CANCEL ', 'cancel'), true);
    assert.equal(typedWordMatches('cancel', 'CANCEL'), true);
  });

  test('anything else holds the button', () => {
    assert.equal(typedWordMatches('cance', 'cancel'), false);
    assert.equal(typedWordMatches('', 'cancel'), false);
    assert.equal(typedWordMatches(null, 'cancel'), false);
    assert.equal(typedWordMatches('', ''), false);
  });
});

describe('the modal keeps its promises', () => {
  const dialog = code(read('src/components/ConfirmDialog.tsx'));

  test('focus is trapped and returned', () => {
    assert.match(dialog, /onKeyDown=\{trap\}/);
    assert.match(dialog, /e\.key !== 'Tab'/);
    assert.match(dialog, /back\.focus\(/);
  });

  test('Escape and the backdrop cancel, and the Escape stops at the dialog', () => {
    // Capture phase and stopped there, so it never also closes the editor or
    // modal the question was asked from.
    assert.match(dialog, /if \(e\.key !== 'Escape'\) return;\s*e\.preventDefault\(\);\s*e\.stopImmediatePropagation\(\);\s*close\('no'\);/);
    assert.match(dialog, /window\.addEventListener\('keydown', onKey, true\)/);
    assert.match(dialog, /onClick=\{\(\) => close\('no'\)\}\s*style=\{\{\s*position: 'fixed'/);
  });

  test('the typed-word gate holds the confirm button, and close refuses while it is shut', () => {
    assert.match(dialog, /const gateShut = !!gate && !typedWordMatches\(typed, gate\);/);
    assert.match(dialog, /disabled=\{blocked\}/);
    assert.match(dialog, /if \(answer === 'yes' && blocked\) return;/);
  });

  test('the confirm button carries the verb, and irreversible says so', () => {
    assert.match(dialog, /pending\.o\.confirmLabel/);
    assert.match(read('src/components/ConfirmDialog.tsx'), /This cannot be undone\./);
  });

  test('a question asked inside an async transition still opens', () => {
    // React 19 holds an async transition's updates until it ends; the open
    // state is set in a microtask, outside the caller's transition scope.
    assert.match(dialog, /queueMicrotask\(\(\) => \{[\s\S]*?setPending\(next\);/);
  });

  test('it sits above every other modal', () => {
    assert.match(dialog, /zIndex: 2000/);
  });

  test('choose resolves to the picked value, or null on cancel', () => {
    assert.match(dialog, /else if \(pending\.kind === 'choose'\) pending\.resolve\(answer === 'yes' \? choice \?\? null : null\);/);
    assert.match(dialog, /onClick=\{\(\) => close\('yes', c\.value\)\}/);
  });

  test('askThenSubmit holds the click and resubmits with the same button on yes', () => {
    const helper = dialog.slice(dialog.indexOf('export async function askThenSubmit('));
    assert.match(helper, /e\.preventDefault\(\);\s*if \(\(await ask\(question\)\) && button\.isConnected && !button\.disabled\) form\.requestSubmit\(button\);/);
  });

  test('the provider is mounted once for the whole app', () => {
    assert.match(read('src/components/Providers.tsx'), /<ConfirmProvider>\{children\}<\/ConfirmProvider>/);
    assert.match(read('src/app/layout.tsx'), /<Providers session=\{session\}[^>]*>/);
  });
});

describe('the typed-word gate guards the broadest destructive action', () => {
  test('the channel hub mass cancel wants "cancel" typed', () => {
    const hub = code(read('src/app/channels/[propertyId]/page.tsx'));
    assert.match(hub, /massCancelConfirm\(label, held, bcom\)\),[\s\S]{0,260}typeToConfirm: 'cancel',/);
  });
});

describe('SubmitButton asks through the modal', () => {
  const src = code(read('src/components/SubmitButton.tsx'));

  test('no native confirm; the click goes through askThenSubmit', () => {
    assert.ok(!/window\.confirm\(/.test(src), 'SubmitButton still calls window.confirm');
    assert.match(src, /const \{ ask \} = useConfirm\(\);/);
    assert.match(src, /askThenSubmit\(e, ask, \{/);
    assert.match(src, /onClick=\{askFirst\}/);
  });

  test('the modal button is named for the action', () => {
    assert.match(src, /confirmLabel: spec\.confirmLabel \?\? \(typeof label === 'string' \? label : 'Confirm'\)/);
  });
});
