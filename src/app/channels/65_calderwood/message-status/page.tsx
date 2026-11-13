import Link from 'next/link';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { isOwnerSession } from '@/lib/helm-access-server';
import { loadHomeWriteScope } from '@/lib/channels';
import { loadAutomationOperations } from '@/lib/channex-messaging/operations.server';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { GuestyWritesNotice } from '@/components/channels/GuestyWritesNotice';
import { AutomationStatusPanel } from './AutomationStatusPanel';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const metadata = { title: 'Calderwood automation status · Helm', robots: { index: false, follow: false } };
async function Status() { return <AutomationStatusPanel report={await loadAutomationOperations()} />; }
export default async function AutomationStatusPage() {
  if (!await isOwnerSession()) redirect('/channels/65_calderwood');
  const scope = await loadHomeWriteScope('65_calderwood');
  return <div className="flex min-h-screen flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
    <HelmMasthead />
      <GuestyWritesNotice scope={scope} />
    <HelmHero plain eyebrow="65 Calderwood · Messages" title="Automation status"
      line="See what is scheduled, what reached a provider and what needs attention." />
    <main className="mx-auto w-full max-w-[1100px] px-5 pb-14 sm:px-10">
      <nav className="flex flex-wrap gap-x-6 gap-y-3 text-sm" aria-label="Calderwood message navigation">
        <Link href="/channels/65_calderwood" className="underline underline-offset-4">← Calderwood</Link>
        <Link href="/channels/65_calderwood/message-preparation" className="underline underline-offset-4">Message handover</Link>
        <Link href="/channels/65_calderwood/message-preparation/templates" className="underline underline-offset-4">Original templates & cleaner setup</Link>
      </nav>
      <Suspense fallback={<p className="mt-7 rounded-2xl border p-6" role="status" style={{ borderColor: 'var(--rule)' }}>Checking Helm message records…</p>}><Status /></Suspense>
    </main><HelmFooter module="Automation status" right="65 Calderwood" />
  </div>;
}
