import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type {
  InspectionRow,
  InspectionItemRow,
  InspectionResultRow,
  InspectionNoteRow,
  ItemCategory,
  OrderedCard,
  PropertyZoneRow,
  WorkSlipCategory,
  WorkSlipPriority,
} from '@/lib/inspections-types';
import { Stepper } from './Stepper';

export const dynamic = 'force-dynamic';

type PropertyShape = { id: string; name: string; title: string | null; city: string; bedrooms: number | null };

type StepperCardShape = {
  cardKey: string; // stable composite of itemId + zoneId for keying React state
  itemId: string;
  zoneId: string | null;
  title: string;
  description: string | null;
  category: string;
  item_category: ItemCategory | null;
  zoneName: string | null;
  zoneFloorLabel: string | null;
  walkOrder: number | null;
};

function cardKeyOf(itemId: string, zoneId: string | null): string {
  return `${itemId}::${zoneId ?? '_'}`;
}

async function getInspection(id: string): Promise<{
  inspection: InspectionRow;
  property: PropertyShape;
  cards: StepperCardShape[];
  results: InspectionResultRow[];
} | null> {
  const { data: inspection, error } = await supabase
    .from('inspections')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error || !inspection) return null;

  const insp = inspection as InspectionRow;

  // Increment 2 stores the deck as ordered_cards (array of {itemId, zoneId});
  // older in-progress inspections only have ordered_item_ids. Build a unified
  // OrderedCard[] from whichever is available.
  let cards: OrderedCard[] = [];
  if (Array.isArray(insp.ordered_cards) && insp.ordered_cards.length > 0) {
    cards = insp.ordered_cards;
  } else if (insp.ordered_item_ids && insp.ordered_item_ids.length > 0) {
    cards = insp.ordered_item_ids.map((iid) => ({ itemId: iid, zoneId: null }));
  }

  const itemIds = Array.from(new Set(cards.map((c) => c.itemId)));
  const zoneIds = Array.from(
    new Set(cards.map((c) => c.zoneId).filter((z): z is string => !!z)),
  );

  const [{ data: property }, { data: items }, { data: results }, { data: zoneRows }] =
    await Promise.all([
      supabase
        .from('properties')
        .select('id, name, title, city, bedrooms')
        .eq('id', insp.property_id)
        .maybeSingle(),
      itemIds.length > 0
        ? supabase
            .from('inspection_items')
            .select(
              'id, template_id, category, title, description, sort_order, item_category, interval_days, priority, season_constraint',
            )
            .in('id', itemIds)
        : supabase
            .from('inspection_items')
            .select(
              'id, template_id, category, title, description, sort_order, item_category, interval_days, priority, season_constraint',
            )
            .eq('template_id', insp.template_id)
            .order('sort_order'),
      supabase
        .from('inspection_results')
        .select(
          'id, inspection_id, item_id, property_zone_id, status, notes, photo_urls, created_at',
        )
        .eq('inspection_id', id),
      zoneIds.length > 0
        ? supabase.from('property_zones').select('*').in('id', zoneIds)
        : { data: [] as PropertyZoneRow[] },
    ]);

  if (!property) return null;

  // Fallback: no deck stored at all (very old inspection) — synthesize one
  // from the template items so the stepper still renders something.
  if (cards.length === 0) {
    cards = ((items ?? []) as InspectionItemRow[]).map((it) => ({
      itemId: it.id,
      zoneId: null,
    }));
  }

  const itemMap = new Map<string, InspectionItemRow>();
  for (const it of (items ?? []) as InspectionItemRow[]) itemMap.set(it.id, it);

  const zoneMap = new Map<string, PropertyZoneRow>();
  for (const z of (zoneRows ?? []) as PropertyZoneRow[]) zoneMap.set(z.id, z);

  const stepperCards: StepperCardShape[] = cards
    .map((c) => {
      const it = itemMap.get(c.itemId);
      if (!it) return null;
      const z = c.zoneId ? zoneMap.get(c.zoneId) : null;
      return {
        cardKey: cardKeyOf(c.itemId, c.zoneId),
        itemId: c.itemId,
        zoneId: c.zoneId,
        title: it.title,
        description: it.description,
        category: it.category,
        item_category: it.item_category,
        zoneName: z?.name ?? null,
        zoneFloorLabel: z?.floor_label ?? null,
        walkOrder: z?.walk_order ?? null,
      };
    })
    .filter((c): c is StepperCardShape => c !== null);

  return {
    inspection: insp,
    property: property as PropertyShape,
    cards: stepperCards,
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

  const { inspection, property, cards, results } = data;

  if (inspection.completed_at) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <HelmMasthead current="work" />
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

  return (
    <Stepper
      inspectionId={id}
      propertyId={property.id}
      propertyName={property.name}
      propertyBedrooms={property.bedrooms}
      inspectorName={inspection.inspector_name}
      initialNotes={initialNotes}
      initialWorkSlips={initialWorkSlips}
      cards={cards}
      initialResults={results.map((r) => ({
        item_id: r.item_id,
        zone_id: r.property_zone_id,
        status: r.status,
        notes: r.notes,
        photo_urls: r.photo_urls ?? [],
      }))}
    />
  );
}
