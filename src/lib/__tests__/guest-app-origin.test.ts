import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The guest app's links name staycapeann.com (it forwards /h/* to Helm), and
 * the property page's Open still previews on Helm's own host, where the
 * staff session is seen and the preview is not counted as a guest's open.
 */
const root = join(import.meta.dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('guest app links default to staycapeann.com', () => {
  const db = read('src/lib/guest-app-db.ts');
  const fn = /export function guestAppOrigin\(\)[^{]*\{([\s\S]*?)\n\}/.exec(db)?.[1] ?? '';
  assert.match(fn, /GUEST_APP_ORIGIN \|\| process\.env\.SCA_PUBLIC_ORIGIN \|\| 'https:\/\/staycapeann\.com'/);
  assert.ok(!fn.includes('helm.risingtidestr.com'), 'no Helm host in the default chain');
});

test("the panel's Open previews on Helm's own host", () => {
  const panel = read('src/app/properties/[id]/GuestAppPanel.tsx');
  assert.match(panel, /<a href=\{view\.previewPath\}/);
  assert.ok(!/<a href=\{view\.url\}/.test(panel), 'Open does not leave for staycapeann.com');
  const db = read('src/lib/guest-app-db.ts');
  assert.match(db, /previewPath: `\/h\/\$\{row\.token\}`/);
});
