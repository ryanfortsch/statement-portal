/**
 * The two "Last 24 hours" ledgers fold on a phone, the dead mobile rule is
 * gone, and no rendered string in the messaging cluster carries an em dash
 * (2026-10-17). A lone '—' as an empty-value glyph is not a dash in prose
 * and stays, as the copy sweep (#1808) left it.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../../', import.meta.url).pathname;
const read = (repoPath: string): string => readFileSync(join(root, repoPath), 'utf8');

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) out.push(...files(rel));
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

/** Rendered text only: comment lines and the empty-value glyph removed. */
function rendered(src: string): string {
  return src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line))
    .join('\n')
    .replace(/'—'/g, '');
}

describe('phone grids, dead CSS, em dashes', () => {
  test('both Last 24 hours ledgers fold on a phone', () => {
    const css = read('src/app/globals.css');
    assert.ok(css.includes('.rt-msg-recent-row {\n    grid-template-columns: 1fr auto !important;'), 'the phone rule for the recent rows');
    for (const strip of ['src/app/messaging/RecentStrip.tsx', 'src/app/owner-messaging/OwnerRecentStrip.tsx']) {
      assert.ok(read(strip).includes('className="rt-msg-recent-row"'), `${strip} rows lack the class the rule targets`);
    }
  });

  test('one .rt-message-options rule per phone block, the dead one gone', () => {
    const css = read('src/app/globals.css');
    assert.ok(!css.includes('.rt-message-options { flex-basis: 100%; margin-left: 0; border-top: 1px solid var(--rule); }'), 'the overridden rule is dead and must stay deleted');
    assert.equal((css.match(/^\s+\.rt-message-options \{/gm) ?? []).length, 1, 'exactly one phone rule for the options');
  });

  test('no rendered string in the messaging cluster carries an em dash', () => {
    const dirs = ['src/app/messaging', 'src/app/owner-messaging', 'src/app/cleaner-messaging', 'src/app/contractor-messaging'];
    const all = [...dirs.flatMap(files), 'src/components/ProactiveRemindersPanel.tsx', 'src/components/MessagingTabs.tsx', 'src/components/InboxSearch.tsx', 'src/components/InboxHealth.tsx'];
    for (const file of all) {
      const text = rendered(read(file));
      assert.ok(!text.includes('—'), `${file} renders an em dash`);
    }
  });
});
