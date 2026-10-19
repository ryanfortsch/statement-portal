/**
 * No irreversible or outward action in Helm asks through the browser's own
 * confirm(), prompt() or alert() (audit 2026-10-17, Phase 4). They ask
 * through ConfirmDialog (useConfirm, askThenSubmit, SubmitButton's
 * `confirm`), which says what the action does and names its button.
 *
 * The native dialogs left are listed below, each with why it guards nothing
 * that leaves the page: a discard of local unsaved typing, a navigation
 * guard that must answer synchronously, a clipboard fallback, or a notice
 * that a read failed. A file not on the list may not call one, and a listed
 * file may not add one. When you convert a listed file, take it off.
 *
 * Counted with comments stripped; a bare `confirm(` is skipped in a file
 * that binds its own `confirm` (the field portal's retry helpers).
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

const ALLOWED: Record<string, { count: number; why: string }> = {
  // The fallback when no ConfirmProvider is mounted (smoke fixtures only; the
  // app mounts one in Providers).
  'src/components/ConfirmDialog.tsx': { count: 5, why: 'native fallback outside a provider' },
  'src/lib/freeze-confirm.ts': { count: 1, why: 'native fallback when a caller passes no ask' },
  // Synchronous navigation guards: a link click or Back must be answered
  // before the event returns, which a modal cannot do.
  'src/lib/use-draft-navigation-guard.ts': { count: 1, why: 'sync navigation guard, unsaved edits' },
  'src/app/playbook/PlaybookEditor.tsx': { count: 1, why: 'sync navigation guard, unsaved Playbook edits' },
  'src/app/field/packet/[packetId]/StopWorkList.tsx': { count: 1, why: 'sync leave guard, unsubmitted slip' },
  'src/app/properties/[id]/InlineField.tsx': { count: 2, why: 'discard one field edit (Escape key)' },
  // Discarding local typing that never left the page.
  'src/app/crm/NewContactModal.tsx': { count: 1, why: 'discard an unfinished contact' },
  'src/app/field/shoot/[shootId]/AnswerPanel.tsx': { count: 1, why: 'discard a typed reason' },
  'src/app/messaging/RemindersSection.tsx': { count: 1, why: 'discard an unsent draft' },
  'src/components/ProactiveRemindersPanel.tsx': { count: 1, why: 'discard an unsent draft' },
  'src/app/messaging/blurbs/BlurbsLibrary.tsx': { count: 2, why: 'discard saved-reply edits' },
  'src/app/properties/[id]/TaxCertEditor.tsx': { count: 1, why: 'discard a certificate ID edit' },
  'src/components/OwnerRequestsPanel.tsx': { count: 1, why: 'discard a request draft' },
  // Clipboard fallbacks: the prompt shows the link to copy by hand.
  'src/app/guests/agreements/[id]/CopyLinkButton.tsx': { count: 1, why: 'clipboard fallback' },
  'src/app/guests/quotes/[id]/CopyTextButton.tsx': { count: 1, why: 'clipboard fallback' },
  // A read that failed (a PDF download, a Gmail sync), said in an alert.
  'src/components/DownloadPdfChip.tsx': { count: 1, why: 'download failed notice' },
  'src/components/properties/DownloadPropertyPdfButton.tsx': { count: 1, why: 'download failed notice' },
  'src/components/projections/SyncGmailButton.tsx': { count: 1, why: 'sync failed notice' },
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') sourceFiles(path, out);
    } else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

export function nativeDialogCalls(src: string): number {
  const code = strip(src);
  let n = 0;
  for (const name of ['confirm', 'prompt', 'alert']) {
    n += (code.match(new RegExp(`window\\.${name}\\(`, 'g')) || []).length;
    const local = new RegExp(`(const|let|var|function)\\s+${name}\\b|[{,]\\s*${name}\\s*[,}:]|\\b${name}\\s*[:=]\\s*(async\\s*)?\\(`).test(code);
    if (!local) n += (code.match(new RegExp(`(^|[^.\\w$])${name}\\(`, 'gm')) || []).length;
  }
  return n;
}

const counts = new Map<string, number>();
for (const file of sourceFiles(join(repo, 'src'))) {
  const n = nativeDialogCalls(readFileSync(file, 'utf8'));
  if (n) counts.set(relative(repo, file).split('\\').join('/'), n);
}

test('the counter sees real calls and skips comments and local helpers', () => {
  assert.equal(nativeDialogCalls(`if (!window.confirm('x')) return; alert('y');`), 2);
  assert.equal(nativeDialogCalls(`// confirm('a comment')\n/* prompt('b') */ const ok = 1;`), 0);
  assert.equal(nativeDialogCalls(`const confirm = async () => ({ ok: true }); await confirm();`), 0);
  assert.equal(nativeDialogCalls(`const { ask } = useConfirm(); await ask({ title: 'x' });`), 0);
});

test('no file outside the list calls a native dialog', () => {
  const strays = [...counts.keys()].filter((f) => !(f in ALLOWED));
  assert.deepEqual(strays, [], `ask through ConfirmDialog (useConfirm / askThenSubmit / SubmitButton confirm) instead: ${strays.join(', ')}`);
});

test('no listed file grows, and a converted one comes off the list', () => {
  for (const [file, { count }] of Object.entries(ALLOWED)) {
    const n = counts.get(file) ?? 0;
    assert.ok(n <= count, `${file} calls ${n} native dialogs, the list allows ${count}`);
    assert.ok(n > 0, `${file} no longer calls a native dialog: take it off the list in native-dialogs.test.ts`);
  }
});

test('the total only goes down', () => {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  // 65 on main before Phase 4 (2026-10-18), 24 after.
  assert.ok(total <= 24, `${total} native dialog calls in src/`);
});
