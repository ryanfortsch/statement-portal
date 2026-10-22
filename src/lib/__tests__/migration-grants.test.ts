/**
 * Every new table carries its own grants: the migration guard.
 *
 * Supabase's final notice (2026-10-20): from October 30, 2026 it stops
 * granting Data API access to NEW tables in `public` on existing projects.
 * Tables that exist keep their grants. A table created after that date with
 * no GRANT answers supabase-js and PostgREST with "permission denied", and
 * Helm reads almost everything through the service-role client, so a table
 * that forgets `grant ... to service_role` breaks the feature that ships
 * with it: invisible in review, loud in production.
 *
 * The house rule, the one 20261018200000_vendor_visit_proposals.sql and the
 * other recent tables follow:
 *
 *   - RLS on, no policies.
 *   - service_role granted, at least `select` (`all` is the usual form).
 *   - anon and authenticated granted nothing, unless the migration says why
 *     in a `-- client grant <table>: <reason>` comment. The anon key ships
 *     to every browser, so a client grant is a decision, never a default.
 *
 * The cutoff is CUTOFF below, earlier than October 30 on purpose: what
 * matters is the day a table is created in production, and migrations here
 * are applied by hand, often days after they are written. A migration
 * dated before the cutoff was written while Supabase still granted for us.
 *
 * Three grant forms are in use and all three count: one table
 * (`grant all on public.x to service_role`), a comma list across lines, and
 * the `do $$ ... foreach t in array array['a','b'] loop execute format(...)`
 * loop. Anything else (a `for ... in select` loop, `all tables in schema`)
 * is not read; name the tables.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const CUTOFF = '20261023';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);
const readMigration = (name: string): string => readFileSync(new URL(name, MIGRATIONS), 'utf8');

const CLIENT_ROLES = ['anon', 'authenticated', 'public'] as const;

type Grant = { table: string; privileges: string[]; grantees: string[] };

const stripComments = (sql: string): string =>
  sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

// `public.x`, `"public"."x"`, `x` -> `x`; another schema -> null.
function publicName(ident: string): string | null {
  const parts = ident
    .split('.')
    .map((p) => p.trim().replace(/^"|"$/g, '').toLowerCase())
    .filter(Boolean);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2 && parts[0] === 'public') return parts[1];
  return null;
}

const words = (list: string): string[] =>
  list
    .replace(/\([^)]*\)/g, ' ') // column lists: grant select (a, b) on ...
    .split(',')
    .map((w) => w.trim().toLowerCase().replace(/\s+privileges$/, '').replace(/^group\s+/, ''))
    .filter(Boolean);

function createdTables(sql: string): string[] {
  const out = new Set<string>();
  const re =
    /\bcreate\s+(?:(?:global\s+|local\s+)?(temp|temporary)\s+|unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?((?:"[^"]+"|[a-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[a-z_][\w$]*))?)/gi;
  for (const m of stripComments(sql).matchAll(re)) {
    if (m[1]) continue; // a temp table never reaches the Data API
    const name = publicName(m[2]);
    if (name) out.add(name);
  }
  return [...out];
}

function grants(sql: string): Grant[] {
  const body = stripComments(sql);
  const out: Grant[] = [];
  // Plain statements, including comma lists that run across lines.
  const plain = /\bgrant\s+([^;]+?)\s+on\s+(?:table\s+)?([^;]+?)\s+to\s+([^;]+?)(?:\s+with\s+grant\s+option)?\s*;/gi;
  for (const m of body.matchAll(plain)) {
    if (/%I/i.test(m[2])) continue; // a format() template, read by the loop pass
    const grantees = words(m[3]);
    for (const ident of m[2].split(',')) {
      const table = publicName(ident);
      if (table) out.push({ table, privileges: words(m[1]), grantees });
    }
  }
  // do $$ ... foreach t in array array['a', 'b'] loop ... end loop
  const loop = /\bforeach\s+\w+\s+in\s+array\s+array\s*\[([^\]]*)\]\s+loop\b([\s\S]*?)\bend\s+loop\b/gi;
  for (const m of body.matchAll(loop)) {
    const tables = [...m[1].matchAll(/'([^']+)'/g)].map((t) => t[1].toLowerCase());
    const template = /'grant\s+([^']+?)\s+on\s+(?:table\s+)?(?:public\.)?%I\s+to\s+([^']+?)'/gi;
    for (const g of m[2].matchAll(template)) {
      for (const table of tables) out.push({ table, privileges: words(g[1]), grantees: words(g[2]) });
    }
  }
  return out;
}

function rlsTables(sql: string): Set<string> {
  const body = stripComments(sql);
  const out = new Set<string>();
  const plain = /\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?((?:"[^"]+"|[a-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[a-z_][\w$]*))?)\s+enable\s+row\s+level\s+security/gi;
  for (const m of body.matchAll(plain)) {
    const name = publicName(m[1]);
    if (name) out.add(name);
  }
  const loop = /\bforeach\s+\w+\s+in\s+array\s+array\s*\[([^\]]*)\]\s+loop\b([\s\S]*?)\bend\s+loop\b/gi;
  for (const m of body.matchAll(loop)) {
    if (!/'alter\s+table\s+(?:public\.)?%I\s+enable\s+row\s+level\s+security'/i.test(m[2])) continue;
    for (const t of m[1].matchAll(/'([^']+)'/g)) out.add(t[1].toLowerCase());
  }
  return out;
}

// `-- client grant lease_leads: the booking widget reads it with the anon key`
// The reason is three words or more on the comment's own line.
function clientGrantReasons(sql: string): Set<string> {
  const out = new Set<string>();
  const re = /--[^\S\n]*client[^\S\n]+grant[^\S\n]+(?:public\.)?([\w$]+)[^\S\n]*:[^\S\n]*\S+(?:[^\S\n]+\S+){2,}/gi;
  for (const m of sql.matchAll(re)) {
    out.add(m[1].toLowerCase());
  }
  return out;
}

/** What is wrong with one migration's new tables; empty when it follows the house rule. */
function problems(sql: string): string[] {
  const out: string[] = [];
  const all = grants(sql);
  const rls = rlsTables(sql);
  const reasons = clientGrantReasons(sql);
  for (const table of createdTables(sql)) {
    const mine = all.filter((g) => g.table === table);
    const service = mine.some(
      (g) => g.grantees.includes('service_role') && (g.privileges.includes('all') || g.privileges.includes('select')),
    );
    if (!service) out.push(`${table}: no grant to service_role (add "grant all on public.${table} to service_role;")`);
    if (!rls.has(table)) out.push(`${table}: RLS is not enabled (add "alter table public.${table} enable row level security;")`);
    for (const role of CLIENT_ROLES) {
      if (mine.some((g) => g.grantees.includes(role)) && !reasons.has(table)) {
        out.push(`${table}: granted to ${role} with no "-- client grant ${table}: <reason>" comment`);
      }
    }
  }
  return out;
}

describe('every new table carries its own grants', () => {
  test('every migration from the cutoff on grants its tables to service_role', () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'));
    assert.ok(files.length > 300, `found only ${files.length} migrations; is the path right?`);
    const failures: string[] = [];
    for (const file of files) {
      const date = /^(\d{8})/.exec(file)?.[1];
      if (!date || date < CUTOFF) continue;
      for (const p of problems(readMigration(file))) failures.push(`${file}: ${p}`);
    }
    assert.deepEqual(failures, [], `\n${failures.join('\n')}\n`);
  });

  // The guard reads the house forms off real files, so a regex that drifts
  // from how this repo writes grants fails here rather than passing silently.
  test('reads the three grant forms this repo uses', () => {
    for (const file of [
      '20261018200000_vendor_visit_proposals.sql', // one table, select/insert/update/delete
      '20261019200000_books_balance_sheet.sql', // comma list on one line
      '20261019190000_books_ledger_for_pnl.sql', // comma list across lines
      '20261021150000_lease_leads.sql', // do $$ foreach loop
      '20260926200000_helm_pms_plumbing.sql', // fifteen tables in one loop
    ]) {
      assert.deepEqual(problems(readMigration(file)), [], file);
    }
  });

  test('would have caught a real table that relied on the automatic grant', () => {
    // Written before the cutoff, so legal then; the same file dated today fails.
    assert.deepEqual(problems(readMigration('20261020140000_staff_documents.sql')), [
      'staff_documents: no grant to service_role (add "grant all on public.staff_documents to service_role;")',
    ]);
  });

  test('a table with RLS and no grant fails', () => {
    const sql = `create table if not exists public.widgets (id uuid primary key);
alter table public.widgets enable row level security;`;
    assert.deepEqual(problems(sql), [
      'widgets: no grant to service_role (add "grant all on public.widgets to service_role;")',
    ]);
  });

  test('a grant without RLS fails', () => {
    const sql = `create table public.widgets (id uuid primary key);
grant all on public.widgets to service_role;`;
    assert.deepEqual(problems(sql), [
      'widgets: RLS is not enabled (add "alter table public.widgets enable row level security;")',
    ]);
  });

  test('a grant to another table, or one the service role cannot read, does not count', () => {
    const other = `create table public.widgets (id int);
alter table public.widgets enable row level security;
grant all on public.gadgets to service_role;`;
    assert.equal(problems(other).length, 1);
    const blind = `create table public.widgets (id int);
alter table public.widgets enable row level security;
grant insert on public.widgets to service_role;`;
    assert.equal(problems(blind).length, 1);
  });

  test('a commented-out grant does not count', () => {
    const sql = `create table public.widgets (id int);
alter table public.widgets enable row level security;
-- grant all on public.widgets to service_role;`;
    assert.equal(problems(sql).length, 1);
  });

  test('an unqualified table is a public table', () => {
    const sql = `CREATE TABLE IF NOT EXISTS widgets (id int);
ALTER TABLE widgets ENABLE ROW LEVEL SECURITY;`;
    assert.equal(problems(sql).length, 1);
    assert.deepEqual(problems(`${sql}\nGRANT ALL ON widgets TO service_role;`), []);
  });

  test('a temp table and another schema are out of scope', () => {
    assert.deepEqual(problems('create temp table scratch as select 1;'), []);
    assert.deepEqual(problems('create table private.vault (id int);'), []);
  });

  test('a narrower service grant is a decision, and allowed', () => {
    const sql = `create table public.widgets (id int);
alter table public.widgets enable row level security;
grant select, insert on public.widgets to service_role;`;
    assert.deepEqual(problems(sql), []);
  });

  test('a loop covers only the tables it names', () => {
    const sql = `create table public.a (id int);
create table public.b (id int);
do $$ declare t text; begin
  foreach t in array array['a'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant all on public.%I to service_role', t);
  end loop; end $$;`;
    assert.deepEqual(problems(sql), [
      'b: no grant to service_role (add "grant all on public.b to service_role;")',
      'b: RLS is not enabled (add "alter table public.b enable row level security;")',
    ]);
  });

  test('a client grant needs a reason in the migration', () => {
    const base = `create table public.widgets (id int);
alter table public.widgets enable row level security;
grant all on public.widgets to service_role;
grant select on public.widgets to anon, authenticated;`;
    assert.deepEqual(problems(base), [
      'widgets: granted to anon with no "-- client grant widgets: <reason>" comment',
      'widgets: granted to authenticated with no "-- client grant widgets: <reason>" comment',
    ]);
    assert.deepEqual(
      problems(`-- client grant widgets: the public booking page reads it with the anon key\n${base}`),
      [],
    );
    // A bare marker with no reason is not a reason.
    assert.equal(problems(`-- client grant widgets: ok\n${base}`).length, 2);
  });
});
