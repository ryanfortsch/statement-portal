import { redirect } from 'next/navigation';
import { monthKey, parseMonthParam } from '@/lib/calendar-model';

/**
 * The per-home month grid folded into the channel hub on 2026-11-08 (audit
 * 2026-11-07, finding 4): the hub's calendar is the home's one calendar, with
 * the unsellable-nights legend and Set a range under it. Old links keep
 * working and land on the same month there.
 */
export default async function PropertyMonthGridRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { propertyId } = await params;
  const sp = await searchParams;
  const raw = Array.isArray(sp.month) ? sp.month[0] ?? '' : sp.month ?? '';
  const ym = parseMonthParam(raw);
  const query = ym ? `?month=${monthKey(ym.year, ym.month)}` : '';
  redirect(`/channels/${encodeURIComponent(propertyId)}${query}#calendar`);
}
