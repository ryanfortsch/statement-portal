import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { supabase } from '@/lib/supabase';
import type {
  InspectionRow,
  InspectionItemRow,
  InspectionResultRow,
  InspectionNoteRow,
  WorkSlipCategory,
  WorkSlipPriority,
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
        <HelmHero
          eyebrow="Inspection complete"
          title="This inspection is"
          emphasis="already done."
          description=""
          belowDescription={
            <p style={{ marginTop: 14, fontSize: 14, color: 'var(--ink-3)' }}>
              View the <Link href={`/inspections/${id}/summary`} style={{ color: 'var(--tide-deep)' }}>summary</Link> or
              start a <Link href="/inspections" style={{ color: 'var(--tide-deep)' }}>new inspection</Link>.
            </p>
          }
        />
      </div>
    );
  }

  // Pull notes + work slips already attached to this inspection so the
  // stepper can show them as inline chips on the right cards.
  const [{ data: notesData }, { data: workSlipsData }] = await Promise.all([
    supabase
      .from('inspection_notes')
      .select('id, inspection_item_id, note_text, note_type, author_email, created_at, photo_urls')
      .eq('inspection_id', id)
      .is('resolved_at', null)
      .order('created_at', { ascending: true }),
    supabase
      .from('work_slips')
      .select('id, inspection_item_id, title, category, priority, created_at, photo_urls')
      .eq('inspection_id', id)
      .order('created_at', { ascending: true }),
  ]);

  const initialNotes = ((notesData ?? []) as Array<
    Pick<InspectionNoteRow, 'id' | 'inspection_item_id' | 'note_text' | 'note_type' | 'author_email' | 'created_at'> & {
      photo_urls: string[] | null;
    }
  >).map((n) => ({
    id: n.id,
    inspection_item_id: n.inspection_item_id,
    note_text: n.note_text,
    note_type: n.note_type,
    author_email: n.author_email,
    created_at: n.created_at,
    photo_urls: n.photo_urls ?? [],
  }));

  const initialWorkSlips = ((workSlipsData ?? []) as Array<{
    id: string;
    inspection_item_id: string | null;
    title: string;
    category: WorkSlipCategory;
    priority: WorkSlipPriority;
    created_at: string;
    photo_urls: string[] | null;
  }>).map((ws) => ({
    id: ws.id,
    inspection_item_id: ws.inspection_item_id,
    title: ws.title,
    category: ws.category,
    priority: ws.priority,
    created_at: ws.created_at,
    photo_urls: ws.photo_urls ?? [],
  }));

  // Mobile-first stepper takes over the viewport. The HelmMasthead is
  // intentionally NOT rendered while in-progress so the inspector sees
  // nothing extraneous while walking the property -- the stepper has its
  // own minimal top bar (Exit + progress) and bottom action bar.
  return (
    <Stepper
      inspectionId={id}
      propertyId={property.id}
      propertyName={property.name}
      inspectorName={inspection.inspector_name}
      initialNotes={initialNotes}
      initialWorkSlips={initialWorkSlips}
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
