import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { Stat } from '@/components/Stat';
import { getPlaybookEntries, getPropertyOptions } from '@/lib/playbook';
import { PlaybookClient } from './PlaybookClient';

export const dynamic = 'force-dynamic';

export default async function PlaybookPage() {
  const session = await auth();
  if (!session?.user?.email) redirect('/auth/signin?callbackUrl=/playbook');

  const [entries, properties] = await Promise.all([
    getPlaybookEntries({ includeUnpublished: true }),
    getPropertyOptions(),
  ]);

  const published = entries.filter((e) => e.status === 'published');
  const categoryCount = new Set(entries.filter((e) => e.status !== 'archived').map((e) => e.category)).size;
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const updatedThisMonth = entries.filter((e) => (e.updated_at || '').slice(0, 7) === ym).length;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="playbook" />

      <HelmHero
        eyebrow="Helm · Playbook"
        title="How we run"
        emphasis="the business."
        description="The standard operating procedures, the eccentricities, and the institutional knowledge of Rising Tide, written down once and searchable everywhere. Ask Helm reads from here too."
      />

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 8 }}>
        <div
          className="rt-helm-stat-strip"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            borderTop: '1px solid var(--ink)',
            borderBottom: '1px solid var(--ink)',
          }}
        >
          <Stat label="Entries" value={published.length} sub={`${entries.length} total incl. drafts`} />
          <Stat label="Categories" value={categoryCount || '—'} />
          <Stat label="Updated this month" value={updatedThisMonth || '—'} />
          <Stat label="Pinned" value={entries.filter((e) => e.pinned).length || '—'} accent last />
        </div>
      </section>

      <PlaybookClient entries={entries} properties={properties} />

      <div className="flex-1" />
      <HelmFooter module="Playbook" />
    </div>
  );
}
