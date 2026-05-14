import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import { HELM_CORE_TEMPLATE_ID } from '@/lib/inspections-types';
import type {
  PropertyZoneRow,
  InspectionItemRow,
} from '@/lib/inspections-types';
import type { HelmPropertyRow } from '@/lib/properties';
import {
  createZoneFromForm,
  updateZoneFromForm,
  deleteZoneFromForm,
  moveZoneFromForm,
  setZoneItemsFromForm,
} from './actions';

export const dynamic = 'force-dynamic';

type Params = { id: string };

type ZoneWithItems = PropertyZoneRow & {
  item_ids: Set<string>;
};

async function getData(propertyId: string): Promise<{
  property: HelmPropertyRow;
  zones: ZoneWithItems[];
  items: InspectionItemRow[];
} | null> {
  if (!isHelmConfigured) return null;

  const { data: property } = await supabase
    .from('properties')
    .select('*')
    .eq('id', propertyId)
    .maybeSingle();
  if (!property) return null;

  const [{ data: zoneRows }, { data: itemRows }] = await Promise.all([
    supabase
      .from('property_zones')
      .select('*')
      .eq('property_id', propertyId)
      .order('walk_order', { ascending: true }),
    supabase
      .from('inspection_items')
      .select('id, template_id, category, title, description, sort_order, item_category, interval_days, priority, season_constraint')
      .eq('template_id', HELM_CORE_TEMPLATE_ID)
      .order('sort_order', { ascending: true }),
  ]);

  const zones = (zoneRows ?? []) as PropertyZoneRow[];
  const items = (itemRows ?? []) as InspectionItemRow[];

  const zoneIds = zones.map((z) => z.id);
  const itemAssignments: Map<string, Set<string>> = new Map();
  for (const z of zones) itemAssignments.set(z.id, new Set());

  if (zoneIds.length > 0) {
    const { data: assignments } = await supabase
      .from('property_zone_items')
      .select('property_zone_id, inspection_item_id')
      .in('property_zone_id', zoneIds);
    for (const a of (assignments ?? []) as {
      property_zone_id: string;
      inspection_item_id: string;
    }[]) {
      itemAssignments.get(a.property_zone_id)?.add(a.inspection_item_id);
    }
  }

  const zonesWithItems: ZoneWithItems[] = zones.map((z) => ({
    ...z,
    item_ids: itemAssignments.get(z.id) ?? new Set(),
  }));

  return { property: property as HelmPropertyRow, zones: zonesWithItems, items };
}

export default async function PropertyLayoutPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const data = await getData(id);
  if (!data) notFound();
  const { property, zones, items } = data;

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

      {/* ─── Add zone ─── */}
      <section className="max-w-[900px] mx-auto px-10" style={{ paddingBottom: 18, width: '100%' }}>
        <form
          action={async (formData: FormData) => { await createZoneFromForm(property.id, formData); }}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 200px auto',
            gap: 10,
            alignItems: 'end',
            padding: 16,
            border: '1px solid var(--rule)',
            background: 'var(--paper-2)',
          }}
        >
          <Field name="name" label="Zone name" placeholder="e.g. Upstairs bath" required />
          <Field name="floor_label" label="Floor" placeholder="e.g. Third floor" />
          <button
            type="submit"
            style={{
              background: 'var(--ink)',
              color: 'var(--paper)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              padding: '12px 18px',
              border: 'none',
              cursor: 'pointer',
              alignSelf: 'end',
            }}
          >
            + Add zone
          </button>
        </form>
      </section>

      {/* ─── Zones ─── */}
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
              allItems={items}
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
  allItems,
}: {
  zone: ZoneWithItems;
  isFirst: boolean;
  isLast: boolean;
  allItems: InspectionItemRow[];
}) {
  const itemCount = zone.item_ids.size;

  // Group items by category for a less-overwhelming checkbox grid.
  const itemsByCategory = new Map<string, InspectionItemRow[]>();
  for (const it of allItems) {
    if (!itemsByCategory.has(it.category)) itemsByCategory.set(it.category, []);
    itemsByCategory.get(it.category)!.push(it);
  }

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
          <form action={async () => { await moveZoneFromForm(zone.id, 'up'); }}>
            <button
              type="submit"
              disabled={isFirst}
              title="Move earlier in the walk"
              className="rt-icon-btn"
            >
              ↑
            </button>
          </form>
          <form action={async () => { await moveZoneFromForm(zone.id, 'down'); }}>
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
      <details style={{ borderBottom: '1px solid var(--rule-soft)' }}>
        <summary
          style={{
            padding: '10px 18px',
            cursor: 'pointer',
            fontSize: 11,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            userSelect: 'none',
          }}
        >
          Edit name / floor / notes
        </summary>
        <form
          action={async (formData: FormData) => { await updateZoneFromForm(zone.id, formData); }}
          style={{
            padding: '14px 18px 18px',
            display: 'grid',
            gridTemplateColumns: '2fr 1fr',
            gap: 12,
          }}
        >
          <Field name="name" label="Zone name" defaultValue={zone.name} required />
          <Field name="floor_label" label="Floor" defaultValue={zone.floor_label ?? ''} />
          <div style={{ gridColumn: '1 / -1' }}>
            <Field name="notes" label="Notes (optional)" defaultValue={zone.notes ?? ''} textarea />
          </div>
          <div
            style={{
              gridColumn: '1 / -1',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginTop: 4,
            }}
          >
            <button type="submit" className="rt-btn-primary">
              Save zone
            </button>
            <span style={{ flex: 1 }} />
            <form action={async () => { await deleteZoneFromForm(zone.id); }}>
              <button type="submit" className="rt-btn-danger">
                Delete zone
              </button>
            </form>
          </div>
        </form>
      </details>

      {/* Items assignment */}
      <details open={itemCount === 0}>
        <summary
          style={{
            padding: '10px 18px',
            cursor: 'pointer',
            fontSize: 11,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            userSelect: 'none',
          }}
        >
          Manage items ({itemCount})
        </summary>
        <form action={async (formData: FormData) => { await setZoneItemsFromForm(zone.id, formData); }} style={{ padding: '6px 18px 18px' }}>
          {Array.from(itemsByCategory.entries()).map(([category, list]) => (
            <div key={category} style={{ marginTop: 12 }}>
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: '.18em',
                  textTransform: 'uppercase',
                  color: 'var(--signal)',
                  fontWeight: 600,
                  marginBottom: 6,
                }}
              >
                {category}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 4 }}>
                {list.map((it) => (
                  <label
                    key={it.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '6px 4px',
                      fontSize: 13,
                      color: 'var(--ink)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      name="item_id"
                      value={it.id}
                      defaultChecked={zone.item_ids.has(it.id)}
                      style={{ marginTop: 3 }}
                    />
                    <span>
                      <span style={{ fontWeight: 500 }}>{it.title}</span>
                      {it.description && (
                        <span
                          style={{
                            display: 'block',
                            fontSize: 11,
                            color: 'var(--ink-4)',
                            marginTop: 2,
                            lineHeight: 1.4,
                          }}
                        >
                          {it.description}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div style={{ marginTop: 16 }}>
            <button type="submit" className="rt-btn-primary">
              Save items
            </button>
          </div>
        </form>
      </details>
    </article>
  );
}

function Field({
  name,
  label,
  defaultValue,
  placeholder,
  required,
  textarea,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  textarea?: boolean;
}) {
  return (
    <label className="rt-edit-field">
      <span className="rt-edit-label">{label}</span>
      {textarea ? (
        <textarea name={name} defaultValue={defaultValue ?? ''} rows={2} placeholder={placeholder} />
      ) : (
        <input
          name={name}
          type="text"
          defaultValue={defaultValue ?? ''}
          placeholder={placeholder}
          required={required}
        />
      )}
    </label>
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
