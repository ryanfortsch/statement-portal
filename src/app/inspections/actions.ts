'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';
import { resolveInspectionActor } from '@/lib/field-auth';
import { fieldDb } from '@/lib/field-db';
import {
  HELM_CORE_TEMPLATE_ID,
  type InspectionStatus,
  type InspectionNoteType,
  type WorkSlipCategory,
  type WorkSlipPriority,
} from '@/lib/inspections-types';
import { generateDeck } from '@/lib/inspection-deck';
import { sendInspectionReportEmail } from '@/lib/inspection-report-email';
import { suppliesLabel } from '@/lib/inspection-supplies';

export async function startInspection(formData: FormData) {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const propertyId = String(formData.get('property_id') || '');
  if (!propertyId) throw new Error('Pick a property');

  const inspectorName =
    session.user.name?.trim() ||
    session.user.email.split('@')[0].replace(/^./, (c) => c.toUpperCase());

  // Generate the 10-card deck for this property + active template
  const deck = await generateDeck({
    templateId: HELM_CORE_TEMPLATE_ID,
    propertyId,
    client: supabase,
  });

  const { data, error } = await supabase
    .from('inspections')
    .insert({
      property_id: propertyId,
      template_id: HELM_CORE_TEMPLATE_ID,
      inspector_email: session.user.email,
      inspector_name: inspectorName,
      ordered_item_ids: deck.itemIds,
      ordered_cards: deck.cards,
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(error?.message || 'Failed to start inspection');

  revalidatePath('/inspections');
  redirect(`/inspections/${data.id}`);
}

/**
 * Delete an inspection (an accidental start, a test walk, an abandoned
 * shell). inspection_results cascade-delete with the row; notes, plans,
 * work slips, and intermittent history all keep their rows with
 * inspection_id nulled, so real work slips and pinned property notes
 * survive a deleted walk. Blocked only when a Field packet stop still
 * points at the inspection — the operator unbundles it from the packet
 * first (that FK is ON DELETE NO ACTION and would otherwise throw).
 */
export async function deleteInspection(
  inspectionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!inspectionId) return { ok: false, error: 'Missing inspection id' };

  const { error } = await supabase.from('inspections').delete().eq('id', inspectionId);
  if (error) {
    // packet_stops.inspection_id is ON DELETE NO ACTION, so an inspection
    // bundled into a Field packet throws a FK violation (23503) rather than
    // deleting. Surface that as a clear instruction, not a raw constraint
    // error. (The whole DELETE — including the results cascade — rolls back
    // atomically on the violation, so there's no partial state to clean up.)
    if (error.code === '23503') {
      return {
        ok: false,
        error: 'This inspection is part of a Field packet. Remove it from the packet first.',
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath('/inspections');
  revalidatePath('/operations');
  return { ok: true };
}

/**
 * Save (or re-save) a single item's result. Used by the mobile stepper
 * for per-card optimistic saves. Idempotent (upserts on
 * inspection_id + item_id) so repeated taps or retries are safe.
 */
export async function saveResult(args: {
  inspectionId: string;
  itemId: string;
  zoneId: string | null;
  status: InspectionStatus;
  notes: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await resolveInspectionActor();
  if (!actor) return { ok: false, error: 'Not signed in' };

  if (args.status !== 'pass' && args.status !== 'issue' && args.status !== 'na') {
    return { ok: false, error: `Invalid status: ${args.status}` };
  }

  const { error } = await supabase
    .from('inspection_results')
    .upsert(
      {
        inspection_id: args.inspectionId,
        item_id: args.itemId,
        property_zone_id: args.zoneId,
        status: args.status,
        notes: args.notes || null,
      },
      { onConflict: 'inspection_id,item_id,property_zone_id' }
    );

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/inspections/${args.inspectionId}`);
  return { ok: true };
}

/**
 * Finalize an inspection. Reads existing inspection_results (already
 * saved per-card via saveResult), computes aggregate counts on the
 * inspection row, records any intermittent items completed to the
 * per-property history, bumps or resets the spacing counter, and
 * redirects to the summary page.
 */
export async function completeInspection(
  inspectionId: string,
  opts: { suppliesLow?: string[] } = {},
) {
  const actor = await resolveInspectionActor();
  if (!actor) throw new Error('Not signed in');
  // Pin to a local so TS keeps the narrowing past the async fanouts below.
  const sessionEmail: string = actor.email;

  // Stepper sends the list of supply keys the inspector flipped to LOW
  // on the review screen. Empty array (or omitted for back-compat) means
  // every supply is OK. We persist this verbatim on the inspections row
  // and create one Rising Tide restock work_slip per low supply below.
  const suppliesLow = Array.from(
    new Set((opts.suppliesLow ?? []).map((k) => k.trim()).filter((k) => k.length > 0)),
  );

  const [{ data: results }, { data: insp }] = await Promise.all([
    supabase
      .from('inspection_results')
      .select('item_id, property_zone_id, status, photo_urls')
      .eq('inspection_id', inspectionId),
    supabase
      .from('inspections')
      .select('property_id, template_id, ordered_cards')
      .eq('id', inspectionId)
      .maybeSingle(),
  ]);

  const allResults = (results ?? []) as {
    item_id: string;
    property_zone_id: string | null;
    status: InspectionStatus;
    photo_urls: string[] | null;
  }[];
  if (allResults.length === 0) throw new Error('Mark at least one item before completing');

  // Quality floor for EXTERNAL contractors (guest-readiness is the product):
  // every card must be marked, and every Issue must carry a photo. Staff keep
  // the lenient one-item minimum.
  if (actor.kind === 'contractor') {
    const cards = (insp as { ordered_cards?: unknown[] } | null)?.ordered_cards;
    const cardCount = Array.isArray(cards) ? cards.length : 0;
    const markedCards = new Set(allResults.map((r) => `${r.item_id}::${r.property_zone_id ?? '_'}`)).size;
    if (cardCount > 0 && markedCards < cardCount) {
      throw new Error(`Mark every card before submitting — ${markedCards} of ${cardCount} done.`);
    }
    if (allResults.some((r) => r.status === 'issue' && (!r.photo_urls || r.photo_urls.length === 0))) {
      throw new Error('Add a photo to each Issue before submitting.');
    }
  }

  const passCount = allResults.filter((r) => r.status === 'pass').length;
  const issueCount = allResults.filter((r) => r.status === 'issue').length;
  const naCount = allResults.filter((r) => r.status === 'na').length;

  if (insp) {
    const itemIds = allResults.map((r) => r.item_id);
    const { data: itemRows } = await supabase
      .from('inspection_items')
      .select('id, item_category')
      .in('id', itemIds);

    const intermittentIds = new Set(
      (itemRows ?? [])
        .filter((r: { item_category: string | null }) => r.item_category === 'INTERMITTENT')
        .map((r: { id: string }) => r.id)
    );

    if (intermittentIds.size > 0) {
      const nowIso = new Date().toISOString();
      await supabase.from('property_inspection_item_history').upsert(
        Array.from(intermittentIds).map((iid) => ({
          property_id: (insp as { property_id: string }).property_id,
          inspection_item_id: iid,
          last_completed_at: nowIso,
          last_inspection_id: inspectionId,
        })),
        { onConflict: 'property_id,inspection_item_id' }
      );

      await supabase
        .from('properties')
        .update({ inspections_since_last_intermittent: 0 })
        .eq('id', (insp as { property_id: string }).property_id);
    } else {
      const { data: prop } = await supabase
        .from('properties')
        .select('inspections_since_last_intermittent')
        .eq('id', (insp as { property_id: string }).property_id)
        .maybeSingle();
      const next =
        ((prop as { inspections_since_last_intermittent: number } | null)
          ?.inspections_since_last_intermittent ?? 0) + 1;
      await supabase
        .from('properties')
        .update({ inspections_since_last_intermittent: next })
        .eq('id', (insp as { property_id: string }).property_id);
    }
  }

  const { error: updateError } = await supabase
    .from('inspections')
    .update({
      completed_at: new Date().toISOString(),
      total_items: allResults.length,
      pass_count: passCount,
      issue_count: issueCount,
      na_count: naCount,
      supplies_low: suppliesLow,
    })
    .eq('id', inspectionId);

  if (updateError) throw new Error(updateError.message);

  // Fan out one Rising Tide restock work slip per low supply, attributed
  // to the property + this inspection so it threads back from the slip's
  // Source section. Done after the inspection row is finalized so a slip
  // never exists for an incomplete inspection. Errors per slip are
  // logged-and-swallowed so a single failure doesn't block completion.
  if (suppliesLow.length > 0 && insp) {
    const propertyId = (insp as { property_id: string }).property_id;
    const rows = suppliesLow.map((key) => ({
      property_id: propertyId,
      inspection_id: inspectionId,
      inspection_item_id: null,
      title: `Restock: ${suppliesLabel(key)}`,
      description: `Marked low on the Supplies Check at the end of this inspection.`,
      location: null,
      from_supply_key: key,
      category: 'inventory' as const,
      priority: 'normal' as const,
      status: 'open' as const,
      created_by_email: sessionEmail,
      photo_urls: [],
    }));
    const { error: slipErr } = await supabase.from('work_slips').insert(rows);
    if (slipErr) console.warn('[completeInspection] restock slip insert failed', slipErr);
  }

  // Staff: fan the finalized report to Allie + Ryan now. Contractor: HOLD it
  // until the office approves the packet, so an unreviewed external inspection
  // isn't broadcast before the QA gate (fired in approvePacket).
  if (actor.kind !== 'contractor') {
    await sendInspectionReportEmail(inspectionId).catch((err) =>
      console.warn('[completeInspection] report email failed', err),
    );
  }

  revalidatePath('/inspections');
  revalidatePath(`/inspections/${inspectionId}`);

  // A contractor finishing a packet stop returns to their packet hub (the
  // internal summary page is auth-gated). Mark the stop complete on the way.
  if (actor.kind === 'contractor') {
    // Bind completion to the contractor who was AWARDED the packet — the
    // inspectionId is client-supplied, so don't trust it on its own (IDOR).
    const { data: stopRow } = await fieldDb()
      .from('packet_stops')
      .select('packet_id')
      .eq('inspection_id', inspectionId)
      .maybeSingle();
    const packetId = (stopRow as { packet_id: string } | null)?.packet_id;
    if (!packetId) redirect('/field');
    const { data: pk } = await fieldDb()
      .from('inspection_packets')
      .select('awarded_contractor_id')
      .eq('id', packetId)
      .maybeSingle();
    if ((pk as { awarded_contractor_id: string | null } | null)?.awarded_contractor_id !== actor.contractorId) {
      redirect('/field');
    }
    await fieldDb().from('packet_stops').update({ status: 'complete' }).eq('inspection_id', inspectionId);
    redirect(`/field/packet/${packetId}`);
  }

  redirect(`/inspections/${inspectionId}/summary`);
}

/**
 * Add a standalone note from inside an inspection. PROPERTY_NOTE notes
 * pin to the property folder and persist across inspections; the
 * INSPECTION_NOTE flavor stays scoped to this one inspection.
 */
export async function addInspectionNote(args: {
  inspectionId: string;
  propertyId: string;
  itemId?: string | null;
  text: string;
  noteType: InspectionNoteType;
  photoUrls?: string[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await resolveInspectionActor();
  if (!actor) return { ok: false, error: 'Not signed in' };

  const text = args.text.trim();
  const photos = (args.photoUrls ?? []).filter((u) => typeof u === 'string' && u.length > 0);
  // Allow photo-only notes; require text OR at least one photo.
  if (!text && photos.length === 0) return { ok: false, error: 'Add text or a photo' };
  if (args.noteType !== 'INSPECTION_NOTE' && args.noteType !== 'PROPERTY_NOTE') {
    return { ok: false, error: `Invalid note type: ${args.noteType}` };
  }

  const { data, error } = await supabase
    .from('inspection_notes')
    .insert({
      inspection_id: args.inspectionId,
      property_id: args.propertyId,
      inspection_item_id: args.itemId ?? null,
      author_email: actor.email,
      note_text: text || '(photo)',
      note_type: args.noteType,
      photo_urls: photos,
    })
    .select('id')
    .single();

  if (error || !data) return { ok: false, error: error?.message || 'Insert failed' };

  revalidatePath(`/inspections/${args.inspectionId}`);
  revalidatePath(`/inspections/${args.inspectionId}/summary`);
  if (args.noteType === 'PROPERTY_NOTE') {
    revalidatePath(`/properties/${args.propertyId}`);
  }
  return { ok: true, id: (data as { id: string }).id };
}

/**
 * Resolve a property note (mark as no-longer-pinned-to-the-folder).
 * Used by the "x" / "resolve" button on the property folder pinned-notes
 * section so an old observation doesn't accumulate forever.
 */
export async function resolveInspectionNote(noteId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };

  const { data: noteRow } = await supabase
    .from('inspection_notes')
    .select('property_id')
    .eq('id', noteId)
    .maybeSingle();

  const { error } = await supabase
    .from('inspection_notes')
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by_email: session.user.email,
    })
    .eq('id', noteId);

  if (error) return { ok: false, error: error.message };

  if (noteRow && (noteRow as { property_id: string }).property_id) {
    revalidatePath(`/properties/${(noteRow as { property_id: string }).property_id}`);
  }
  return { ok: true };
}

/**
 * Create a work slip from inside an inspection. The slip lands in
 * Helm's Work module (`/work`) with `inspection_id` + `inspection_item_id`
 * preserved so the slip can deep-link back to the source card.
 */
export async function createWorkSlipFromInspection(args: {
  inspectionId: string;
  propertyId: string;
  itemId?: string | null;
  title: string;
  description?: string | null;
  location?: string | null;
  category: WorkSlipCategory;
  priority: WorkSlipPriority;
  photoUrls?: string[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await resolveInspectionActor();
  if (!actor) return { ok: false, error: 'Not signed in' };

  const title = args.title.trim();
  if (!title) return { ok: false, error: 'Title is required' };

  const validCategories = ['maintenance', 'owner', 'vendor', 'other', 'rising_tide'] as const;
  const validPriorities = ['low', 'normal', 'high'] as const;
  if (!validCategories.includes(args.category)) {
    return { ok: false, error: `Invalid category: ${args.category}` };
  }
  if (!validPriorities.includes(args.priority)) {
    return { ok: false, error: `Invalid priority: ${args.priority}` };
  }

  const photos = (args.photoUrls ?? []).filter((u) => typeof u === 'string' && u.length > 0);

  const { data, error } = await supabase
    .from('work_slips')
    .insert({
      property_id: args.propertyId,
      inspection_id: args.inspectionId,
      inspection_item_id: args.itemId ?? null,
      title,
      description: args.description?.trim() || null,
      location: args.location?.trim() || null,
      category: args.category,
      priority: args.priority,
      status: 'open',
      created_by_email: actor.email,
      photo_urls: photos,
    })
    .select('id')
    .single();

  if (error || !data) return { ok: false, error: error?.message || 'Insert failed' };

  revalidatePath(`/inspections/${args.inspectionId}`);
  revalidatePath(`/inspections/${args.inspectionId}/summary`);
  revalidatePath(`/properties/${args.propertyId}`);
  revalidatePath('/work');
  return { ok: true, id: (data as { id: string }).id };
}
