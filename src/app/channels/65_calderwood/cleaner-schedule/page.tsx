import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isOwnerSession } from '@/lib/helm-access-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { todayET } from '@/lib/checkout-schedule';
import { loadCalderwoodCleanerReport, loadCalderwoodPortalReport } from '@/lib/cleaner-stay-report.server';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { GuestyWritesNotice } from '@/components/channels/GuestyWritesNotice';
import { loadHomeWriteScope } from '@/lib/channels';
import { StayReport } from './StayReport';
import { CleanerStayPortal } from '@/components/cleaner/CleanerStayPortal';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Calderwood cleaner schedule preview · Helm', robots: { index: false, follow: false } };

export default async function CleanerSchedulePreview({ searchParams }: { searchParams: Promise<{ view?: string; language?: string }> }) {
  if (!await isOwnerSession()) redirect('/channels/65_calderwood');
  const query = await searchParams;
  const cleanerView = query.view === 'cleaner', language = query.language === 'pt' ? 'pt' : 'en';
  const writeScope = await loadHomeWriteScope('65_calderwood');
  // Authorization precedes the service-role read. The URL accepts neither a
  // property selector nor a public token, so this preview cannot broaden access.
  let report;
  try { report = cleanerView ? await loadCalderwoodPortalReport(supabaseAdmin, todayET()) : await loadCalderwoodCleanerReport(supabaseAdmin, todayET()); }
  catch { report = null; }
  return <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <GuestyWritesNotice scope={writeScope} />
    <HelmHero plain eyebrow="" title="Cleaner schedule preview"
      line="Review arrivals and departures together before replacing Luana’s Guesty report." />
    <main className="w-full max-w-[960px] mx-auto px-5 sm:px-10 pb-14">
      <Link href="/channels/65_calderwood/message-preparation" className="text-sm underline underline-offset-4">← Message handover</Link>
      <div className="mt-6 rounded-xl border p-5 text-sm leading-6" style={{ borderColor:'var(--rule)', background:'var(--paper-2)' }}>
        <strong>Preview for owners · not shared with Luana</strong>
        <p className="mt-1">Guesty still sends the cleaner reminders. This page creates no recipient, public link or messages. Luana’s destination and access must be verified before handover.</p>
      </div>
      <nav aria-label="Preview view" className="mt-5 flex flex-wrap gap-4 text-sm underline underline-offset-4">
        <Link href="?">Owner review</Link><Link href="?view=cleaner&language=en">Cleaner view · English</Link><Link href="?view=cleaner&language=pt">Cleaner view · Português</Link>
      </nav>
      {report ? cleanerView ? <CleanerStayPortal report={report} language={language} embedded /> : <StayReport report={report} /> : <section role="alert" className="mt-7 rounded-xl border p-6" style={{ borderColor:'var(--signal)' }}>
        <h2 className="text-lg font-semibold">Schedule unavailable</h2>
        <p className="mt-2 text-sm">The stay details could not be verified. Reload to try again; this does not mean the calendar is empty.</p>
      </section>}
      <p className="mt-5 text-sm"><Link href="/turnovers/schedule" className="underline underline-offset-4">Open the cleaning schedule →</Link></p>
    </main>
    <HelmFooter module="Cleaner handover" right="65 Calderwood" />
  </div>;
}
