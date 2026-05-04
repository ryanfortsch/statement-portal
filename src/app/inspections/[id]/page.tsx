import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { supabase } from '@/lib/supabase';
import type {
  InspectionRow,
  InspectionItemRow,
  InspectionResultRow,
} from '@/lib/inspections-types';
import { Stepper } from './Stepper';

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

  const insp = inspection as InspectionRow;

  // The deck for this inspection: 10 ordered item ids snapshotted at
  // startInspection time. Older inspections (created before the deck
  // system landed) won't have ordered_item_ids, so we fall back to the
  // full template item list for those.
  const deckIds = insp.ordered_item_ids ?? null;

  const [{ data: property }, { data: items }, { data: results }] = await Promise.all([
    supabase
      .from('properties')
      .select('id, name, title, city')
      .eq('id', insp.property_id)
      .maybeSingle(),
    deckIds && deckIds.length > 0
      ? supabase
          .from('inspection_items')
          .select('id, template_id, category, title, description, sort_order, item_category, interval_days, priority, season_constraint')
          .in('id', deckIds)
      : supabase
          .from('inspection_items')
          .select('id, template_id, category, title, description, sort_order, item_category, interval_days, priority, season_constraint')
          .eq('template_id', insp.template_id)
          .order('sort_order'),
    supabase
      .from('inspection_results')
      .select('id, inspection_id, item_id, status, notes, photo_urls, created_at')
      .eq('inspection_id', id),
  ]);

  if (!property) return null;

  let orderedItems = (items ?? []) as InspectionItemRow[];
  if (deckIds && deckIds.length > 0) {
    const itemMap = new Map(orderedItems.map((it) => [it.id, it]));
    orderedItems = deckIds
      .map((iid) => itemMap.get(iid))
      .filter((x): x is InspectionItemRow => x != null);
  }

  return {
    inspection: insp,
    property: property as PropertyShape,
    items: orderedItems,
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

  // If already completed, jump straight to the summary so the inspector
  // can't accidentally re-open the stepper for a finalized inspection.
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

  // Mobile-first stepper takes over the viewport. The HelmMasthead is
  // intentionally NOT rendered while in-progress so the inspector sees
  // nothing extraneous while walking the property -- the stepper has its
  // own minimal top bar (Exit + progress) and bottom action bar.
  return (
    <Stepper
      inspectionId={id}
      propertyName={property.name}
      inspectorName={inspection.inspector_name}
      items={items.map((it) => ({
        id: it.id,
        title: it.title,
        description: it.description,
        category: it.category,
        item_category: it.item_category,
      }))}
      initialResults={results.map((r) => ({
        item_id: r.item_id,
        status: r.status,
        notes: r.notes,
      }))}
    />
  );
}
