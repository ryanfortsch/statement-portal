import { supabase } from '@/lib/supabase';

/**
 * Owner portfolio: the other properties (and open prospects) that belong to
 * the same owner, matched by shared email address.
 *
 * Why email, not owner_id: the canonical `owners` table + `properties.owner_id`
 * FK exist but nothing in the app reads them — they were a backfill experiment
 * and promote-from-prospect never populates owner_id. The owner identity that
 * IS load-bearing everywhere (statements, draft-owner-email, and the Owner
 * Messaging routing in stay-concierge) is the email address. So an owner's
 * portfolio is reliably "every property/prospect whose owner emails overlap
 * mine."
 *
 * This keeps a one-owner-many-properties owner (e.g. Simon Prudenzi adding the
 * bottom floor of 53 Rocky Neck as a second unit) unified with zero schema
 * churn: reuse the same email on the new property/prospect and it groups
 * automatically, and the Owner Messaging inbox already collapses by email so
 * his texts stay on one thread.
 *
 * Tables here are tiny (~13 properties, a handful of prospects) so we fetch
 * and intersect in JS with normalized (lowercased, trimmed) emails — simpler
 * and more correct than a case-sensitive Postgres array-overlap.
 */

export type PortfolioProperty = {
  id: string;
  name: string;
  address: string | null;
  is_active: boolean | null;
};

export type PortfolioProspect = {
  id: string;
  property_address: string;
  prospect_name: string;
  status: string;
};

export type OwnerPortfolio = {
  /** Other managed properties that share an owner email. */
  properties: PortfolioProperty[];
  /** Open (un-promoted) prospects that share an owner email. */
  prospects: PortfolioProspect[];
};

function normEmails(emails: Array<string | null | undefined> | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const e of emails ?? []) {
    const v = (e ?? '').trim().toLowerCase();
    if (v) out.add(v);
  }
  return out;
}

function overlaps(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

/** Pull every owner email off a property row (denormalized array + owners cards). */
function propertyOwnerEmails(p: {
  owner_emails?: string[] | null;
  owners?: Array<{ email?: string | null }> | null;
}): Set<string> {
  const set = normEmails(p.owner_emails);
  for (const card of p.owners ?? []) {
    const v = (card?.email ?? '').trim().toLowerCase();
    if (v) set.add(v);
  }
  return set;
}

/** Pull every owner email off a prospect (projection) row. */
function prospectOwnerEmails(p: {
  prospect_email?: string | null;
  owners?: Array<{ email?: string | null }> | null;
}): Set<string> {
  const set = new Set<string>();
  const primary = (p.prospect_email ?? '').trim().toLowerCase();
  if (primary) set.add(primary);
  for (const card of p.owners ?? []) {
    const v = (card?.email ?? '').trim().toLowerCase();
    if (v) set.add(v);
  }
  return set;
}

/**
 * Find the portfolio for a set of owner emails. Excludes the property and/or
 * prospect the caller is already looking at (so the page doesn't list itself).
 */
export async function getOwnerPortfolio(args: {
  emails: Array<string | null | undefined>;
  excludePropertyId?: string;
  excludeProjectionId?: string;
}): Promise<OwnerPortfolio> {
  const target = normEmails(args.emails);
  if (target.size === 0) return { properties: [], prospects: [] };

  const [propsRes, projsRes] = await Promise.all([
    supabase.from('properties').select('id, name, address, is_active, owner_emails, owners'),
    supabase
      .from('projections')
      .select('id, property_address, prospect_name, status, property_id, prospect_email, owners'),
  ]);

  const properties: PortfolioProperty[] = [];
  for (const row of (propsRes.data ?? []) as Array<Record<string, unknown>>) {
    if (args.excludePropertyId && row.id === args.excludePropertyId) continue;
    const emails = propertyOwnerEmails(row as never);
    if (!overlaps(target, emails)) continue;
    properties.push({
      id: row.id as string,
      name: (row.name as string) ?? (row.address as string) ?? (row.id as string),
      address: (row.address as string) ?? null,
      is_active: (row.is_active as boolean) ?? null,
    });
  }

  const prospects: PortfolioProspect[] = [];
  for (const row of (projsRes.data ?? []) as Array<Record<string, unknown>>) {
    if (args.excludeProjectionId && row.id === args.excludeProjectionId) continue;
    // Only OPEN prospects (not yet promoted into a property) — a promoted
    // prospect is already represented by its property above.
    if (row.property_id) continue;
    const emails = prospectOwnerEmails(row as never);
    if (!overlaps(target, emails)) continue;
    prospects.push({
      id: row.id as string,
      property_address: (row.property_address as string) ?? '',
      prospect_name: (row.prospect_name as string) ?? '',
      status: (row.status as string) ?? 'draft',
    });
  }

  return { properties, prospects };
}
