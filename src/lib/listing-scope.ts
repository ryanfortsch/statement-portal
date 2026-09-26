/**
 * Two listing-level facts the importer and the dedupe both need, derived
 * from a channel_listings read the caller already made. Pure and
 * import-free, so node:test covers them (pms-guards itself is server-only).
 *
 *   exportLiveSince        which homes' OTAs read Helm's export, and since when
 *   guestyEchoPropertyIds  which homes' direct-feed closures are Guesty's
 *                          echoes and are dropped at import
 */

/** The channel_listings columns the Guesty-echo and strict-home rules read. */
export type ListingScopeRow = {
  property_id: string;
  channel: string;
  is_active: boolean | null;
  export_subscribed?: boolean | null;
  export_subscribed_at?: string | null;
};

/**
 * Homes whose OTAs read Helm's export, mapped to the moment they started:
 * every active non-Guesty row ticked export_subscribed, earliest tick wins.
 * Pure, so the importer and the dedupe derive it from a read they already
 * made.
 */
export function exportLiveSince(listings: readonly ListingScopeRow[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const l of listings) {
    if (!l.is_active || l.channel === 'guesty' || !l.export_subscribed) continue;
    const at = l.export_subscribed_at ?? null;
    const prev = out.get(l.property_id);
    if (!out.has(l.property_id)) out.set(l.property_id, at);
    else if (at && (!prev || Date.parse(at) < Date.parse(prev))) out.set(l.property_id, at);
  }
  return out;
}

/**
 * Property ids whose direct-feed closures are Guesty's echoes (see
 * loadAggregateFeedPropertyIds), from an already-loaded listing set.
 */
export function guestyEchoPropertyIds(listings: readonly ListingScopeRow[]): Set<string> {
  const live = exportLiveSince(listings);
  const out = new Set<string>();
  for (const l of listings) {
    if (l.is_active && l.channel === 'guesty' && !live.has(l.property_id)) out.add(l.property_id);
  }
  return out;
}

