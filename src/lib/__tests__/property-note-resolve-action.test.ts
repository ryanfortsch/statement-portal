import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';

// Execute the actual server module with real PostgREST serialization, a fake
// transport, and synthetic auth. Unrelated dependencies never perform I/O.
const source = readFileSync(new URL('../../app/properties/actions.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture(options: { resolved?: boolean; signedIn?: boolean; readError?: boolean; writeError?: boolean; missing?: boolean } = {}) {
  let row = { resolved_at: options.resolved ? '2026-09-01T00:00:00.000Z' : null as string | null, resolved_by_email: options.resolved ? 'original@example.test' : null as string | null };
  const writes: Record<string, unknown>[] = [], refreshed: string[] = [];
  let reads = 0;
  const client = createClient('https://synthetic.supabase.co', 'synthetic-key', {
    auth: { persistSession: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, '/rest/v1/property_notes');
      assert.equal(url.searchParams.get('id'), 'eq.note-a');
      assert.equal(url.searchParams.get('property_id'), 'eq.home-a');
      const patch = init?.method === 'PATCH';
      if (patch ? options.writeError : options.readError) return new Response(JSON.stringify({ message: 'Synthetic database failure', code: 'TEST' }), { status: 400, headers: { 'content-type': 'application/json' } });
      if (patch) {
        const data = JSON.parse(String(init?.body)); writes.push(data); row = { ...row, ...data };
        return new Response(null, { status: 204 });
      }
      reads++;
      return new Response(JSON.stringify(options.missing ? null : row), { headers: { 'content-type': 'application/json' } });
    } },
  });
  const exports: { togglePropertyNoteResolved?: (propertyId: string, noteId: string, resolveOnly?: boolean) => Promise<void> } = {};
  runInNewContext(compiled, {
    exports, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key' } },
    require: (name: string) => name === '@supabase/supabase-js' ? { createClient: () => client }
      : name === '@/auth' ? { auth: async () => options.signedIn === false ? null : { user: { email: 'staff@example.test' } } }
      : name === 'next/cache' ? { revalidatePath: (path: string) => refreshed.push(path) } : {},
  });
  return { action: exports.togglePropertyNoteResolved!, writes, refreshed, row: () => row, reads: () => reads };
}

describe('property flag Resolve command', () => {
  test('a lost response followed by retry keeps the note resolved and preserves the original stamp', async () => {
    const f = fixture();
    await f.action('home-a', 'note-a', true);
    const stamp = f.row().resolved_at;
    assert.ok(stamp); assert.equal(f.writes.length, 1);
    await f.action('home-a', 'note-a', true);
    assert.equal(f.row().resolved_at, stamp); assert.equal(f.writes.length, 1);
    assert.equal(f.row().resolved_by_email, 'staff@example.test');
    assert.deepEqual(f.refreshed, ['/properties/home-a', '/properties/home-a']);
  });
  test('already resolved flags retain who resolved them and when', async () => {
    const f = fixture({ resolved: true }); await f.action('home-a', 'note-a', true);
    assert.equal(f.writes.length, 0); assert.equal(f.row().resolved_by_email, 'original@example.test');
    assert.equal(f.row().resolved_at, '2026-09-01T00:00:00.000Z');
  });
  test('existing toggle callers still reopen and resolve notes', async () => {
    const f = fixture({ resolved: true }); await f.action('home-a', 'note-a');
    assert.equal(f.row().resolved_at, null); assert.equal(f.row().resolved_by_email, null);
    await f.action('home-a', 'note-a'); assert.ok(f.row().resolved_at); assert.equal(f.writes.length, 2);
  });
  test('unsigned callers cannot read or change a note', async () => {
    const f = fixture({ signedIn: false }); await assert.rejects(f.action('home-a', 'note-a', true), /Not signed in/);
    assert.equal(f.reads(), 0); assert.equal(f.writes.length, 0);
  });
  test('missing notes and database failures are not acknowledged or revalidated', async () => {
    for (const options of [{ missing: true }, { readError: true }, { writeError: true }]) {
      const f = fixture(options); await assert.rejects(f.action('home-a', 'note-a', true));
      assert.equal(f.writes.length, 0); assert.deepEqual(f.refreshed, []);
    }
  });
});
