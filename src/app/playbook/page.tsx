import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { getPlaybookEntries } from '@/lib/playbook-server';
import { getPropertyOptions } from '@/lib/playbook-properties';
import { PlaybookClient } from './PlaybookClient';

export const dynamic = 'force-dynamic';

export default async function PlaybookPage() {
  const session = await auth();
  if (!session?.user?.email) redirect('/auth/signin?callbackUrl=/playbook');

  const [entries, properties] = await Promise.all([
    getPlaybookEntries({ includeUnpublished: true }),
    getPropertyOptions(),
  ]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />

      <HelmHero plain eyebrow="Helm · Playbook" title="Playbook" />

      <PlaybookClient entries={entries} properties={properties} />

      <div className="flex-1" />
      <HelmFooter module="Playbook" />
    </div>
  );
}
