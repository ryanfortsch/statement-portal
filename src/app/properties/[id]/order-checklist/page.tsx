import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmBreadcrumb } from '@/components/HelmBreadcrumb';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { HelmPropertyRow } from '@/lib/properties';
import { getPropertyRooms } from '@/lib/property-rooms';
import { computeOrderChecklist, deriveOrderContext } from '@/lib/order-checklist';
import { loadWalkthrough } from '@/lib/home-walkthrough-db';
import { OutfittingClient } from '@/components/walkthrough/OutfittingClient';

/**
 * The outfitting walkthrough in ordering mode: the property. Quantities
 * compute live from the home's record (beds by size, bathrooms, max guests)
 * with the Fix Linens 2.5x rules on linens and towels; "To order" at the
 * bottom is the actual order. It reads the same home_walkthroughs row the
 * prospect visit counted into, so nothing counted then is counted twice,
 * and it is reachable on every home before and after activation (Facts,
 * Tools line).
 */

export const dynamic = 'force-dynamic';

async function getProperty(id: string): Promise<HelmPropertyRow | null> {
  const { data } = await supabase.from('properties').select('*').eq('id', id).maybeSingle();
  return (data as HelmPropertyRow | null) ?? null;
}

export default async function OutfittingOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getProperty(id);
  if (!p) notFound();

  const [rooms, initial] = await Promise.all([
    getPropertyRooms(id),
    loadWalkthrough({ propertyId: id, projectionId: p.projection_id ?? null }),
  ]);

  const context = deriveOrderContext({
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    hasPulloutBed: !!p.has_pullout_bed,
    bedroomRoomCount: rooms.filter((r) => r.room_type === 'bedroom').length,
    roomBeds: rooms.flatMap((r) => r.details?.beds ?? []),
  });
  const groups = computeOrderChecklist(context);
  const bedsLine = context.beds.map((b) => `${b.count} ${b.size}`).join(', ');
  const tagLine =
    `${context.maxGuests} guests${context.guestsFromBeds ? '' : ' (est.)'} · ` +
    `${context.bedCount} bed${context.bedCount === 1 ? '' : 's'}` +
    `${context.bedsFromRooms ? ` (${bedsLine})` : ' (est.)'}` +
    `${context.hasPullout ? ' + pullout' : ''} · ${context.bedrooms} BR / ${context.bathrooms} BA${context.bathroomsFromRecord ? '' : ' (est.)'}`;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <div className="rt-oc-noprint">
        <HelmMasthead />
        <HelmBreadcrumb trail={[{ label: p.name, href: `/properties/${id}` }, { label: 'Outfitting' }]} />
      </div>
      <OutfittingClient
        mode={{ kind: 'ordering', propertyId: id, supplyClosetLocation: p.supply_closet_location ?? null, bedsMissing: !context.bedsFromRooms }}
        homeName={p.name}
        backHref={`/properties/${id}`}
        backLabel={p.name}
        tagLine={tagLine}
        groups={groups}
        initial={initial}
      />
    </div>
  );
}
