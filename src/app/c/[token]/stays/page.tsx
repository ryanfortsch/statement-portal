import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { todayET } from '@/lib/checkout-schedule';
import { CLEANER_STAY_ACCESS_FIELDS, readAuthorizedCleanerStays } from '@/lib/cleaner-stay-access';
import { loadCalderwoodPortalReport } from '@/lib/cleaner-stay-report.server';
import { CleanerStayPortal } from '@/components/cleaner/CleanerStayPortal';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Arrivals & departures · Rising Tide', referrer: 'no-referrer',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

export default async function CleanerStaysPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await readAuthorizedCleanerStays(token, {
    recipient: async value => {
      const r = await supabaseAdmin.from('cleaner_schedule_recipients')
        .select(CLEANER_STAY_ACCESS_FIELDS).eq('portal_token', value).maybeSingle();
      if (r.error) throw Error('Schedule access unavailable');
      return r.data;
    },
    report: () => loadCalderwoodPortalReport(supabaseAdmin, todayET()),
  });
  if (result.status === 'not_found') notFound();
  if (result.status === 'unavailable') return <main className="mx-auto max-w-lg p-6" role="alert">
    <h1 className="text-xl font-semibold">Schedule unavailable · Agenda indisponível</h1>
    <p className="mt-3">Please reload in a minute. This does not mean there are no stays.</p>
    <p className="mt-2" lang="pt-BR">Tente novamente em um minuto. Isso não significa que não há estadias.</p>
  </main>;
  return <CleanerStayPortal report={result.report} language={result.language} checkoutHref={`/c/${token}`} />;
}
