import { redirect } from 'next/navigation';

/** Retired: Hiring is the Applicants section at the top of each trade's
 *  roster now, with the one invite door. Old links (the applicant email's
 *  "Review in Helm", a bookmark) land there with the trade kept. */
export default async function RetiredHiringPage({ searchParams }: { searchParams: Promise<{ trade?: string }> }) {
  const { trade } = await searchParams;
  redirect(`/fieldwork/roster${trade ? `?trade=${encodeURIComponent(trade)}` : ''}#applicants`);
}
