import { auth } from '@/auth';
import { notFound, redirect } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { getPlaybookEntryBySlug, getPropertyOptions } from '@/lib/playbook';
import { PlaybookEditor } from '../../PlaybookEditor';

export const dynamic = 'force-dynamic';

export default async function EditPlaybookEntryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  if (!session?.user?.email) redirect(`/auth/signin?callbackUrl=/playbook/${slug}/edit`);

  const [entry, properties] = await Promise.all([getPlaybookEntryBySlug(slug), getPropertyOptions()]);
  if (!entry) notFound();

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="playbook" />
      <PlaybookEditor mode="edit" initial={entry} properties={properties} />
      <div className="flex-1" />
      <HelmFooter module="Playbook" />
    </div>
  );
}
