import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isOwnerSession } from '@/lib/helm-access-server';
import { HelmMasthead } from '@/components/HelmMasthead';
import { GuestyWritesNotice } from '@/components/channels/GuestyWritesNotice';
import { loadHomeWriteScope } from '@/lib/channels';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { PreparationReview } from './PreparationReview';

export const dynamic = 'force-dynamic';
export default async function MessagePreparationPage() {
  if (!await isOwnerSession()) redirect('/channels/65_calderwood');
  const writeScope = await loadHomeWriteScope('65_calderwood');
  return <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <GuestyWritesNotice scope={writeScope} />
    <HelmHero plain eyebrow="65 Calderwood · Channex preparation" title="Message handover"
      line="Keep the guest and cleaner experience familiar, with every message accounted for." />
    <main className="w-full max-w-[1100px] mx-auto px-5 sm:px-10 pb-14">
      <Link href="/channels/65_calderwood" className="text-sm underline underline-offset-4">← Calderwood</Link>
      <Link href="/channels/65_calderwood/message-preparation/templates" className="ml-6 text-sm underline underline-offset-4">Review original templates and release →</Link>
      <PreparationReview />
    </main>
    <HelmFooter module="Message handover" right="65 Calderwood" />
  </div>;
}
