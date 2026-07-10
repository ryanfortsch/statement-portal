import { notFound } from 'next/navigation';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { ProjectionRow, ReadinessState } from '@/lib/projections-types';
import { computeReadiness } from '@/lib/projections-readiness';
import { ReadinessChecklistClient } from '@/components/projections/ReadinessChecklistClient';

/**
 * Interactive Property Readiness Checklist (mobile-first walkthrough tool).
 *
 * Thin server wrapper that:
 *   1. fetches the prospect row + computes per-property quantities, and
 *   2. hands the static data + initial state to a client component that
 *      handles tap-to-check, debounced note-saving, optimistic updates,
 *      and progress tracking.
 *
 * The corresponding printable (owner-facing) version lives at
 * /projections/<id>/readiness/print — same computation, no interactivity,
 * letter-portrait layout for the PDF pipeline.
 */

export const dynamic = 'force-dynamic';

async function getProjection(id: string): Promise<ProjectionRow | null> {
  const { data } = await supabase.from('projections').select('*').eq('id', id).maybeSingle();
  return (data as ProjectionRow | null) ?? null;
}

export default async function ReadinessInteractivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const projection = await getProjection(id);
  if (!projection) notFound();

  const { context, groups } = computeReadiness(projection);
  const propertyTag = `${projection.property_address}${projection.property_city ? `, ${projection.property_city.split(',')[0]}` : ''}`;
  const salutation =
    projection.prospect_first_names ||
    projection.prospect_first_name ||
    projection.prospect_name ||
    'Owner';
  const propertyTypeLabel = (projection.property_type || 'home').toLowerCase();

  // Coerce the persisted blob into the typed shape the client expects.
  // Older / null rows resolve to an empty state.
  const initial: ReadinessState = {
    checked: Array.isArray(projection.readiness_state?.checked)
      ? projection.readiness_state!.checked
      : [],
    notes:
      projection.readiness_state?.notes && typeof projection.readiness_state.notes === 'object'
        ? projection.readiness_state.notes
        : {},
    updated_at: projection.readiness_state?.updated_at,
  };

  return (
    <ReadinessChecklistClient
      projectionId={id}
      propertyTag={propertyTag}
      salutation={salutation}
      propertyTypeLabel={propertyTypeLabel}
      groups={groups}
      context={context}
      initial={initial}
      printHref={`/projections/${id}/readiness/print`}
    />
  );
}
