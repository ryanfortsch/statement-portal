'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { HelmMasthead } from '@/components/HelmMasthead';
import { FinancialsTabs } from '@/components/FinancialsTabs';
import { HelmHero } from '@/components/HelmHero';
import { previousCalendarMonth } from '@/lib/statements-month';
import { StatementUploadForm } from './StatementUploadForm';

/**
 * The upload as a page. A statement card opens the same form in place
 * (Re-upload data); this route stays for old links, the strip's Upload
 * Month and "+ New month", where no card exists yet. It is not a redirect
 * on purpose: a page never interrupts an upload already running in it.
 *
 * Default month: until 2026-05-14 this was hardcoded to '2026-04', which
 * silently sent every upload to April even when the operator was working
 * on May -- the ingest then overwrote real April data with the misplaced
 * May payload. We read `?month=YYYY-MM` from the URL when present (every
 * link from /statements carries it) and otherwise default to the previous
 * calendar month, the month a close works on and the same default as the
 * two inputs cards on /statements. It used to be the current month, so an
 * October 1-3 close opened on October.
 */
export default function UploadPage() {
  return (
    <Suspense fallback={null}>
      <UploadPageInner />
    </Suspense>
  );
}

function UploadPageInner() {
  const searchParams = useSearchParams();
  // NEVER hard-code a constant -- that's how data ended up under April
  // when the operator was working on May.
  const initialMonth = (() => {
    const fromQuery = searchParams.get('month');
    if (fromQuery && /^\d{4}-\d{2}$/.test(fromQuery)) return fromQuery;
    return previousCalendarMonth();
  })();
  // Pre-select the property too when a link passes ?property=<id>. We
  // trust the query value without validating against the property list
  // because the list is fetched async; the dropdown's selected state
  // self-corrects once the fetch completes.
  const initialPropertyId = searchParams.get('property') ?? '';
  const [processed, setProcessed] = useState<string | null>(null);

  return (
    <div className="min-h-screen" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <FinancialsTabs current="statements" />
      <HelmHero
        eyebrow="Step"
        title={processed ? 'Processed' : 'Upload'}
        emphasis={processed ?? 'Monthly Data'}
        paddingTop={36}
        paddingBottom={20}
      />

      <main className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 36, paddingBottom: 60 }}>

        <StatementUploadForm
          initialMonth={initialMonth}
          initialPropertyId={initialPropertyId}
          onResult={(r) => setProcessed(r ? r.property : null)}
        />
      </main>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--ink)', marginTop: 24 }}>
        <div className="rt-footer max-w-[1100px] mx-auto px-10 flex items-center justify-between" style={{ padding: '14px 40px', fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
          <span>Rising Tide &middot; 85 Eastern Ave &middot; Gloucester, MA 01930</span>
          <span className="font-serif" style={{ textTransform: 'none', letterSpacing: 0, fontStyle: 'italic', color: 'var(--ink-3)', fontSize: 11 }}>&ldquo;We care for your home as if it were our own.&rdquo;</span>
        </div>
      </footer>
    </div>
  );
}
