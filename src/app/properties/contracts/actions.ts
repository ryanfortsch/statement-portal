'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { requireOwnerEmail } from '@/lib/helm-access-server';
import { contractTermsLocked } from '@/lib/contract-terms';
import type { ProjectionRow } from '@/lib/projections-types';
import type { PropertyContractRow } from '@/lib/property-contracts';
import {
  contractHasEdits,
  driveFileIdFromUrl,
  parseRegisterForm,
  registerTermsFromProjection,
  registerTermsFromRow,
  type LockedTerms,
} from '@/lib/contract-register';

/**
 * "Register this agreement": the contracts register's own writer, beside
 * the countersign of a Helm renewal. Three ways in, one form:
 *
 * - new: the home has no live agreement; the row is inserted.
 * - replace: the home has a live agreement and a newer one was signed
 *   outside Helm; the live row becomes superseded and the new one is live.
 *   The form carries the live row's id and the write refuses if it moved.
 * - correct (`edit`): fix the live row in place.
 *
 * The lock rule: an agreement signed in Helm is the projection's contract,
 * whose terms are locked once the owner signs. Its register row takes every
 * term the contract states from the projection (registerTermsFromProjection,
 * the same builder countersign uses), and a correction of a Helm row keeps
 * the terms it was registered with. Nothing here writes to projections.
 *
 * Owners only: it records fees and deal terms.
 */
export async function registerAgreement(formData: FormData): Promise<{ error: string }> {
  await requireOwnerEmail();
  const str = (k: string) => String(formData.get(k) ?? '').trim();

  const propertyId = str('property_id');
  const projectionId = str('projection_id') || null;
  const orphanFileId = str('drive_file_id') || null;
  const replaces = str('replaces') || null;
  const editId = str('edit') || null;
  if (!propertyId) return { error: 'Pick the home this agreement covers.' };

  const { data: property } = await supabase
    .from('properties')
    .select('id, projection_id')
    .eq('id', propertyId)
    .maybeSingle();
  if (!property) return { error: 'That home is not in Helm.' };

  const { data: activeRows, error: activeErr } = await supabase
    .from('property_contracts')
    .select('*')
    .eq('property_id', propertyId)
    .eq('status', 'active');
  if (activeErr) return { error: 'Could not read the register. Nothing was saved; try again.' };
  const active = ((activeRows ?? [])[0] ?? null) as PropertyContractRow | null;

  // The terms the paper states and the form may not move.
  let locked: LockedTerms | null = null;
  let projection: ProjectionRow | null = null;
  if (projectionId) {
    const { data } = await supabase.from('projections').select('*').eq('id', projectionId).maybeSingle();
    projection = (data ?? null) as ProjectionRow | null;
    if (!projection) return { error: 'That Helm contract is gone.' };
    if (projection.property_id !== propertyId && (property as { projection_id: string | null }).projection_id !== projectionId) {
      return { error: 'That Helm contract belongs to another home.' };
    }
    if (!contractTermsLocked(projection)) {
      return { error: 'The owner has not signed this contract yet, so there is nothing to register. Send it for signature from the prospect page.' };
    }
    if (!projection.contract_countersigned_at) {
      return { error: 'The owner signed, but the agreement is not in force until Rising Tide countersigns. Countersign on the prospect page; a renewal registers itself then.' };
    }
    locked = registerTermsFromProjection(projection);
  }

  if (editId) {
    if (!active || active.id !== editId) {
      return { error: 'This entry is no longer the live agreement. Reload the register to see what changed.' };
    }
    if (active.signed_via === 'helm') locked = registerTermsFromRow(active);
  } else if (active && active.id !== replaces) {
    return { error: 'This home has a live agreement now. Reload the register to see it before registering another.' };
  }

  const parsed = parseRegisterForm(
    {
      owner_party: str('owner_party'),
      executed_on: str('executed_on'),
      term_start: str('term_start'),
      term_end: str('term_end'),
      renewal_type: str('renewal_type'),
      notice_days_initial: str('notice_days_initial'),
      notice_days_renewal: str('notice_days_renewal'),
      fee_pct: str('fee_pct'),
      signed_via: str('signed_via'),
      drive_url: str('drive_url'),
      notes: str('notes'),
    },
    locked,
  );
  if (!parsed.ok) return { error: parsed.error };
  const f = parsed.fields;

  type Orphan = { drive_file_id: string; title: string; drive_url: string };
  let orphan: Orphan | null = null;
  if (orphanFileId) {
    const { data } = await supabase
      .from('contract_drive_orphans')
      .select('drive_file_id, title, drive_url')
      .eq('drive_file_id', orphanFileId)
      .maybeSingle();
    orphan = (data ?? null) as Orphan | null;
  }

  const driveUrl = f.drive_url ?? (projection?.contract_drive_url || null) ?? orphan?.drive_url ?? null;
  const driveFileId = driveFileIdFromUrl(driveUrl);
  const docTitle =
    orphan && driveFileId === orphan.drive_file_id
      ? orphan.title
      : editId && active && driveUrl === active.drive_url
        ? active.doc_title
        : null;
  const signedVia = projection ? 'helm' : editId && active ? f.signed_via ?? active.signed_via : f.signed_via ?? 'external';
  const notes =
    f.notes ??
    (projection && contractHasEdits(projection)
      ? 'Clause overrides are on file - verify renewal/notice mechanics against the contract page.'
      : null);

  const row = {
    owner_party: f.owner_party,
    executed_on: f.executed_on ?? (projection?.contract_countersigned_at ? easternDay(projection.contract_countersigned_at) : null),
    term_start: f.term_start,
    term_end: f.term_end,
    renewal_type: f.renewal_type,
    notice_days_initial: f.notice_days_initial,
    notice_days_renewal: f.notice_days_renewal,
    fee_pct: f.fee_pct,
    signed_via: signedVia,
    drive_file_id: driveFileId,
    drive_url: driveUrl,
    doc_title: docTitle,
    notes,
    updated_at: new Date().toISOString(),
  };

  if (editId) {
    const { data: saved, error } = await supabase
      .from('property_contracts')
      .update(row)
      .eq('id', editId)
      .eq('status', 'active')
      .select('id');
    if (error || !saved?.length) return { error: 'The correction did not save. Reload the register and try again.' };
  } else {
    const fromProjection = locked && projection
      ? {
          min_availability: locked.min_availability,
          sale_notice_days: locked.sale_notice_days,
          sale_reputation_fee: locked.sale_reputation_fee,
        }
      : {};
    if (active) {
      const { data: flipped, error } = await supabase
        .from('property_contracts')
        .update({ status: 'superseded', updated_at: new Date().toISOString() })
        .eq('id', active.id)
        .eq('status', 'active')
        .select('id');
      if (error || !flipped?.length) {
        return { error: 'The live agreement changed while you were typing. Reload the register before registering another.' };
      }
    }
    const { error: insertErr } = await supabase
      .from('property_contracts')
      .insert({ property_id: propertyId, status: 'active', ...fromProjection, ...row });
    if (insertErr) {
      // Put the live row back so the home is never left with none.
      if (active) {
        await supabase.from('property_contracts').update({ status: 'active' }).eq('id', active.id).eq('status', 'superseded');
      }
      return { error: 'The agreement did not save. Nothing changed; try again.' };
    }
  }

  // A Drive PDF that now has a register row stops announcing itself (the
  // weekly sweep would drop it too, a week later).
  if (driveFileId) {
    await supabase.from('contract_drive_orphans').delete().eq('drive_file_id', driveFileId);
  }

  revalidatePath('/properties/contracts');
  revalidatePath(`/properties/${propertyId}`);
  redirect(`/properties/contracts?saved=${encodeURIComponent(propertyId)}#contract-${propertyId}`);
}

/** Calendar date of a timestamp as the office sees it (Eastern). */
function easternDay(ts: string): string {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}
