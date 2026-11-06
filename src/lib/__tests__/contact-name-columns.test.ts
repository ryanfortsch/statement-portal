/**
 * The home's "Needs your reply" names each sender from the contacts table.
 * Until 2026-11-06 the read asked for first_name and last_name, which the
 * table never had: PostgREST failed the whole select and every row printed
 * "Contact". This holds the columns the brief asks for to the ones the
 * table was created with.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

test("the daily brief's contacts read names only columns the table has", () => {
  const ddl = read('supabase/migrations/20260506_crm_contacts_and_touches.sql');
  const table = ddl.slice(ddl.indexOf('create table public.contacts ('), ddl.indexOf(');', ddl.indexOf('create table public.contacts (')));
  const columns = new Set([...table.matchAll(/^\s+([a-z_]+)\s+[a-z]/gm)].map((m) => m[1]));
  assert.ok(columns.has('name') && columns.has('phone'), 'parsed the contacts DDL');

  const brief = read('src/lib/daily-brief.ts');
  const selects = [...brief.matchAll(/\.from\('contacts'\)\s*\.select\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(selects.length > 0, 'the brief still reads contacts');
  for (const list of selects) {
    for (const col of list.split(',').map((c) => c.trim())) {
      assert.ok(columns.has(col), `contacts has no column ${col}`);
    }
  }
});
