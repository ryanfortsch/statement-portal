import { notFound, redirect } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmBreadcrumb } from '@/components/HelmBreadcrumb';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { ProjectionRow } from '@/lib/projections-types';
import { computeReadiness, READINESS_NOTE_FIELDS } from '@/lib/projections-readiness';
import { loadWalkthrough } from '@/lib/home-walkthrough-db';
import { OutfittingClient } from '@/components/walkthrough/OutfittingClient';

/**
 * The outfitting walkthrough in counting mode: the prospect visit. What the
 * home already has, the walkthrough notes, what is still needed, and Send to
 * team for review. Its print twin (the owner-facing punch list) stays at
 * /prospects/<id>/readiness/print.
 *
 * Once the prospect is promoted the same walkthrough is the property's
 * outfitting order, so this address follows it there: the counts made at the
 * visit are where the order starts (one row of home_walkthroughs).
 */

export const dynamic = 'force-dynamic';

async function getProjection(id: string): Promise<ProjectionRow | null> {
  const { data } = await supabase.from('projections').select('*').eq('id', id).maybeSingle();
  return (data as ProjectionRow | null) ?? null;
}

async function propertyExists(id: string | null): Promise<boolean> {
  if (!id) return false;
  const { data } = await supabase.from('properties').select('id').eq('id', id).maybeSingle();
  return !!data;
}

export default async function OutfittingCountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projection = await getProjection(id);
  if (!projection) notFound();
  if (await propertyExists(projection.property_id)) redirect(`/properties/${projection.property_id}/order-checklist`);

  const { context, groups } = computeReadiness(projection);
  const homeName = `${projection.property_address}${projection.property_city ? `, ${projection.property_city.split(',')[0]}` : ''}`;
  const salutation = projection.prospect_first_names || projection.prospect_first_name || projection.prospect_name || 'Owner';
  const propertyTypeLabel = (projection.property_type || 'home').toLowerCase();
  const initial = await loadWalkthrough({ projectionId: id, propertyId: null });

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <HelmBreadcrumb
        trail={[
          { label: 'Prospects', href: '/properties/prospects' },
          { label: projection.property_address, href: `/prospects/${id}` },
          { label: 'Outfitting' },
        ]}
      />
      <OutfittingClient
        mode={{
          kind: 'counting',
          projectionId: id,
          salutation,
          printHref: `/prospects/${id}/readiness/print`,
          noteFields: READINESS_NOTE_FIELDS,
        }}
        homeName={homeName}
        backHref={`/prospects/${id}`}
        backLabel={projection.property_address || 'Prospect'}
        tagLine={`${salutation}’s ${propertyTypeLabel} · ${context.maxGuests} guests · ${context.bedrooms} BR / ${context.bathrooms} BA${context.bathroomsFromIntake ? '' : ' (est.)'}`}
        groups={groups}
        initial={initial}
      />
    </div>
  );
}
