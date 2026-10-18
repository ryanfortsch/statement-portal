import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { LLC_ENTITIES } from '@/lib/books';
import { isValidCategoryKey } from '@/lib/books-categorizer';
import { applyBooksFilter, parseBooksFilter } from '@/lib/books-review-filter';
import { selectAllPaged } from '@/lib/paged-select';

/**
 * Review actions on the ledger.
 *
 * One endpoint with three modes (via `action`):
 *
 *   action = 'confirm'  (default)
 *     Per-row confirm. Body: { transaction_id, category_key? }
 *     If category_key is omitted, accepts the existing ai_category_key
 *     as-is. Sets reviewed=true, reviewed_at=now, category_key=chosen.
 *
 *   action = 'unconfirm'
 *     Per-row unconfirm. Body: { transaction_id }
 *     Clears category_key, reviewed=false. AI proposal stays put.
 *
 *   action = 'accept_high_confidence'
 *     Batch. Body: { entity_id, quarter?, q? }
 *     For all rows in this entity where reviewed=false AND ai_confidence='high'
 *     AND ai_category_key IS NOT NULL: copy ai_category_key -> category_key,
 *     set reviewed=true. Skips rows with category_key already set. quarter
 *     and q narrow it to the review table's filter. Every candidate is read,
 *     not the first 1000.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => ({}));
    const action: string = body.action || 'confirm';

    if (action === 'confirm') {
      const id: string = (body.transaction_id || '').trim();
      const explicit: string | undefined = body.category_key;
      if (!id) return NextResponse.json({ error: 'transaction_id is required' }, { status: 400 });

      // Need to know the entity to validate the category_key against the
      // applicable chart of accounts.
      const { data: row, error: getErr } = await supabase
        .from('ledger_transactions')
        .select('id, entity_id, ai_category_key')
        .eq('id', id)
        .single();
      if (getErr || !row) {
        return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
      }
      const key = (explicit || (row as { ai_category_key: string | null }).ai_category_key || '').trim();
      if (!key) {
        return NextResponse.json({ error: 'No category_key provided and no ai_category_key on file' }, { status: 400 });
      }
      const entityId = (row as { entity_id: string }).entity_id;
      if (!isValidCategoryKey(entityId, key)) {
        return NextResponse.json({ error: `Invalid category_key for ${entityId}: ${key}` }, { status: 400 });
      }

      const { error: updErr } = await supabase
        .from('ledger_transactions')
        .update({
          category_key: key,
          reviewed: true,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
      return NextResponse.json({ success: true, action, transaction_id: id, category_key: key });
    }

    if (action === 'unconfirm') {
      const id: string = (body.transaction_id || '').trim();
      if (!id) return NextResponse.json({ error: 'transaction_id is required' }, { status: 400 });
      const { error: updErr } = await supabase
        .from('ledger_transactions')
        .update({
          category_key: null,
          reviewed: false,
          reviewed_at: null,
        })
        .eq('id', id);
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
      return NextResponse.json({ success: true, action, transaction_id: id });
    }

    if (action === 'accept_high_confidence') {
      const entityId: string = (body.entity_id || '').trim();
      if (!entityId || !LLC_ENTITIES[entityId]) {
        return NextResponse.json({ error: `Unknown entity_id: ${entityId}` }, { status: 400 });
      }
      // Read candidates first so we can return a count + sample. The
      // update could be a single SQL UPDATE, but Supabase's REST client
      // doesn't let us SET category_key = ai_category_key in one go
      // without a function. Do it in two passes: load, then update.
      const scope = parseBooksFilter({ all: '1', quarter: body.quarter, q: body.q });
      let rows: { id: string; ai_category_key: string }[];
      try {
        rows = await selectAllPaged<{ id: string; ai_category_key: string }>(
          (from, to) =>
            applyBooksFilter(
              supabase
                .from('ledger_transactions')
                .select('id, ai_category_key')
                .eq('entity_id', entityId)
                .eq('reviewed', false)
                .eq('ai_confidence', 'high')
                .not('ai_category_key', 'is', null)
                .is('category_key', null),
              scope,
            )
              .order('id', { ascending: true })
              .range(from, to),
          { label: 'accept high confidence' },
        );
      } catch (loadErr) {
        return NextResponse.json({ error: loadErr instanceof Error ? loadErr.message : String(loadErr) }, { status: 500 });
      }

      let accepted = 0;
      const now = new Date().toISOString();
      // Group by category for fewer UPDATEs (one per distinct category).
      const byKey = new Map<string, string[]>();
      for (const r of rows) {
        if (!r.ai_category_key) continue;
        const ids = byKey.get(r.ai_category_key) || [];
        ids.push(r.id);
        byKey.set(r.ai_category_key, ids);
      }
      for (const [key, ids] of byKey.entries()) {
        if (!isValidCategoryKey(entityId, key)) continue;
        // Chunked: with the 1000-row cap gone one category can carry
        // thousands of ids, too many for one URL's in() list.
        for (let i = 0; i < ids.length; i += 200) {
          const chunk = ids.slice(i, i + 200);
          const { error: updErr } = await supabase
            .from('ledger_transactions')
            .update({ category_key: key, reviewed: true, reviewed_at: now })
            .in('id', chunk);
          if (!updErr) accepted += chunk.length;
        }
      }
      return NextResponse.json({ success: true, action, entity_id: entityId, candidates: rows.length, accepted });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    console.error('books/review error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
