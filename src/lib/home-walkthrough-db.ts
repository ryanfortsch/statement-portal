import 'server-only';

import { getServiceClient, isServiceConfigured } from '@/lib/supabase-admin';
import {
  mergeLegacyStates,
  normalizeWalkthroughState,
  type WalkthroughState,
} from '@/lib/home-walkthrough';

/**
 * Persistence for the outfitting walkthrough: one public.home_walkthroughs
 * row per home, keyed by its prospect (projection_id), its property
 * (property_id), or both once the prospect is promoted. RLS-locked,
 * service role only.
 *
 * A home with no row yet reads the two retired stores
 * (projections.readiness_state, property_order_checklist) for one release,
 * so a count made before the carry-over, or on the previous deployment
 * during the skew window, still shows; the first write moves it here.
 */

export type WalkthroughHome = { projectionId: string | null; propertyId: string | null };

type Row = { id: string; projection_id: string | null; property_id: string | null; state: unknown };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROPERTY_ID = /^[a-z0-9_]{1,60}$/;

/** Fill in the home's other link: a promoted prospect's property, a property's prospect. */
export async function resolveWalkthroughHome(home: Partial<WalkthroughHome>): Promise<WalkthroughHome> {
  const sb = getServiceClient();
  let projectionId = home.projectionId && UUID.test(home.projectionId) ? home.projectionId : null;
  let propertyId = home.propertyId && PROPERTY_ID.test(home.propertyId) ? home.propertyId : null;
  if (propertyId && !projectionId) {
    const { data } = await sb.from('properties').select('projection_id').eq('id', propertyId).maybeSingle();
    projectionId = (data?.projection_id as string | null) ?? null;
  }
  if (projectionId && !propertyId) {
    const { data } = await sb.from('projections').select('property_id').eq('id', projectionId).maybeSingle();
    propertyId = (data?.property_id as string | null) ?? null;
  }
  return { projectionId, propertyId };
}

async function findRow(home: WalkthroughHome): Promise<Row | null> {
  const filters = [
    home.propertyId ? `property_id.eq.${home.propertyId}` : null,
    home.projectionId ? `projection_id.eq.${home.projectionId}` : null,
  ].filter(Boolean);
  if (filters.length === 0) return null;
  const { data, error } = await getServiceClient()
    .from('home_walkthroughs')
    .select('id, projection_id, property_id, state')
    .or(filters.join(','))
    .limit(2);
  if (error) throw new Error(`home walkthrough read: ${error.message}`);
  const rows = (data ?? []) as Row[];
  // The property's row wins if a prospect row was never attached to it.
  return rows.find((r) => home.propertyId && r.property_id === home.propertyId) ?? rows[0] ?? null;
}

async function readLegacy(home: WalkthroughHome): Promise<WalkthroughState> {
  const sb = getServiceClient();
  const [readiness, order] = await Promise.all([
    home.projectionId
      ? sb.from('projections').select('readiness_state').eq('id', home.projectionId).maybeSingle()
      : Promise.resolve({ data: null }),
    home.propertyId
      ? sb.from('property_order_checklist').select('state').eq('property_id', home.propertyId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return mergeLegacyStates(
    (readiness.data as { readiness_state?: unknown } | null)?.readiness_state ?? null,
    (order.data as { state?: unknown } | null)?.state ?? null,
  );
}

/** The home's walkthrough state (empty when nothing was ever counted). */
export async function loadWalkthrough(home: WalkthroughHome): Promise<WalkthroughState> {
  if (!isServiceConfigured || (!home.projectionId && !home.propertyId)) return { have: {}, notes: {} };
  const row = await findRow(home);
  return row ? normalizeWalkthroughState(row.state) : readLegacy(home);
}

/**
 * Read, change and write the home's state. Creates the row on the first
 * write (from the legacy stores when they hold anything) and attaches the
 * missing link once it is known, so a prospect's row becomes the property's.
 */
export async function updateWalkthrough(
  home: WalkthroughHome,
  change: (state: WalkthroughState) => WalkthroughState,
  updatedByEmail: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (!isServiceConfigured) return { ok: false, error: 'Service role not configured' };
  if (!home.projectionId && !home.propertyId) return { ok: false, error: 'Unknown home' };
  const sb = getServiceClient();
  for (let attempt = 0; attempt < 2; attempt++) {
    let row: Row | null;
    try {
      row = await findRow(home);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const base = row ? normalizeWalkthroughState(row.state) : await readLegacy(home);
    const now = new Date().toISOString();
    const state = { ...change(base), updated_at: now };
    if (row) {
      const patch: Record<string, unknown> = { state, updated_by_email: updatedByEmail, updated_at: now };
      if (!row.property_id && home.propertyId) patch.property_id = home.propertyId;
      if (!row.projection_id && home.projectionId) patch.projection_id = home.projectionId;
      const { data, error } = await sb.from('home_walkthroughs').update(patch).eq('id', row.id).select('id');
      if (error) return { ok: false, error: error.message };
      if (!data?.length) return { ok: false, error: 'Could not confirm the walkthrough was saved' };
      return { ok: true };
    }
    const { data, error } = await sb
      .from('home_walkthroughs')
      .insert({ projection_id: home.projectionId, property_id: home.propertyId, state, updated_by_email: updatedByEmail, updated_at: now })
      .select('id');
    // 23505: another tap created the row first. Read it and apply this change on top.
    if (error?.code === '23505' && attempt === 0) continue;
    if (error) return { ok: false, error: error.message };
    if (!data?.length) return { ok: false, error: 'Could not confirm the walkthrough was saved' };
    return { ok: true };
  }
  return { ok: false, error: 'Could not save the walkthrough. Try again.' };
}
