import 'server-only';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { PRODUCTION_DB_URL } from '../channex-production-runtime.ts';
import type { InventoryPlanningStore } from './planner.ts';
const result = z.object({ status: z.enum(['stored', 'unchanged', 'refreshed', 'superseded']),
  version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
/** Explicit production storage only. No credentials fallback, provider client,
 * activation API, calendar-authority change or send/ACK operation. */
export function createInventoryPlanningStore(url: string, key: string, fetcher: typeof fetch = fetch): InventoryPlanningStore {
  if (typeof window !== 'undefined' || url !== PRODUCTION_DB_URL || !key.trim()) throw Error('Explicit production storage required');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher } });
  return {
    async read() {
      try {
        const r = await db.rpc('helm_channex_inventory_read');
        if (r.error || !r.data) throw Error();
        return r.data;
      } catch { throw Error('Inventory snapshot unavailable'); }
    },
    async commit(expected, plan) {
      try {
        const r = await db.rpc('helm_channex_inventory_plan_commit', { p_expected: expected, p_plan: plan });
        if (r.error) throw Error();
        return result.parse(r.data);
      } catch { throw Error('Inventory plan save uncertain; reread before continuing'); }
    },
  };
}
