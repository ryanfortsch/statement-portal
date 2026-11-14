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
import { CALDERWOOD_NEW_CONFIRMATION_POLICY } from '@/lib/channex-messaging/confirmation-policy';

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
      <section className="mt-7 rounded-2xl border p-5 sm:p-6" style={{ borderColor: 'var(--rule)', background: 'var(--paper-2)' }} aria-labelledby="confirmation-policy">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="confirmation-policy" className="font-semibold">New Airbnb booking confirmations</h2>
          <span className="rounded-full border px-2.5 py-1 text-xs" style={{ borderColor: 'var(--rule)' }}>Timing approved</span>
        </div>
        <p className="mt-3 text-sm leading-relaxed">For verified new bookings, send {CALDERWOOD_NEW_CONFIRMATION_POLICY.minutes} minutes after Helm first receives the booking.
          Retries and booking changes do not restart the timer.</p>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--ink-3)' }}>Other message timings stay unchanged, including the usual 3 PM key-code message.
          This approves the timing only; it does not turn on sending. Existing and imported stays still need their separate handover review.</p>
      </section>
      <Suspense fallback={<p className="mt-7 rounded-2xl border p-6" role="status" style={{ borderColor: 'var(--rule)' }}>Checking Helm message records…</p>}><Status /></Suspense>
    </main><HelmFooter module="Automation status" right="65 Calderwood" />
  </div>;
}
