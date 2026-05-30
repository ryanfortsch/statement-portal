import { notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { HelmPropertyRow } from '@/lib/properties';
import type { WorkSlipRow } from '@/lib/work-types';
import { ACTIVE_WORK_SLIP_STATUSES } from '@/lib/work-types';
import { PrintButton } from './PrintButton';
import { SlipRow } from './SlipRow';

export const dynamic = 'force-dynamic';

type Params = { id: string };

async function getData(id: string): Promise<{
  property: HelmPropertyRow;
  slips: WorkSlipRow[];
} | null> {
  const { data: property } = await supabase
    .from('properties')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!property) return null;

  const todayIso = new Date().toISOString().slice(0, 10);
  const { data: slipsData } = await supabase
    .from('work_slips')
    .select('*')
    .eq('property_id', id)
    .in('status', ACTIVE_WORK_SLIP_STATUSES)
    .or(`snoozed_until.is.null,snoozed_until.lte.${todayIso}`)
    // Print order: high priority first, then oldest first so the easy
    // wins float toward the top of any given priority band.
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true });

  return {
    property: property as HelmPropertyRow,
    slips: (slipsData ?? []) as WorkSlipRow[],
  };
}

export default async function WorkSlipsPrintPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const data = await getData(id);
  if (!data) notFound();

  const { property, slips } = data;
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <>
      {/* Print-specific styles. Inline so this file is self-contained
          and the print page never depends on layout.tsx chrome. */}
      <style>{`
        @page { size: letter; margin: 0.6in 0.5in; }
        @media print {
          [data-no-print] { display: none !important; }
          .ws-pdf-sheet { box-shadow: none !important; margin: 0 !important; padding: 0 !important; }
          .ws-pdf-page { background: white !important; }
          .ws-pdf-row { break-inside: avoid; opacity: 1 !important; }
          /* Paper always prints pristine — tick boxes empty, no strikethrough,
             regardless of what got tapped on screen. */
          .ws-pdf-row-done { opacity: 1 !important; }
          .ws-pdf-row-body { text-decoration: none !important; }
          .ws-tick { background: transparent !important; color: transparent !important; }
          .ws-tick-mark { display: none !important; }
        }
        .ws-pdf-page {
          background: var(--paper-2);
          min-height: 100vh;
          padding: 32px 16px;
        }
        .ws-pdf-sheet {
          background: var(--paper);
          color: var(--ink);
          width: 100%;
          max-width: 7.5in;
          margin: 0 auto;
          padding: 56px 64px;
          box-shadow: 0 6px 28px rgba(0,0,0,0.08);
        }
      `}</style>

      <div className="ws-pdf-page">
        {/* Action bar (screen-only) */}
        <div
          data-no-print
          style={{
            maxWidth: '7.5in',
            margin: '0 auto 18px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <a
            href={`/properties/${id}`}
            style={{
              fontSize: 11,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
              textDecoration: 'none',
            }}
          >
            ← Property folder
          </a>
          <PrintButton />
        </div>

        <article className="ws-pdf-sheet">
          {/* MASTHEAD */}
          <header
            style={{
              borderBottom: '1px solid var(--ink)',
              paddingBottom: 16,
              marginBottom: 28,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <div
              className="font-mono"
              style={{
                fontSize: 10,
                letterSpacing: '.22em',
                textTransform: 'uppercase',
                color: 'var(--ink-3)',
              }}
            >
              Rising Tide · Work Slip Checklist
            </div>
            <div
              className="font-mono"
              style={{
                fontSize: 10,
                letterSpacing: '.22em',
                textTransform: 'uppercase',
                color: 'var(--ink-4)',
              }}
            >
              {today}
            </div>
          </header>

          {/* HERO */}
          <section style={{ marginBottom: 28 }}>
            <div
              style={{
                fontSize: 10,
                letterSpacing: '.22em',
                textTransform: 'uppercase',
                color: 'var(--signal)',
                marginBottom: 12,
                fontWeight: 600,
              }}
            >
              Open work
            </div>
            <h1
              className="font-serif"
              style={{
                fontSize: 38,
                lineHeight: 1.05,
                fontWeight: 300,
                letterSpacing: '-0.02em',
                color: 'var(--ink)',
                margin: 0,
              }}
            >
              {property.name}
            </h1>
            <p style={{ marginTop: 6, fontSize: 13, color: 'var(--ink-3)' }}>
              {property.address || property.title || property.city}
              {property.owner_last && ` · ${property.owner_last}`}
            </p>
            <p
              style={{
                marginTop: 18,
                fontSize: 14,
                color: 'var(--ink-2)',
                lineHeight: 1.55,
                fontStyle: 'italic',
                maxWidth: 480,
              }}
            >
              {slips.length === 0
                ? 'No open work slips. Nothing to bring.'
                : `${slips.length} ${slips.length === 1 ? 'slip' : 'slips'} to handle on this turnover.`}
            </p>
          </section>

          {/* CHECKLIST */}
          {slips.length > 0 && (
            <section
              style={{
                borderTop: '1px solid var(--ink)',
              }}
            >
              {slips.map((s, i) => (
                <SlipRow key={s.id} slip={s} number={i + 1} />
              ))}
            </section>
          )}

          {/* COLOPHON */}
          <footer
            style={{
              marginTop: 36,
              paddingTop: 16,
              borderTop: '1px solid var(--ink)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <span
              className="font-mono"
              style={{
                fontSize: 9,
                letterSpacing: '.22em',
                textTransform: 'uppercase',
                color: 'var(--ink-4)',
              }}
            >
              Rising Tide · Helm
            </span>
            <span
              style={{
                fontSize: 10,
                color: 'var(--ink-4)',
                fontStyle: 'italic',
              }}
            >
              Snapshot generated {today}
            </span>
          </footer>
        </article>
      </div>
    </>
  );
}

