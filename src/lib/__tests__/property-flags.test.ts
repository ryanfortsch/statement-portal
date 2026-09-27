import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { loadPropertyFlags } from '../property-flags-load.ts';

type Table = 'inspection_notes' | 'property_notes';
type Failure = 'database' | 'network' | 'missing-count';

// Use the real PostgREST client with a fake transport: the count only arrives
// if the query requests it, and the response rows obey the query's limit.
// No real credentials, network requests, or production records are involved.
function fixture(options: {
  walks?: number;
  notes?: number;
  failures?: Partial<Record<Table, Failure>>;
} = {}) {
  return createClient('https://flags-test.supabase.co', 'synthetic-key', {
    auth: { persistSession: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const table = url.pathname.split('/').pop() as Table;
        assert.ok(table === 'inspection_notes' || table === 'property_notes');
        assert.equal(url.searchParams.get('property_id'), 'eq.test-house');
        assert.equal(url.searchParams.get('resolved_at'), 'is.null');
        if (table === 'inspection_notes') {
          assert.equal(url.searchParams.get('note_type'), 'eq.PROPERTY_NOTE');
        }

        const failure = options.failures?.[table];
        // An aborted transport fails immediately, without the client's retry
        // backoff making an offline regression test wait several seconds.
        if (failure === 'network') throw new DOMException('Synthetic request abort', 'AbortError');
        if (failure === 'database') {
          return new Response(JSON.stringify({ message: 'Synthetic database failure' }), {
            status: 503, headers: { 'content-type': 'application/json', 'retry-after': '0' },
          });
        }

        const total = (table === 'inspection_notes' ? options.walks : options.notes) ?? 0;
        const cap = Number(url.searchParams.get('limit') ?? total);
        const rows = Array.from({ length: Math.min(total, cap) }, (_, i) => ({
          id: `${table}-${i}`,
          created_at: new Date(Date.UTC(2026, 8, 20, table === 'inspection_notes' ? 12 : 11, -i)).toISOString(),
          author_email: null, photo_urls: null,
          ...(table === 'inspection_notes'
            ? { note_text: `Walk flag ${i}`, inspection_id: 'inspection-1' }
            : { title: `Note flag ${i}`, body: 'Details', guest_facing: false }),
        }));
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        const wantsCount = new Headers(init?.headers).get('prefer')?.includes('count=exact');
        if (wantsCount && failure !== 'missing-count') {
          headers['content-range'] = `${rows.length ? `0-${rows.length - 1}` : '*'}/${total}`;
        }
        return new Response(JSON.stringify(rows), { status: 200, headers });
      },
    },
  });
}

describe('property flags remain honest when counts are capped or reads fail', () => {
  test('counts all open rows in both sources while returning only the newest display rows', async () => {
    const result = await loadPropertyFlags(fixture({ walks: 27, notes: 30 }), 'test-house');
    assert.equal(result.total, 57);
    assert.equal(result.flags.length, 12);
    assert.equal(result.flags[0].text, 'Walk flag 0');
  });

  test('merges both sources in newest-first order and honors a smaller display limit', async () => {
    const result = await loadPropertyFlags(fixture({ walks: 1, notes: 4 }), 'test-house', 3);
    assert.equal(result.total, 5);
    assert.deepEqual(result.flags.map(f => [f.source, f.text]), [
      ['walk', 'Walk flag 0'], ['note', 'Note flag 0'], ['note', 'Note flag 1'],
    ]);
  });

  test('a successful empty result is a known zero', async () => {
    assert.deepEqual(await loadPropertyFlags(fixture(), 'test-house'), { flags: [], total: 0 });
  });

  for (const failed of ['inspection_notes', 'property_notes'] as const) {
    for (const failure of ['database', 'network'] as const) {
      test(`${failure} failure in ${failed} preserves the other source and marks the total unknown`, async () => {
        const result = await loadPropertyFlags(fixture({
          walks: 2, notes: 3, failures: { [failed]: failure },
        }), 'test-house');
        assert.equal(result.total, null);
        assert.equal(result.flags.length, failed === 'inspection_notes' ? 3 : 2);
        assert.ok(result.flags.every(f => f.source === (failed === 'inspection_notes' ? 'note' : 'walk')));
      });
    }
  }

  test('two failed sources remain unavailable, never a known empty list', async () => {
    assert.deepEqual(await loadPropertyFlags(fixture({
      failures: { inspection_notes: 'database', property_notes: 'network' },
    }), 'test-house'), { flags: [], total: null });
  });

  test('missing exact counts do not silently fall back to the capped array length', async () => {
    const result = await loadPropertyFlags(fixture({
      walks: 1, notes: 30, failures: { property_notes: 'missing-count' },
    }), 'test-house');
    assert.equal(result.total, null);
    assert.equal(result.flags.length, 12);
  });

  test('missing configuration remains unavailable', async () => {
    assert.deepEqual(await loadPropertyFlags(null, 'test-house'), { flags: [], total: null });
  });
});
