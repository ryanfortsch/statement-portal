import { supabaseAdmin as supabase } from '@/lib/supabase-admin';

/** Who gets credit for the work orders an inspection's issues open. For a
 *  contractor walk the packet approval passes the inspector + packet so the
 *  work board shows "flagged by <name>" (same provenance rail as post-visit
 *  reports); staff walks just carry created_by_email. */
export type IssueSlipAttribution = {
  createdByEmail: string;
  reportedByContractorId?: string | null;
  reportedFromPacketId?: string | null;
};

/**
 * Every card flagged as an Issue on a finished inspection becomes an open
 * work slip on the Work board, carrying the inspector's photos + notes and
 * threading back to the source card via inspection_id/inspection_item_id.
 *
 * In Perfection, flagging an issue could open a work order in the same
 * gesture; Helm held issues in the report email only, so a flagged issue died
 * unless someone hand-filed a slip. This makes the contract structural:
 * inspection issues always feed through to Helm.
 *
 * Idempotent per item: an issue is skipped when this inspection already has a
 * slip for the same card (a re-run after a partial failure, or the inspector
 * already filed one by hand from that card mid-walk). Never throws - callers
 * treat this like the restock fan-out, a best-effort side effect that must not
 * block completing or approving.
 */
export async function openWorkSlipsForInspectionIssues(
  inspectionId: string,
  attribution: IssueSlipAttribution,
): Promise<{ created: number }> {
  try {
    const { data: inspData } = await supabase
      .from('inspections')
      .select('id, property_id, template_id')
      .eq('id', inspectionId)
      .maybeSingle();
    const insp = inspData as { id: string; property_id: string; template_id: string } | null;
    if (!insp) return { created: 0 };

    const { data: rData } = await supabase
      .from('inspection_results')
      .select('item_id, property_zone_id, status, notes, photo_urls')
      .eq('inspection_id', inspectionId)
      .eq('status', 'issue');
    const issues = (rData ?? []) as {
      item_id: string;
      property_zone_id: string | null;
      notes: string | null;
      photo_urls: string[] | null;
    }[];
    if (issues.length === 0) return { created: 0 };

    const [{ data: iData }, { data: zData }, { data: existingData }] = await Promise.all([
      supabase
        .from('inspection_items')
        .select('id, title')
        .in('id', Array.from(new Set(issues.map((r) => r.item_id)))),
      supabase.from('property_zones').select('id, name').eq('property_id', insp.property_id),
      supabase.from('work_slips').select('inspection_item_id').eq('inspection_id', inspectionId),
    ]);
    const titleByItem = new Map(((iData ?? []) as { id: string; title: string }[]).map((i) => [i.id, i.title]));
    const zoneNameById = new Map(((zData ?? []) as { id: string; name: string }[]).map((z) => [z.id, z.name]));
    const coveredItems = new Set(
      ((existingData ?? []) as { inspection_item_id: string | null }[])
        .map((w) => w.inspection_item_id)
        .filter((v): v is string => !!v),
    );

    const rows = issues
      .filter((r) => !coveredItems.has(r.item_id))
      .map((r) => ({
        property_id: insp.property_id,
        inspection_id: inspectionId,
        inspection_item_id: r.item_id,
        title: titleByItem.get(r.item_id) ?? 'Inspection issue',
        description: r.notes?.trim() || null,
        location: r.property_zone_id ? zoneNameById.get(r.property_zone_id) ?? null : null,
        category: 'maintenance' as const,
        priority: 'normal' as const,
        status: 'open' as const,
        created_by_email: attribution.createdByEmail,
        reported_by_contractor_id: attribution.reportedByContractorId ?? null,
        reported_from_packet_id: attribution.reportedFromPacketId ?? null,
        photo_urls: r.photo_urls ?? [],
      }));
    if (rows.length === 0) return { created: 0 };

    const { error } = await supabase.from('work_slips').insert(rows);
    if (error) {
      console.warn('[inspection-issue-slips] insert failed', error);
      return { created: 0 };
    }
    return { created: rows.length };
  } catch (err) {
    console.warn('[inspection-issue-slips] failed', err);
    return { created: 0 };
  }
}
