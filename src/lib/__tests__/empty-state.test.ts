/**
 * EmptyState (src/components/EmptyState.tsx, audit 2026-10-17 Phase 4): what
 * an empty list says is one sentence in the reader's words, at most one verb,
 * and never the machinery (a table, a migration, an env var, the service
 * role). Section's empty line renders through it, so the rule reaches every
 * section that sets `emptyMessage`.
 *
 * Reads the source, the way confirm-dialog.test.ts does; the controls
 * fixture (scripts/confirm-dialog-smoke.mjs) checks it in Chromium.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const read = (repoPath: string): string => readFileSync(join(repo, repoPath), 'utf8');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') sourceFiles(path, out);
    } else if (name.endsWith('.tsx')) out.push(path);
  }
  return out;
}

// Words that only an engineer should read on a page.
const MACHINERY = /\b(migrations?|service role|env(ironment)? var|SUPABASE|_KEY\b|GITHUB_TOKEN|tables?\b|rows? go|cron|webhook|null|undefined)\b/i;

test('EmptyState is usable from a server page and keeps one sentence plus one verb', () => {
  const src = read('src/components/EmptyState.tsx');
  assert.ok(!/^'use client'/m.test(src), 'EmptyState must stay a server-safe component');
  assert.match(src, /action\?: \{ label: string; href: string \} \| ReactNode;/);
  assert.match(src, /className=\{buttonClass\('secondary', 'sm'\)\}/, 'a link verb wears the small secondary face');
});

test("Section's empty line is an EmptyState", () => {
  const section = read('src/components/Section.tsx');
  assert.match(section, /<EmptyState action=\{emptyAction\}>\{emptyMessage\}<\/EmptyState>/);
});

test('no empty state names the machinery', () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(join(repo, 'src'))) {
    const src = readFileSync(file, 'utf8');
    const rel = relative(repo, file);
    for (const m of src.matchAll(/<EmptyState\b[^>]*>([\s\S]*?)<\/EmptyState>/g)) {
      if (MACHINERY.test(m[1])) offenders.push(`${rel}: ${m[1].trim().slice(0, 80)}`);
    }
    for (const m of src.matchAll(/emptyMessage=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const text = m[1] ?? m[2] ?? '';
      if (MACHINERY.test(text)) offenders.push(`${rel}: ${text.slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the empties this phase rewrote stay rewritten', () => {
  assert.ok(!read('src/components/ForMeFeed.tsx').includes('Email triage is not configured yet.'));
  const automations = read('src/app/properties/[id]/AutomationsPanel.tsx');
  assert.ok(!/the migration/.test(automations), 'the Automations panel names the migration again');
  assert.ok(!/service role unset/.test(automations));
  const charges = read('src/app/payments/balance-charges/page.tsx');
  assert.ok(!/Supabase service role is not configured/.test(charges));
  assert.ok(!/Rows go hot/.test(charges));
});
