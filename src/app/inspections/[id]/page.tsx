import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { supabase } from '@/lib/supabase';
import type {
  InspectionRow,
  InspectionItemRow,
  InspectionResultRow,
  InspectionStatus,
} from '@/lib/inspections-types';
import { completeInspection } from '../actions';

export const dynamic = 'force-dynamic';

type PropertyShape = { id: string; name: string; title: string | null; city: string };

async function getInspection(id: string): Promise<{
  inspection: InspectionRow;
  property: PropertyShape;
  items: InspectionItemRow[];
  results: InspectionResultRow[];
} | null> {
  const { data: inspection, error } = await supabase
    .from('inspections')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error || !inspection) return null;

  const [{ data: property }, { data: items }, { data: results }] = await Promise.all([
    supabase
      .from('properties')
      .select('id, name, title, city')
      .eq('id', (inspection as InspectionRow).property_id)
      .maybeSingle(),
    supabase
      .from('inspection_items')
      .select('id, template_id, category, title, description, sort_order')
      .eq('template_id', (inspection as InspectionRow).template_id)
      .order('sort_order'),
    supabase
      .from('inspection_results')
      .select('id, inspection_id, item_id, status, notes, photo_urls, created_at')
      .eq('inspection_id', id),
  ]);

  if (!property) return null;

  return {
    inspection: inspection as InspectionRow,
    property: property as PropertyShape,
    items: (items ?? []) as InspectionItemRow[],
    results: (results ?? []) as InspectionResultRow[],
  };
}

type Params = { id: string };

export default async function InspectionInProgressPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const data = await getInspection(id);
  if (!data) notFound();

  const { inspection, property, items, results } = data;

  // If already completed, jump to summary
  if (inspection.completed_at) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <HelmMasthead current="inspections" />
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, flex: 1, width: '100%' }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Inspection complete</div>
          <h1 className="font-serif" style={{ fontSize: 36, fontWeight: 300, letterSpacing: '-0.02em' }}>
            This inspection is already done.
          </h1>
          <p style={{ marginTop: 14, color: 'var(--ink-3)' }}>
            View the <Link href={`/inspections/${id}/summary`} style={{ color: 'var(--tide-deep)' }}>summary</Link> or
            start a <Link href="/inspections" style={{ color: 'var(--tide-deep)' }}>new inspection</Link>.
          </p>
        </section>
      </div>
    );
  }

  // Pre-fill from existing results (e.g. if inspector navigated back mid-flow)
  const existingByItemId = new Map<string, InspectionResultRow>(
    results.map((r) => [r.item_id, r])
  );

  // Group items by category preserving sort order
  const groupedByCategory: { category: string; items: InspectionItemRow[] }[] = [];
  for (const item of items) {
    const last = groupedByCategory[groupedByCategory.length - 1];
    if (last && last.category === item.category) {
      last.items.push(item);
    } else {
      groupedByCategory.push({ category: item.category, items: [item] });
    }
  }

  const completeWithId = completeInspection.bind(null, id);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="inspections" />

      {/* HEADER */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 32, paddingBottom: 24, width: '100%' }}>
        <Link
          href="/inspections"
          style={{
            fontSize: 11,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            textDecoration: 'none',
          }}
        >
          ← All Inspections
        </Link>
        <div className="eyebrow" style={{ marginTop: 18 }}>Inspection &middot; in progress</div>
        <h1
          className="font-serif"
          style={{
            fontSize: 38,
            lineHeight: 1.05,
            fontWeight: 300,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            marginTop: 8,
          }}
        >
          {property.name}
        </h1>
        <p style={{ marginTop: 6, fontSize: 13, color: 'var(--ink-3)' }}>
          {property.city} &middot; Inspector: {inspection.inspector_name} &middot; {items.length} items
        </p>
      </section>

      {/* FORM */}
      <form action={completeWithId} className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 80, flex: 1 }}>
        {groupedByCategory.map((group, gi) => (
          <div key={group.category} style={{ marginBottom: 40 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: 16,
                alignItems: 'baseline',
                paddingBottom: 12,
                borderTop: '1px solid var(--ink)',
                paddingTop: 18,
              }}
            >
              <span className="font-mono" style={{ fontSize: 11, color: 'var(--signal)', letterSpacing: '.08em' }}>
                {String(gi + 1).padStart(2, '0')}
              </span>
              <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, color: 'var(--ink)', margin: 0 }}>
                {group.category}
              </h2>
            </div>

            {group.items.map((item) => {
              const existing = existingByItemId.get(item.id);
              return (
                <div
                  key={item.id}
                  style={{
                    padding: '20px 0',
                    borderBottom: '1px solid var(--rule)',
                  }}
                >
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 15, color: 'var(--ink)', fontWeight: 500 }}>{item.title}</div>
                    {item.description && (
                      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3)' }}>{item.description}</div>
                    )}
                  </div>

                  <div className="flex items-start gap-3 flex-wrap">
                    <fieldset
                      className="flex items-center gap-2"
                      style={{ border: 'none', padding: 0, margin: 0 }}
                    >
                      <RadioPill
                        name={`status_${item.id}`}
                        value="pass"
                        defaultChecked={existing?.status === 'pass'}
                        label="Pass"
                        color="var(--positive)"
                      />
                      <RadioPill
                        name={`status_${item.id}`}
                        value="issue"
                        defaultChecked={existing?.status === 'issue'}
                        label="Issue"
                        color="var(--signal)"
                      />
                      <RadioPill
                        name={`status_${item.id}`}
                        value="na"
                        defaultChecked={existing?.status === 'na'}
                        label="N/A"
                        color="var(--ink-4)"
                      />
                    </fieldset>
                    <input
                      type="text"
                      name={`notes_${item.id}`}
                      placeholder="Notes (optional)"
                      defaultValue={existing?.notes ?? ''}
                      style={{
                        flex: 1,
                        minWidth: 240,
                        background: 'transparent',
                        border: 'none',
                        borderBottom: '1px solid var(--rule)',
                        padding: '6px 4px',
                        fontSize: 13,
                        color: 'var(--ink)',
                        outline: 'none',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {/* Submit */}
        <div
          className="flex items-center justify-between flex-wrap gap-3"
          style={{
            borderTop: '1px solid var(--ink)',
            borderBottom: '1px solid var(--ink)',
            padding: '24px 0',
            marginTop: 40,
          }}
        >
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Ready to wrap up?</div>
            <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>
              Items left unmarked won&apos;t be saved. You can come back to this inspection until you submit.
            </p>
          </div>
          <button
            type="submit"
            style={{
              background: 'var(--ink)',
              color: 'var(--paper)',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              padding: '14px 28px',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Complete Inspection →
          </button>
        </div>
      </form>
    </div>
  );
}

function RadioPill({
  name,
  value,
  defaultChecked,
  label,
  color,
}: {
  name: string;
  value: InspectionStatus;
  defaultChecked: boolean;
  label: string;
  color: string;
}) {
  return (
    <label
      style={{
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 14px',
        border: `1px solid ${color}`,
        fontSize: 11,
        letterSpacing: '.16em',
        textTransform: 'uppercase',
        fontWeight: 600,
        color,
      }}
    >
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        style={{ accentColor: color }}
      />
      {label}
    </label>
  );
}
