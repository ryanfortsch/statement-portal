import Link from 'next/link';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { isOwnerSession } from '@/lib/helm-access-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { PRODUCTION_DB_URL } from '@/lib/channex-production-runtime';
import { readInventoryOperations, type InventoryOperations } from '@/lib/channex-inventory/operations';
import { GuestyWritesNotice } from '@/components/channels/GuestyWritesNotice';
import { loadHomeWriteScope } from '@/lib/channels';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { InventoryStatusPanel } from './InventoryStatusPanel';
import { ChannelAuditSection } from './ChannelAuditPanel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Calderwood calendar sync · Helm', robots: { index: false, follow: false } };
export default async function CalendarSyncStatusPage() {
  if (!await isOwnerSession()) redirect('/channels/65_calderwood');
  const writeScope = await loadHomeWriteScope('65_calderwood');
  let report: InventoryOperations | null = null;
  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL !== PRODUCTION_DB_URL) throw Error('Production storage required');
    report = await readInventoryOperations(async (name, args) => {
      const { data, error } = await supabaseAdmin.rpc(name, args); return { data, error };
    });
  } catch { /* Render unavailable rather than a misleading empty queue. */ }
  return <div className="min-h-screen flex flex-col" style={{ background:'var(--paper)', color:'var(--ink)' }}>
      <HelmMasthead />
      <GuestyWritesNotice scope={writeScope} />
    <HelmHero plain eyebrow="65 Calderwood · Channex" title="Calendar sync"
      line="See what reached Channex, what is waiting and what needs attention." />
    <main className="mx-auto w-full max-w-[1100px] px-5 pb-14 sm:px-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link href="/channels/65_calderwood" className="text-sm underline underline-offset-4">← Calderwood</Link>
        <Link href="/channels/65_calderwood/message-status" className="text-sm underline underline-offset-4">Automation status →</Link>
        <form action="/channels/65_calderwood/sync-status" method="get"><button className="rounded-lg border px-4 py-2 text-sm font-medium" style={{ borderColor:'var(--rule)' }}>Refresh status</button></form>
      </div>
      <Suspense fallback={<section className="mt-7 rounded-2xl border p-6" aria-live="polite" style={{ borderColor: 'var(--rule)' }}>Checking the Airbnb connection…</section>}>
        <ChannelAuditSection />
      </Suspense>
      <InventoryStatusPanel report={report} />
    </main>
    <HelmFooter module="Calendar sync" right="65 Calderwood" />
  </div>;
}
