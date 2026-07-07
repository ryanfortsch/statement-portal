import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import { HELM_CORE_TEMPLATE_ID } from '@/lib/inspections-types';
import { loadPropertyDeckItemIds } from '@/lib/inspection-cards';
import type { HelmPropertyRow } from '@/lib/properties';
import { LayoutEditor, type EditorCard } from './LayoutEditor';

export const dynamic = 'force-dynamic';

type Params = { id: string };

type ItemRow = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  property_id: string | null;
  sort_order: number;
};

async function getData(propertyId: string): Promise<{
  property: HelmPropertyRow;
  deck: EditorCard[];
  addable: EditorCard[];
  isCustomized: boolean;
} | null> {
  if (!isHelmConfigured) return null;

  const { data: property } = await supabase
    .from('properties')
    .select('*')
    .eq('id', propertyId)
    .maybeSingle();
  if (!property) return null;

  // The property's effective ordered deck (persisted layout, or the
  // standard default if it hasn't been customized yet).
  const { itemIds, isCustomized } = await loadPropertyDeckItemIds(
    supabase,
    propertyId,
    HELM_CORE_TEMPLATE_ID,
  );

  // Every card this property could hold: shared standard items + its own
  // custom items. Split into the ordered deck vs. what's available to add.
  const { data: itemRows } = await supabase
    .from('inspection_items')
    .select('id, title, description, category, property_id, sort_order')
    .eq('template_id', HELM_CORE_TEMPLATE_ID)
    .or(`property_id.is.null,property_id.eq.${propertyId}`);

  const rows = (itemRows ?? []) as ItemRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const toCard = (r: ItemRow): EditorCard => ({
    itemId: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    isCustom: r.property_id !== null,
  });

  const deck: EditorCard[] = itemIds
    .map((id) => byId.get(id))
    .filter((r): r is ItemRow => !!r)
    .map(toCard);

  const inDeck = new Set(itemIds);
  const addable: EditorCard[] = rows
    .filter((r) => !inDeck.has(r.id))
    .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title))
    .map(toCard);

  return { property: property as HelmPropertyRow, deck, addable, isCustomized };
}

export default async function PropertyLayoutPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const data = await getData(id);
  if (!data) notFound();
  const { property, deck, addable, isCustomized } = data;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="properties" />

      <div className="max-w-[820px] mx-auto px-10" style={{ paddingTop: 24, width: '100%' }}>
        <Link
          href={`/properties/${property.id}?tab=operations`}
          style={{
            fontSize: 11,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            textDecoration: 'none',
          }}
        >
          ← {property.name}
        </Link>
      </div>

      <section className="max-w-[820px] mx-auto px-10" style={{ paddingTop: 24, paddingBottom: 10, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          Inspection layout
        </div>
        <h1
          className="font-serif"
          style={{
            fontSize: 40,
            lineHeight: 1.05,
            fontWeight: 300,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            margin: 0,
          }}
        >
          {property.name}
        </h1>
        <p style={{ marginTop: 12, fontSize: 14, color: 'var(--ink-3)', maxWidth: 600, lineHeight: 1.6 }}>
          These are the cards the inspection runs, in order. Drag to reorder, remove any you
          don&rsquo;t need, or add your own. Changes save automatically and apply to the next
          inspection at {property.name}.
        </p>
      </section>

      <LayoutEditor
        propertyId={property.id}
        initialDeck={deck}
        initialAddable={addable}
        isCustomized={isCustomized}
      />
    </div>
  );
}
