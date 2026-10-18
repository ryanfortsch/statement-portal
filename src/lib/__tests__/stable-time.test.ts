/**
 * Client components print time the same way on the server (UTC) and in the
 * browser (Eastern), so hydration never meets two texts (React #418, walk of
 * 2026-10-18).
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { etStamp, GLOUCESTER_TZ } from '../stable-time.ts';

const root = new URL('../../../', import.meta.url).pathname;
const read = (repoPath: string): string => readFileSync(join(root, repoPath), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (name === 'node_modules' || name === '__tests__') continue;
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

test('a stamp reads in Gloucester whatever zone the process runs in', () => {
  assert.equal(GLOUCESTER_TZ, 'America/New_York');
  assert.equal(etStamp('2026-10-18T14:15:00Z'), 'Oct 18, 10:15 AM');
  // 01:30 UTC on the 19th is still the evening of the 18th in Gloucester.
  assert.equal(etStamp('2026-10-19T01:30:00Z'), 'Oct 18, 9:30 PM');
  assert.equal(etStamp(null), '');
  assert.equal(etStamp('not a date'), '');
});

test('no client component formats a Date with the runtime zone and locale', () => {
  // `new Date(x).toLocaleString()` prints the server's UTC on the server and
  // the browser's zone in the browser. Event handlers (a "saved at" set on
  // click) run only in the browser and are fine.
  const bad: string[] = [];
  for (const f of walk('src')) {
    const src = readFileSync(join(root, f), 'utf8');
    if (!src.startsWith("'use client'")) continue;
    src.split('\n').forEach((line, i) => {
      if (/new Date\([^)]*\)\.toLocale(Date|Time)?String\((\)|undefined)/.test(line) && !/\bset[A-Z]\w*\(/.test(line)) {
        // The statements page prints one in a title attribute, which React
        // does not compare on hydrate; left to the statements work.
        if (f === 'src/app/statements/page.tsx' && line.includes('title={`Last ingested')) return;
        bad.push(`${f}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(bad, []);
});

test('the clock-read ages keep the server text on hydrate', () => {
  const sites: Array<[string, string]> = [
    ['src/app/work/[id]/SlipComments.tsx', '<div suppressHydrationWarning'],
    ['src/components/messaging/card/ApprovalCard.tsx', '<span suppressHydrationWarning style={{ color: ageTone'],
    ['src/components/messaging/card/DecidedRecently.tsx', '<span suppressHydrationWarning'],
    ['src/app/messaging/HeldPitches.tsx', '<span suppressHydrationWarning'],
    ['src/app/messaging/RecentStrip.tsx', 'suppressHydrationWarning'],
    ['src/app/messaging/Conversations.tsx', 'suppressHydrationWarning'],
    ['src/app/crm/CrmListClient.tsx', 'suppressHydrationWarning'],
    ['src/app/crm/[id]/ContactDetail.tsx', '<div suppressHydrationWarning'],
    ['src/app/properties/[id]/launch/LaunchStepCard.tsx', 'suppressHydrationWarning'],
  ];
  for (const [f, marker] of sites) assert.ok(read(f).includes(marker), `${f} lost its suppressHydrationWarning`);
});
