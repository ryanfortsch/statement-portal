import { createClient } from '@supabase/supabase-js';
import { bindInventoryRoute } from './inventory-route.ts';
import type { BookingInventoryState } from './booking-inventory-consumer.ts';

/** Service can only read owner-reviewed destinations. No creation or fallback mapping. */
export function createInventoryRouteReader(url: string, key: string, fetcher: typeof fetch = fetch) {
  if (typeof window !== 'undefined' || url !== 'https://jgkblfozftcvymvwhhii.supabase.co' || !key.trim()) {
    throw Error('Explicit isolated staging mapping storage required');
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher } });
  return async (state: BookingInventoryState) => {
    const { data, error } = await db.rpc('helm_staging_inventory_route_read', {
      p_property: state.property, p_connection: state.configuration.connection, p_generation: state.configuration.generation,
    });
    if (error || !data) throw Error('Reviewed staging inventory mapping unavailable');
    return bindInventoryRoute(data, state);
  };
}
