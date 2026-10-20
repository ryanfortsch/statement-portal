import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { teamBylineForEmail } from '../team.ts';

// Staff read Ryan or Rising Tide, never Dotti (Dotti, 2026-10-07). A page,
// component or server action a staff login can reach says "Ask Ryan", and the
// Playbook's bylines read an owner's edit as Rising Tide.

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

test('no page, component or server action names Dotti outside a comment', () => {
  const files = execSync(
    "git ls-files 'src/app/**/*.tsx' 'src/components/**/*.tsx' 'src/app/**/actions.ts' 'src/app/**/*-actions.ts'",
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean);
  assert.ok(files.length > 100, 'the scan found the app');
  const hits = files.flatMap((f) =>
    strip(readFileSync(f, 'utf8'))
      .split('\n')
      .filter((l) => l.includes('Dotti'))
      .map((l) => `${f}: ${l.trim()}`),
  );
  assert.deepEqual(hits, [], 'say "Ask Ryan" or "an owner" instead');
});

test('a launch step says who decides without naming Dotti', () => {
  const src = readFileSync('src/lib/launch-checklist.ts', 'utf8');
  assert.ok(!/Dotti decides/.test(src));
});

test('Playbook bylines: an owner reads as Rising Tide, staff by name', () => {
  assert.equal(teamBylineForEmail('dotti@risingtidestr.com'), 'Rising Tide');
  assert.equal(teamBylineForEmail('ryan@risingtidestr.com'), 'Rising Tide');
  assert.equal(teamBylineForEmail('allie@risingtidestr.com'), 'Rising Tide');
  assert.equal(teamBylineForEmail(null), 'Rising Tide');
  assert.notEqual(teamBylineForEmail('delaney@risingtidestr.com'), 'Rising Tide');
  for (const f of ['src/app/playbook/PlaybookClient.tsx', 'src/app/playbook/[slug]/page.tsx']) {
    const src = readFileSync(f, 'utf8');
    assert.ok(src.includes('teamBylineForEmail('), `${f} prints the team byline`);
    assert.ok(!src.includes('displayNameForEmail('), `${f} never prints an owner's name`);
  }
});
