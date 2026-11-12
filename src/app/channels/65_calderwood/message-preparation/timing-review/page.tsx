import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isOwnerSession } from '@/lib/helm-access-server';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { GuestyWritesNotice } from '@/components/channels/GuestyWritesNotice';
import { loadHomeWriteScope } from '@/lib/channels';
import { loadTimingReviewOverview } from '@/lib/channex-messaging/timing-review.server';
import { ReviewPanel } from './ReviewPanel';
export const dynamic = 'force-dynamic';
export default async function TimingReviewPage() {
  if (!await isOwnerSession()) redirect('/channels/65_calderwood');
  const initial = await loadTimingReviewOverview().catch(() => null);
  const writeScope = await loadHomeWriteScope('65_calderwood');
  return <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
    <HelmMasthead />
      <GuestyWritesNotice scope={writeScope} />
    <HelmHero plain eyebrow="65 Calderwood · Message handover" title="Saved timing reviews"
      line="Original send times, a clear handover, and a verified match for every stay." />
    <main className="w-full max-w-[1100px] mx-auto px-5 sm:px-10 pb-14">
      <Link href="/channels/65_calderwood/message-preparation" className="text-sm underline underline-offset-4">← Message preparation</Link>
      <ReviewPanel initial={initial} />
    </main><HelmFooter module="Saved timing reviews" right="65 Calderwood" />
  </div>;
}
