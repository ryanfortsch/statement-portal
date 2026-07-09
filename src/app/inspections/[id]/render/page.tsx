import { notFound } from 'next/navigation';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type {
  InspectionRow,
  InspectionItemRow,
  InspectionResultRow,
  PropertyZoneRow,
} from '@/lib/inspections-types';
import { PrintButton } from './PrintButton';
import { suppliesLabel } from '@/lib/inspection-supplies';

export const dynamic = 'force-dynamic';

type PropertyShape = {
  id: string;
  name: string;
  title: string | null;
  address: string | null;
  city: string;
  owner_last: string | null;
};

type ResultWithItem = {
  result: InspectionResultRow;
  item: InspectionItemRow;
  zone: PropertyZoneRow | null;
};

type RenderNote = {
  id: string;
  inspection_item_id: string | null;
  note_text: string;
  note_type: 'INSPECTION_NOTE' | 'PROPERTY_NOTE';
  author_email: string;
  created_at: string;
  photo_urls: string[] | null;
};

type RenderWorkSlip = {
  id: string;
  inspection_item_id: string | null;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  location: string | null;
  created_at: string;
  photo_urls: string[] | null;
};

async function getData(id: string): Promise<{
  inspection: InspectionRow;
  property: PropertyShape;
  results: ResultWithItem[];
  notes: RenderNote[];
  workSlips: RenderWorkSlip[];
  itemMap: Map<string, InspectionItemRow>;
} | null> {
  const { data: inspection } = await supabase
    .from('inspections')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!inspection) return null;

  const insp = inspection as InspectionRow;

  const [
    { data: property },
    { data: results },
    { data: items },
    { data: notesData },
    { data: workSlipsData },
    { data: zoneRows },
  ] = await Promise.all([
    supabase
      .from('properties')
      .select('id, name, title, address, city, owner_last')
      .eq('id', insp.property_id)
      .maybeSingle(),
    supabase
      .from('inspection_results')
      .select('id, inspection_id, item_id, property_zone_id, status, notes, photo_urls, created_at')
      .eq('inspection_id', id),
    supabase
      .from('inspection_items')
      .select('id, template_id, category, title, description, sort_order')
      .eq('template_id', insp.template_id),
    supabase
      .from('inspection_notes')
      .select('id, inspection_item_id, note_text, note_type, author_email, created_at, photo_urls')
      .eq('inspection_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('work_slips')
      .select('id, inspection_item_id, title, description, category, priority, location, created_at, photo_urls')
      .eq('inspection_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('property_zones')
      .select('*')
      .eq('property_id', insp.property_id)
      .order('walk_order', { ascending: true }),
  ]);

  if (!property) return null;

  const itemMap = new Map<string, InspectionItemRow>();
  for (const it of (items ?? []) as InspectionItemRow[]) {
    itemMap.set(it.id, it);
  }

  const zoneMap = new Map<string, PropertyZoneRow>();
  for (const z of (zoneRows ?? []) as PropertyZoneRow[]) zoneMap.set(z.id, z);

  const merged: ResultWithItem[] = ((results ?? []) as InspectionResultRow[])
    .map((r) => {
      const item = itemMap.get(r.item_id);
      if (!item) return null;
      const zone = r.property_zone_id ? zoneMap.get(r.property_zone_id) ?? null : null;
      return { result: r, item, zone };
    })
    .filter((x): x is ResultWithItem => x !== null)
    .sort((a, b) => {
      const aw = a.zone?.walk_order ?? Infinity;
      const bw = b.zone?.walk_order ?? Infinity;
      if (aw !== bw) return aw - bw;
      return a.item.sort_order - b.item.sort_order;
    });

  return {
    inspection: insp,
    property: property as PropertyShape,
    results: merged,
    notes: (notesData ?? []) as RenderNote[],
    workSlips: (workSlipsData ?? []) as RenderWorkSlip[],
    itemMap,
  };
}

type Params = { id: string };

export default async function InspectionRenderPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const data = await getData(id);
  if (!data) notFound();

  const { inspection, property, results, notes, workSlips, itemMap } = data;

  const issues = results.filter((r) => r.result.status === 'issue');
  const passes = results.filter((r) => r.result.status === 'pass');
  const nas = results.filter((r) => r.result.status === 'na');
  const propertyNotes = notes.filter((n) => n.note_type === 'PROPERTY_NOTE');
  const inspectionNotes = notes.filter((n) => n.note_type === 'INSPECTION_NOTE');

  const completedDate = inspection.completed_at
    ? new Date(inspection.completed_at).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : 'In progress';

  const headlineSummary =
    issues.length === 0
      ? `Clean walkthrough — all ${inspection.total_items} items checked.`
      : `${issues.length} ${issues.length === 1 ? 'item' : 'items'} flagged across ${inspection.total_items} checked${
          workSlips.length > 0 ? `; ${workSlips.length} work ${workSlips.length === 1 ? 'slip' : 'slips'} created` : ''
        }.`;

  return (
    <>
      {/* Print-only styles + page setup. Inline so this file is self-contained
          and the print page never depends on layout.tsx chrome. */}
      <style>{`
        @page { size: letter; margin: 0.6in 0.5in; }
        @media print {
          [data-no-print] { display: none !important; }
          .ins-pdf-sheet { box-shadow: none !important; margin: 0 !important; padding: 0 !important; }
          .ins-pdf-page { background: white !important; }
          .ins-pdf-section { break-inside: avoid; }
        }
        .ins-pdf-page {
          background: var(--paper-2);
          min-height: 100vh;
          padding: 32px 16px;
        }
        .ins-pdf-sheet {
          background: var(--paper);
          color: var(--ink);
          width: 100%;
          max-width: 7.5in;
          margin: 0 auto;
          padding: 56px 64px;
          box-shadow: 0 6px 28px rgba(0,0,0,0.08);
        }
      `}</style>

      <div className="ins-pdf-page">
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
            href={`/inspections/${id}/summary`}
            style={{
              fontSize: 11,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
              textDecoration: 'none',
            }}
          >
            ← Back to summary
          </a>
          <PrintButton />
        </div>

        {/* THE SHEET */}
        <article className="ins-pdf-sheet">
          {/* MASTHEAD */}
          <header
            className="ins-pdf-section"
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
              Rising Tide · Inspection Report
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
              {inspection.id.slice(0, 8)}
            </div>
          </header>

          {/* HERO */}
          <section className="ins-pdf-section" style={{ marginBottom: 28 }}>
            <div
              className="eyebrow"
              style={{
                fontSize: 10,
                letterSpacing: '.22em',
                textTransform: 'uppercase',
                color: 'var(--signal)',
                marginBottom: 12,
                fontWeight: 600,
              }}
            >
              Property Inspection
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
              {headlineSummary}
            </p>
            <p
              style={{
                marginTop: 14,
                fontSize: 12,
                color: 'var(--ink-3)',
              }}
            >
              {completedDate} · Walked by {inspection.inspector_name}
            </p>
          </section>

          {/* STAT GRID */}
          <section
            className="ins-pdf-section"
            style={{
              borderTop: '1px solid var(--ink)',
              borderBottom: '1px solid var(--ink)',
              marginBottom: 32,
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
              <Stat label="Total" value={String(inspection.total_items)} />
              <Stat label="Pass" value={String(inspection.pass_count)} accent="var(--positive)" />
              <Stat label="Issue" value={String(inspection.issue_count)} accent="var(--signal)" />
              <Stat label="N/A" value={String(inspection.na_count)} accent="var(--ink-4)" last />
            </div>
          </section>

          {/* ISSUES */}
          {issues.length > 0 && (
            <PrintSection title="Issues" eyebrow={`${issues.length} flagged`}>
              {issues.map((row) => (
                <div
                  key={row.result.id}
                  className="ins-pdf-section"
                  style={{
                    padding: '14px 0',
                    borderBottom: '1px solid var(--rule)',
                    display: 'grid',
                    gridTemplateColumns: '140px 1fr',
                    gap: 18,
                    alignItems: 'baseline',
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      letterSpacing: '.18em',
                      textTransform: 'uppercase',
                      fontWeight: 600,
                      color: 'var(--signal)',
                    }}
                  >
                    {row.zone?.name ?? row.item.category}
                    {row.zone?.floor_label && (
                      <span style={{ color: 'var(--ink-4)', fontWeight: 400, display: 'block', marginTop: 2 }}>
                        {row.zone.floor_label}
                      </span>
                    )}
                  </span>
                  <div>
                    <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
                      {row.item.title}
                    </div>
                    {row.result.notes && (
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 12,
                          color: 'var(--ink-3)',
                          fontStyle: 'italic',
                          lineHeight: 1.45,
                        }}
                      >
                        &ldquo;{row.result.notes}&rdquo;
                      </div>
                    )}
                    <PrintPhotos urls={row.result.photo_urls} />
                  </div>
                </div>
              ))}
            </PrintSection>
          )}

          {/* SUPPLIES — always print so the report shows the outcome of
              the Supplies Check (all stocked, or which items went low). */}
          <PrintSection
            title="Supplies"
            eyebrow={
              (inspection.supplies_low ?? []).length === 0
                ? 'all stocked'
                : `${inspection.supplies_low.length} low`
            }
          >
            {(inspection.supplies_low ?? []).length === 0 ? (
              <div className="ins-pdf-section" style={{ padding: '12px 0', fontSize: 12, color: 'var(--ink-3)' }}>
                All supplies marked OK. No restocks needed.
              </div>
            ) : (
              inspection.supplies_low.map((key) => (
                <div
                  key={key}
                  className="ins-pdf-section"
                  style={{
                    padding: '10px 0',
                    borderBottom: '1px solid var(--rule)',
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 14,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      letterSpacing: '.18em',
                      textTransform: 'uppercase',
                      fontWeight: 600,
                      color: 'var(--signal)',
                      minWidth: 34,
                    }}
                  >
                    Low
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
                    {suppliesLabel(key)}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--ink-4)', marginLeft: 'auto' }}>
                    Restock slip
                  </span>
                </div>
              ))
            )}
          </PrintSection>

          {/* WORK SLIPS */}
          {workSlips.length > 0 && (
            <PrintSection title="Work Slips Created" eyebrow={`${workSlips.length} new`}>
              {workSlips.map((ws) => {
                const item = ws.inspection_item_id ? itemMap.get(ws.inspection_item_id) : null;
                return (
                  <div
                    key={ws.id}
                    className="ins-pdf-section"
                    style={{
                      padding: '14px 0',
                      borderBottom: '1px solid var(--rule)',
                      display: 'grid',
                      gridTemplateColumns: '120px 1fr 80px',
                      gap: 18,
                      alignItems: 'baseline',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 9,
                        letterSpacing: '.18em',
                        textTransform: 'uppercase',
                        fontWeight: 600,
                        color: 'var(--signal)',
                      }}
                    >
                      {ws.category.replace('_', ' ')}
                    </span>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
                        {ws.title}
                      </div>
                      {item && (
                        <div style={{ marginTop: 2, fontSize: 10, color: 'var(--ink-4)' }}>
                          From card: {item.title}
                        </div>
                      )}
                      {ws.location && (
                        <div style={{ marginTop: 2, fontSize: 11, color: 'var(--ink-3)' }}>
                          Location: {ws.location}
                        </div>
                      )}
                      {ws.description && (
                        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.45 }}>
                          {ws.description}
                        </div>
                      )}
                      <PrintPhotos urls={ws.photo_urls} />
                    </div>
                    <span
                      style={{
                        fontSize: 9,
                        letterSpacing: '.18em',
                        textTransform: 'uppercase',
                        textAlign: 'right',
                        color: ws.priority === 'high' ? 'var(--negative)' : 'var(--ink-3)',
                      }}
                    >
                      {ws.priority}
                    </span>
                  </div>
                );
              })}
            </PrintSection>
          )}

          {/* PROPERTY NOTES */}
          {propertyNotes.length > 0 && (
            <PrintSection title="Property Notes" eyebrow={`${propertyNotes.length} pinned to folder`}>
              {propertyNotes.map((n) => {
                const item = n.inspection_item_id ? itemMap.get(n.inspection_item_id) : null;
                const isPhotoOnly = n.note_text === '(photo)' && (n.photo_urls?.length ?? 0) > 0;
                return (
                  <div
                    key={n.id}
                    className="ins-pdf-section"
                    style={{
                      padding: '12px 0 12px 14px',
                      borderBottom: '1px solid var(--rule)',
                      borderLeft: '2px solid var(--tide-deep)',
                    }}
                  >
                    {!isPhotoOnly && (
                      <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5 }}>
                        {n.note_text}
                      </div>
                    )}
                    {item && (
                      <div style={{ marginTop: 4, fontSize: 10, color: 'var(--ink-4)' }}>
                        Re: {item.title}
                      </div>
                    )}
                    <PrintPhotos urls={n.photo_urls} />
                  </div>
                );
              })}
            </PrintSection>
          )}

          {/* INSPECTION NOTES */}
          {inspectionNotes.length > 0 && (
            <PrintSection title="Inspection Notes" eyebrow={`${inspectionNotes.length}`}>
              {inspectionNotes.map((n) => {
                const item = n.inspection_item_id ? itemMap.get(n.inspection_item_id) : null;
                const isPhotoOnly = n.note_text === '(photo)' && (n.photo_urls?.length ?? 0) > 0;
                return (
                  <div
                    key={n.id}
                    className="ins-pdf-section"
                    style={{
                      padding: '10px 0',
                      borderBottom: '1px solid var(--rule-soft)',
                    }}
                  >
                    {!isPhotoOnly && (
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--ink)',
                          lineHeight: 1.5,
                          fontStyle: 'italic',
                        }}
                      >
                        &ldquo;{n.note_text}&rdquo;
                      </div>
                    )}
                    {item && (
                      <div style={{ marginTop: 3, fontSize: 10, color: 'var(--ink-4)' }}>
                        Re: {item.title}
                      </div>
                    )}
                    <PrintPhotos urls={n.photo_urls} />
                  </div>
                );
              })}
            </PrintSection>
          )}

          {/* PASSED ITEMS — compact list */}
          {passes.length > 0 && (
            <PrintSection title="Passed" eyebrow={`${passes.length} clean`}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '4px 24px',
                }}
              >
                {passes.map((row) => (
                  <div
                    key={row.result.id}
                    style={{
                      fontSize: 11,
                      color: 'var(--ink-3)',
                      padding: '4px 0',
                      borderBottom: '1px solid var(--rule-soft)',
                    }}
                  >
                    <span style={{ color: 'var(--positive)', marginRight: 6 }}>✓</span>
                    {row.item.title}
                  </div>
                ))}
              </div>
            </PrintSection>
          )}

          {/* N/A items — even more compact */}
          {nas.length > 0 && (
            <PrintSection title="Not Applicable" eyebrow={`${nas.length}`}>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.6 }}>
                {nas.map((row) => row.item.title).join(' · ')}
              </div>
            </PrintSection>
          )}

          {/* COLOPHON */}
          <footer
            className="ins-pdf-section"
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
              Generated {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </footer>
        </article>
      </div>
    </>
  );
}

function Stat({ label, value, accent, last = false }: { label: string; value: string; accent?: string; last?: boolean }) {
  return (
    <div
      style={{
        padding: '18px 16px',
        borderRight: last ? 'none' : '1px solid var(--rule)',
      }}
    >
      <div
        className="eyebrow"
        style={{
          marginBottom: 6,
          fontSize: 9,
          letterSpacing: '.22em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
        }}
      >
        {label}
      </div>
      <div
        className="font-serif tabular-nums"
        style={{
          fontSize: 24,
          fontWeight: 400,
          color: accent ?? 'var(--ink)',
          lineHeight: 1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function PrintSection({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <section className="ins-pdf-section" style={{ marginBottom: 28 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 10,
        }}
      >
        <h2
          className="font-serif"
          style={{
            fontSize: 18,
            fontWeight: 400,
            letterSpacing: '-0.01em',
            color: 'var(--ink)',
            margin: 0,
          }}
        >
          {title}
        </h2>
        <span
          style={{
            fontSize: 9,
            letterSpacing: '.22em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
          }}
        >
          {eyebrow}
        </span>
      </div>
      <div style={{ borderTop: '1px solid var(--ink)' }}>{children}</div>
    </section>
  );
}

/**
 * Photos in a print-friendly strip. Sized so 4 thumbs fit per row inside
 * the sheet column. Uses native <img> with no eager loading hints; for
 * print, the browser will block on decode anyway.
 */
function PrintPhotos({ urls }: { urls: string[] | null }) {
  if (!urls || urls.length === 0) return null;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 6,
        marginTop: 10,
        maxWidth: 420,
      }}
    >
      {urls.map((url, i) => (
        <div
          key={`${url}-${i}`}
          style={{
            aspectRatio: '4 / 3',
            background: 'var(--paper-2)',
            border: '1px solid var(--rule)',
            overflow: 'hidden',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={`Photo ${i + 1}`}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </div>
      ))}
    </div>
  );
}
