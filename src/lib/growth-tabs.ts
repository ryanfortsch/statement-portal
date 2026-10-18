/**
 * Which tab of the one Growth strip a pathname belongs to.
 *
 * The strip renders from the Growth layouts (/marketing, /guests,
 * /competitors), so no page names its own tab. Pathname prefixes alone
 * cannot decide it: Reviews lives at the bare /guests, and every other
 * /guests page (a guest's record, campaigns) belongs to Contacts, so
 * longest-prefix would light Reviews on all of them.
 *
 * `null` means no chrome at all: the agreement document preview is a sheet
 * that prints exactly as the guest's PDF reads.
 *
 * Pure: the client strip and the tests both import it.
 */
export type GrowthTabId = 'marketing' | 'reviews' | 'contacts' | 'agreements' | 'quotes' | 'competitors';

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

export function growthTabFor(pathname: string): GrowthTabId | null | undefined {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (/^\/guests\/agreements\/[^/]+\/doc$/.test(p)) return null;
  if (under(p, '/marketing')) return 'marketing';
  if (under(p, '/competitors')) return 'competitors';
  if (p === '/guests') return 'reviews';
  if (under(p, '/guests/agreements')) return 'agreements';
  if (under(p, '/guests/quotes')) return 'quotes';
  // Contacts, a guest's record, campaigns: the list and what is sent to it.
  if (under(p, '/guests')) return 'contacts';
  return undefined;
}
