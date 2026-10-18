import { redirect } from 'next/navigation';

/** Retired: the one-off job is one kind on the Send a job form now.
 *  Old links (the board's, the onboarding hub's, a bookmark) land on that
 *  form with the kind picked and the lit trade kept. */
export default async function RetiredAdhocPage({ searchParams }: { searchParams: Promise<{ trade?: string }> }) {
  const { trade } = await searchParams;
  const q = new URLSearchParams({ kind: 'adhoc' });
  if (trade) q.set('trade', trade);
  redirect(`/fieldwork/packets/new?${q}`);
}
