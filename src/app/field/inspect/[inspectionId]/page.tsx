import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { fieldDb } from '@/lib/field-db';
import { resolveContractorFromCookie } from '@/lib/field-auth';
import type {
  InspectionRow,
  InspectionItemRow,
  InspectionResultRow,
  InspectionNoteRow,
  OrderedCard,
  PropertyZoneRow,
  WorkSlipCategory,
  WorkSlipPriority,
} from '@/lib/inspections-types';
import { Stepper } from '@/app/inspections/[id]/Stepper';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Inspection · Rising Tide Field',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

function cardKeyOf(itemId: string, zoneId: string | null): string {
  return `${itemId}::${zoneId ?? '_'}`;
}

export default async function FieldInspectPage({
  params,
}: {
  params: Promise<{ inspectionId: string }>;
}) {
  const { inspectionId } = await params;
  const contractor = await resolveContractorFromCookie();
  if (!contractor) redirect('/field');

  // Ownership: the inspection must belong to a packet stop awarded to this
  // contractor.
  const { data: stopRow } = await fieldDb()
    .from('packet_stops')
    .select('packet_id, inspection_packets!inner(awarded_contractor_id)')
    .eq('inspection_id', inspectionId)
    .maybeSingle();
  const stop = stopRow as
    | { packet_id: string; inspection_packets: { awarded_contractor_id: string | null } }
    | null;
  if (!stop || stop.inspection_packets?.awarded_contractor_id !== contractor.id) {
    redirect('/field');
  }

  const { data: inspection } = await supabase
    .from('inspections')
    .select('*')
    .eq('id', inspectionId)
    .maybeSingle();
  if (!inspection) notFound();
  const insp = inspection as InspectionRow;
  if (insp.completed_at) redirect(`/field/packet/${stop.packet_id}`);

  let cards: OrderedCard[] = [];
  if (Array.isArray(insp.ordered_cards) && insp.ordered_cards.length > 0) {
    cards = insp.ordered_cards;
  } else if (insp.ordered_item_ids && insp.ordered_item_ids.length > 0) {
    cards = insp.ordered_item_ids.map((iid) => ({ itemId: iid, zoneId: null }));
  }
  const itemIds = Array.from(new Set(cards.map((c) => c.itemId)));
  const zoneIds = Array.from(new Set(cards.map((c) => c.zoneId).filter((z): z is string => !!z)));

  const [{ data: property }, { data: items }, { data: results }, { data: zoneRows }] = await Promise.all([
    supabase.from('properties').select('id, name, title, city, bedrooms').eq('id', insp.property_id).maybeSingle(),
    itemIds.length > 0
      ? supabase
          .from('inspection_items')
          .select('id, template_id, category, title, description, sort_order, item_category, interval_days, priority, season_constraint')
          .in('id', itemIds)
      : supabase
          .from('inspection_items')
          .select('id, template_id, category, title, description, sort_order, item_category, interval_days, priority, season_constraint')
          .eq('template_id', insp.template_id)
          .order('sort_order'),
    supabase
      .from('inspection_results')
      .select('id, inspection_id, item_id, property_zone_id, status, notes, photo_urls, created_at')
      .eq('inspection_id', inspectionId),
    zoneIds.length > 0
      ? supabase.from('property_zones').select('*').in('id', zoneIds)
      : { data: [] as PropertyZoneRow[] },
  ]);

  if (!property) notFound();

  if (cards.length === 0) {
    cards = ((items ?? []) as InspectionItemRow[]).map((it) => ({ itemId: it.id, zoneId: null }));
  }

  const itemMap = new Map<string, InspectionItemRow>();
  for (const it of (items ?? []) as InspectionItemRow[]) itemMap.set(it.id, it);
  const zoneMap = new Map<string, PropertyZoneRow>();
  for (const z of (zoneRows ?? []) as PropertyZoneRow[]) zoneMap.set(z.id, z);

  const stepperCards = cards
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
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const [{ data: notesData }, { data: workSlipsData }] = await Promise.all([
    supabase
      .from('inspection_notes')
      .select('id, inspection_item_id, note_text, note_type, author_email, created_at, photo_urls')
      .eq('inspection_id', inspectionId)
      .is('resolved_at', null)
      .order('created_at', { ascending: true }),
    supabase
      .from('work_slips')
      .select('id, inspection_item_id, title, category, priority, created_at, photo_urls')
      .eq('inspection_id', inspectionId)
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
      inspectionId={inspectionId}
      propertyId={(property as { id: string }).id}
      propertyName={(property as { name: string }).name}
      propertyBedrooms={(property as { bedrooms: number | null }).bedrooms}
      inspectorName={insp.inspector_name}
      initialNotes={initialNotes}
      initialWorkSlips={initialWorkSlips}
      cards={stepperCards}
      initialResults={(results ?? []).map((r) => {
        const rr = r as InspectionResultRow;
        return { item_id: rr.item_id, zone_id: rr.property_zone_id, status: rr.status, notes: rr.notes, photo_urls: rr.photo_urls ?? [] };
      })}
    />
  );
}
