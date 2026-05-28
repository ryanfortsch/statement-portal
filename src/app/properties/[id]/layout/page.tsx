import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import type { PropertyZoneRow } from '@/lib/inspections-types';
import type { HelmPropertyRow } from '@/lib/properties';
import { deleteZoneFromForm, moveZoneFromForm } from './actions';
import { LayoutProseInput } from './LayoutProseInput';

export const dynamic = 'force-dynamic';

type Params = { id: string };

type ZoneSummary = PropertyZoneRow & { item_count: number };

async function getData(propertyId: string): Promise<{
  property: HelmPropertyRow;
  zones: ZoneSummary[];
} | null> {
  if (!isHelmConfigured) return null;

  const { data: property } = await supabase
    .from('properties')
    .select('*')
    .eq('id', propertyId)
    .maybeSingle();
  if (!property) return null;

  const { data: zoneRows } = await supabase
    .from('property_zones')
    .select('*')
    .eq('property_id', propertyId)
    .order('walk_order', { ascending: true });
  const zones = (zoneRows ?? []) as PropertyZoneRow[];

  // Count assigned items per zone so each card can show "N items" without
  // having to load the full inspection_items template (the per-zone Manage
  // Items UI is gone; re-run Parse to remap).
  const itemCounts = new Map<string, number>();
  if (zones.length > 0) {
    const { data: assignments } = await supabase
      .from('property_zone_items')
      .select('property_zone_id')
      .in('property_zone_id', zones.map((z) => z.id));
    for (const a of (assignments ?? []) as { property_zone_id: string }[]) {
      itemCounts.set(a.property_zone_id, (itemCounts.get(a.property_zone_id) ?? 0) + 1);
    }
  }

  const zonesSummary: ZoneSummary[] = zones.map((z) => ({
    ...z,
    item_count: itemCounts.get(z.id) ?? 0,
  }));

  return { property: property as HelmPropertyRow, zones: zonesSummary };
}

export default async function PropertyLayoutPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const data = await getData(id);
  if (!data) notFound();
  const { property, zones } = data;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="properties" />

      <div className="max-w-[900px] mx-auto px-10" style={{ paddingTop: 24, width: '100%' }}>
        <Link
          href={`/properties/${property.id}`}
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

      <section className="max-w-[900px] mx-auto px-10" style={{ paddingTop: 24, paddingBottom: 18, width: '100%' }}>
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
        <p style={{ marginTop: 12, fontSize: 14, color: 'var(--ink-3)', maxWidth: 640, lineHeight: 1.6 }}>
          Map this property as a sequence of zones in the order an inspector would physically walk
          them. Each zone gets its own set of items from the Helm Core 12 template, so a property
          with three bathrooms produces three bathroom cards (not one), in walking order. Until a
          property is fully mapped here, inspections fall back to the template-wide deck.
        </p>
      </section>

      {/* ─── Describe the house — Claude maps the whole layout ─── */}
      <LayoutProseInput propertyId={property.id} existingZoneCount={zones.length} />

      {/* ─── Zones (read-only summary; re-run Parse to re-map) ─── */}
      <section
        className="max-w-[900px] mx-auto px-10"
        style={{ paddingBottom: 80, width: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        {zones.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--ink-4)', fontStyle: 'italic', padding: '24px 0' }}>
            No zones yet. Add the first one above (e.g. &ldquo;Living room&rdquo; on the main floor).
          </p>
        ) : (
          zones.map((zone, idx) => (
            <ZoneCard
              key={zone.id}
              zone={zone}
              isFirst={idx === 0}
              isLast={idx === zones.length - 1}
            />
          ))
        )}
      </section>

      <style>{layoutCss}</style>
    </div>
  );
}

function ZoneCard({
  zone,
  isFirst,
  isLast,
}: {
  zone: ZoneSummary;
  isFirst: boolean;
  isLast: boolean;
}) {
  const itemCount = zone.item_count;

  return (
    <article
      style={{
        border: '1px solid var(--rule)',
        background: 'var(--paper)',
      }}
    >
      {/* Header strip */}
      <header
        style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--rule)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <span
            className="font-mono"
            style={{
              fontSize: 11,
              letterSpacing: '.22em',
              color: 'var(--ink-4)',
              fontWeight: 600,
            }}
          >
            #{zone.walk_order}
          </span>
          <h3
            className="font-serif"
            style={{
              fontSize: 22,
              fontWeight: 400,
              letterSpacing: '-0.01em',
              color: 'var(--ink)',
              margin: 0,
            }}
          >
            {zone.name}
          </h3>
          {zone.floor_label && (
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{zone.floor_label}</span>
          )}
          <span
            style={{
              fontSize: 10,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              color: itemCount === 0 ? 'var(--signal)' : 'var(--ink-3)',
              fontWeight: 600,
            }}
          >
            {itemCount === 0 ? 'No items' : `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 4 }}>
          <form action={moveZoneFromForm}>
            <input type="hidden" name="zone_id" value={zone.id} />
            <input type="hidden" name="direction" value="up" />
            <button
              type="submit"
              disabled={isFirst}
              title="Move earlier in the walk"
              className="rt-icon-btn"
            >
              ↑
            </button>
          </form>
          <form action={moveZoneFromForm}>
            <input type="hidden" name="zone_id" value={zone.id} />
            <input type="hidden" name="direction" value="down" />
            <button
              type="submit"
              disabled={isLast}
              title="Move later in the walk"
              className="rt-icon-btn"
            >
              ↓
            </button>
          </form>
        </div>
      </header>

      {/* Edit form */}
      {/* Inline delete — escape hatch so a bad zone can be dropped without
          re-parsing the whole layout. No edit form, no checkbox lists:
          if items or naming need tweaking, re-run Parse. */}
      <form
        action={deleteZoneFromForm}
        style={{ padding: '8px 18px 14px', display: 'flex', justifyContent: 'flex-end' }}
      >
        <input type="hidden" name="zone_id" value={zone.id} />
        <button
          type="submit"
          className="rt-btn-danger"
          aria-label={`Delete zone ${zone.name}`}
          title="Delete this zone"
        >
          × Delete zone
        </button>
      </form>
    </article>
  );
}

const layoutCss = `
  .rt-edit-field { display: flex; flex-direction: column; gap: 6px; }
  .rt-edit-label {
    font-size: 11px;
    letter-spacing: 0.06em;
    color: var(--ink);
    font-weight: 500;
  }
  .rt-edit-field input,
  .rt-edit-field textarea {
    font: inherit;
    font-size: 14px;
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--rule);
    padding: 10px 12px;
    outline: none;
    width: 100%;
    box-sizing: border-box;
    font-family: var(--font-inter), system-ui, sans-serif;
  }
  .rt-edit-field textarea { resize: vertical; min-height: 56px; }
  .rt-edit-field input:focus,
  .rt-edit-field textarea:focus { border-color: var(--ink); }

  .rt-btn-primary {
    background: var(--ink);
    color: var(--paper);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    padding: 10px 18px;
    border: none;
    cursor: pointer;
  }
  .rt-btn-danger {
    background: transparent;
    color: var(--signal);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    padding: 10px 14px;
    border: 1px solid var(--signal);
    cursor: pointer;
  }

  .rt-icon-btn {
    background: var(--paper);
    color: var(--ink);
    border: 1px solid var(--rule);
    width: 32px;
    height: 32px;
    font-size: 14px;
    cursor: pointer;
    padding: 0;
  }
  .rt-icon-btn:hover:not(:disabled) { border-color: var(--ink); }
  .rt-icon-btn:disabled { color: var(--ink-4); cursor: not-allowed; opacity: 0.5; }
`;
