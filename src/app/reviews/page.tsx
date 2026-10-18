import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Reviews is the Reviews tab of the Growth strip, at the bare /guests.
 * This route is kept as a permanent redirect so existing bookmarks and
 * any stray links land on that tab (the Marketing page's five-star tile
 * links /guests?days=N directly and never passes through here).
 * Forwards the filter query string through so a deep-link like
 * /reviews?days=30&rating=below still scopes correctly.
 */
export default async function ReviewsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  // Reviews is the default lens at bare /guests, so no tab param needed.
  for (const key of ['days', 'rating', 'channel', 'property', 'q'] as const) {
    const v = sp[key];
    if (typeof v === 'string' && v) qs.set(key, v);
  }
  const query = qs.toString();
  redirect(query ? `/guests?${query}` : '/guests');
}
