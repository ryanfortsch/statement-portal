import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Reviews is now a tab inside the Guests section, not its own page.
 * This route is kept as a permanent redirect so existing bookmarks,
 * the home "Five-star reviews" tile, and any links elsewhere land on
 * the Reviews tab. Forwards the filter query string through so a
 * deep-link like /reviews?days=30&rating=below still scopes correctly.
 */
export default async function ReviewsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  qs.set('tab', 'reviews');
  for (const key of ['days', 'rating', 'channel', 'property', 'q'] as const) {
    const v = sp[key];
    if (typeof v === 'string' && v) qs.set(key, v);
  }
  redirect(`/guests?${qs.toString()}`);
}
