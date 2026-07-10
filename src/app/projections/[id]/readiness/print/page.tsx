import { notFound } from 'next/navigation';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { ProjectionRow } from '@/lib/projections-types';
import { computeReadiness } from '@/lib/projections-readiness';

/**
 * Property Readiness Checklist deliverable.
 *
 * A printable room-by-room punch list that translates Rising Tide's
 * standard walk-through checklist into a per-property document with
 * computed quantities (3 plates × max guests = 18 plates for a 6-guest
 * property, etc.). Lives as a sub-deliverable under the Onboarding stage
 * on /projections/[id]; printable via Cmd+P or downloadable through the
 * existing /api/projection-pdf?type=readiness puppeteer pipeline.
 *
 * Data + quantity math live in src/lib/projections-readiness.ts so the
 * on-screen render and the PDF stay in lockstep.
 *
 * The page uses CSS @page margins (not the puppeteer margin override) so
 * the list can flow naturally across as many pages as the items demand —
 * adding a new section in projections-readiness.ts won't require a
 * rebalance of manual page splits.
 */

export const dynamic = 'force-dynamic';

async function getProjection(id: string): Promise<ProjectionRow | null> {
  const { data } = await supabase.from('projections').select('*').eq('id', id).maybeSingle();
  return (data as ProjectionRow | null) ?? null;
}

export default async function ReadinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projection = await getProjection(id);
  if (!projection) notFound();

  const { context, groups } = computeReadiness(projection);
  const propertyTag = `${projection.property_address}${projection.property_city ? `, ${projection.property_city}` : ''}`;
  const salutation =
    projection.prospect_first_names ||
    projection.prospect_first_name ||
    projection.prospect_name ||
    'Owner';
  const propertyTypeLabel = (projection.property_type || 'home').toLowerCase();

  return (
    <>
      <style>{readinessCss}</style>
      <div className="rt-r-doc">
        <header className="rt-r-cover">
          <div className="rt-r-eyebrow">Rising Tide &middot; Property Readiness</div>
          <h1 className="rt-r-h1">Property Readiness Checklist</h1>
          <div className="rt-r-accent" />
          <p className="rt-r-tag">
            A room-by-room punch list for {salutation}&rsquo;s {propertyTypeLabel} at{' '}
            <strong>{propertyTag}</strong>. Quantities are computed for{' '}
            <strong>{context.maxGuests} guests</strong> across{' '}
            <strong>
              {context.bedrooms} bedroom{context.bedrooms === 1 ? '' : 's'}
            </strong>{' '}
            and{' '}
            <strong>
              {context.bathrooms} bathroom{context.bathrooms === 1 ? '' : 's'}
            </strong>
            {context.bathroomsFromIntake ? '' : ' (estimated — adjust on walk-through)'}.
            Check items off as you confirm they&rsquo;re in place; circle quantities you need to
            add.
          </p>
        </header>

        {groups.map((g) => (
          <section className="rt-r-group" key={g.title}>
            <div className="rt-r-group-head">
              <h2 className="rt-r-group-title">{g.title}</h2>
              <span className="rt-r-group-count">
                {g.items.length} item{g.items.length === 1 ? '' : 's'}
              </span>
            </div>
            <ul className="rt-r-list">
              {g.items.map((it) => (
                <li className="rt-r-item" key={it.label}>
                  <span className="rt-r-checkbox" aria-hidden />
                  <span className="rt-r-item-text">
                    <span className="rt-r-item-label">{it.label}</span>
                    {it.note && <span className="rt-r-item-note">{it.note}</span>}
                  </span>
                  <span className="rt-r-item-qty">{it.count}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section className="rt-r-notes">
          <h2 className="rt-r-group-title">Walk-through notes</h2>
          <div className="rt-r-notes-grid">
            <NoteField label="Supply closet" hint="Which closet stores linens, paper goods, batteries, etc." />
            <NoteField label="Smart lock brand &amp; code" hint="Brand, model, master + cleaner codes" />
            <NoteField label="Cleaner access" hint="Lockbox location + code, side door, etc." />
            <NoteField label="Trash &amp; recycling day" hint="Pickup days + bin location" />
            <NoteField label="Wi-Fi name &amp; password" hint="Will be printed on the welcome card" />
            <NoteField label="Owner-side notes" hint="Anything they want guests to know" />
          </div>
        </section>

        <footer className="rt-r-foot">
          Walk-through with Rising Tide &middot; allie@risingtidestr.com &middot; (978) 865-2387
        </footer>
      </div>
    </>
  );
}

function NoteField({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="rt-r-note">
      <div className="rt-r-note-label">{label}</div>
      <div className="rt-r-note-hint">{hint}</div>
      <div className="rt-r-note-line" />
      <div className="rt-r-note-line" />
    </div>
  );
}

// ─── CSS ────────────────────────────────────────────────────────────────────
// US Letter portrait with proper print margins via @page so the content can
// flow across multiple pages without manual page splits. Browser preview
// mimics the same margin via padding on the outer container; @media print
// drops the padding so @page wins. Color tokens follow the rest of Helm:
// --paper / --ink / --signal / --rule.
const readinessCss = `
  @page { size: 8.5in 11in; margin: 0.55in 0.7in; }

  html, body { background: var(--paper); margin: 0; padding: 0; }

  .rt-r-doc {
    font-family: var(--font-inter), system-ui, sans-serif;
    color: var(--ink);
    background: var(--paper);
    max-width: 8.5in;
    margin: 0 auto;
    padding: 0.55in 0.7in;
    box-sizing: border-box;
  }
  @media print {
    .rt-r-doc { padding: 0; max-width: none; }
  }

  /* ─── Cover block ─────────────────────────────────────────── */
  .rt-r-cover { margin-bottom: 22px; page-break-after: avoid; break-after: avoid; }
  .rt-r-eyebrow {
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-4);
    font-weight: 500;
  }
  .rt-r-h1 {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 40px;
    line-height: 1.04;
    font-weight: 300;
    letter-spacing: -0.02em;
    color: var(--ink);
    margin: 8px 0 0;
  }
  .rt-r-accent {
    width: 56px;
    height: 2px;
    background: var(--signal);
    margin: 16px 0 14px;
  }
  .rt-r-tag {
    font-size: 12px;
    line-height: 1.55;
    color: var(--ink-3);
    max-width: 560px;
    margin: 0;
  }
  .rt-r-tag strong { color: var(--ink); font-weight: 600; }

  /* ─── Group sections ──────────────────────────────────────── */
  .rt-r-group {
    margin-top: 22px;
    page-break-inside: auto;
  }
  .rt-r-group-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--ink);
    page-break-after: avoid;
    break-after: avoid;
  }
  .rt-r-group-title {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 20px;
    font-weight: 400;
    letter-spacing: -0.01em;
    color: var(--ink);
    margin: 0;
  }
  .rt-r-group-count {
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-4);
    font-weight: 500;
  }

  /* ─── Two-column item list ────────────────────────────────── */
  .rt-r-list {
    list-style: none;
    padding: 0;
    margin: 8px 0 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 24px;
    row-gap: 0;
  }
  .rt-r-item {
    display: grid;
    grid-template-columns: 14px 1fr auto;
    column-gap: 10px;
    align-items: baseline;
    padding: 6px 0;
    border-bottom: 1px solid var(--rule);
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .rt-r-checkbox {
    display: inline-block;
    width: 11px;
    height: 11px;
    border: 1.5px solid var(--ink);
    border-radius: 2px;
    flex-shrink: 0;
    transform: translateY(2px);
  }
  .rt-r-item-text { min-width: 0; }
  .rt-r-item-label {
    font-size: 11.5px;
    color: var(--ink);
    line-height: 1.35;
    font-weight: 500;
    display: block;
  }
  .rt-r-item-note {
    font-size: 9.5px;
    color: var(--ink-4);
    font-style: italic;
    line-height: 1.3;
    display: block;
    margin-top: 1px;
  }
  .rt-r-item-qty {
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    font-size: 11.5px;
    color: var(--signal);
    font-weight: 700;
    letter-spacing: 0.02em;
    text-align: right;
    min-width: 24px;
  }

  /* ─── Walk-through notes (write-in fields) ───────────────── */
  .rt-r-notes { margin-top: 30px; page-break-before: auto; }
  .rt-r-notes .rt-r-group-title { margin-bottom: 12px; }
  .rt-r-notes-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px 24px;
  }
  .rt-r-note {
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .rt-r-note-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--ink);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .rt-r-note-hint {
    font-size: 9.5px;
    color: var(--ink-4);
    font-style: italic;
    margin-top: 2px;
    line-height: 1.3;
  }
  .rt-r-note-line {
    border-bottom: 1px solid var(--ink-4);
    height: 18px;
    margin-top: 6px;
  }

  /* ─── Footer ──────────────────────────────────────────────── */
  .rt-r-foot {
    margin-top: 32px;
    padding-top: 12px;
    border-top: 1px solid var(--rule);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-4);
    text-align: center;
  }
`;
