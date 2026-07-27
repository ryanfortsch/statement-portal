'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { fieldDb } from '@/lib/field-db';
import { loadEffectiveCard } from '@/lib/creative-rates';
import { computeShootPay, cardFromSnapshot, type ShootAsset } from '@/lib/creative-pay';
import { loadShootDetail } from '@/lib/creative-shoots';
import { sendApprovedEmail, sendPaidEmail } from '@/lib/field-notify';
import type { ContractorRow } from '@/lib/field-types';

async function staffEmail(): Promise<string> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');
  return session.user.email;
}

function centsFromDollars(v: FormDataEntryValue | null): number | null {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/** Log a shoot. property_id optional — b-roll and town days have no home. */
export async function createShoot(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const contractorId = String(formData.get('contractor_id') || '');
  const title = String(formData.get('title') || '').trim().slice(0, 200);
  const shootDate = String(formData.get('shoot_date') || '');
  if (!contractorId || !title || !shootDate) return;
  const propertyId = String(formData.get('property_id') || '').trim() || null;
  const { data } = await fieldDb()
    .from('creative_shoots')
    .insert({
      contractor_id: contractorId,
      property_id: propertyId,
      location_note: String(formData.get('location_note') || '').trim().slice(0, 300) || null,
      shoot_date: shootDate,
      title,
      notes: String(formData.get('notes') || '').trim().slice(0, 4000) || null,
      status: 'shot',
      created_by_email: email,
    })
    .select('id')
    .single();
  const id = (data as { id: string } | null)?.id;
  revalidatePath('/operations/creative');
  if (id) redirect(`/operations/creative/${id}`);
}

export async function addAsset(formData: FormData): Promise<void> {
  await staffEmail();
  const shootId = String(formData.get('shoot_id') || '');
  const kind = String(formData.get('kind') || '');
  if (!shootId || !['reel', 'carousel'].includes(kind)) return;
  const dur = Number(String(formData.get('duration_seconds') || '').trim());
  await fieldDb().from('creative_assets').insert({
    shoot_id: shootId,
    kind,
    title: String(formData.get('title') || '').trim().slice(0, 200) || null,
    platform: String(formData.get('platform') || 'instagram'),
    post_url: String(formData.get('post_url') || '').trim() || null,
    posted_at: String(formData.get('posted_at') || '').trim() || null,
    duration_seconds: kind === 'reel' && Number.isFinite(dur) && dur > 0 ? Math.round(dur) : null,
  });
  revalidatePath(`/operations/creative/${shootId}`);
}

export async function updateAsset(formData: FormData): Promise<void> {
  await staffEmail();
  const assetId = String(formData.get('asset_id') || '');
  const shootId = String(formData.get('shoot_id') || '');
  if (!assetId) return;
  const dur = Number(String(formData.get('duration_seconds') || '').trim());
  const patch: Record<string, unknown> = {
    title: String(formData.get('title') || '').trim().slice(0, 200) || null,
    post_url: String(formData.get('post_url') || '').trim() || null,
    posted_at: String(formData.get('posted_at') || '').trim() || null,
    duration_seconds: Number.isFinite(dur) && dur > 0 ? Math.round(dur) : null,
    updated_at: new Date().toISOString(),
  };
  // Never edit an asset whose pay is already locked in.
  await fieldDb().from('creative_assets').update(patch).eq('id', assetId).is('views_locked_at', null);
  revalidatePath(`/operations/creative/${shootId}`);
}

export async function deleteAsset(formData: FormData): Promise<void> {
  await staffEmail();
  const assetId = String(formData.get('asset_id') || '');
  const shootId = String(formData.get('shoot_id') || '');
  if (!assetId) return;
  await fieldDb().from('creative_assets').delete().eq('id', assetId).is('views_locked_at', null);
  revalidatePath(`/operations/creative/${shootId}`);
}

/** Record a views reading. `lock` freezes this asset's pay at its rung. */
export async function readAssetViews(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const assetId = String(formData.get('asset_id') || '');
  const shootId = String(formData.get('shoot_id') || '');
  const views = Number(String(formData.get('views') || '').trim());
  if (!assetId || !Number.isFinite(views) || views < 0) return;
  const v = Math.round(views);
  const lock = formData.get('lock') === 'on';
  await fieldDb().from('creative_asset_views').insert({ asset_id: assetId, views: v, read_by_email: email, source: 'manual' });
  await fieldDb()
    .from('creative_assets')
    .update({
      views: v,
      views_read_at: new Date().toISOString(),
      ...(lock ? { views_locked_at: new Date().toISOString(), views_locked_by_email: email } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', assetId)
    .is('views_locked_at', null); // never overwrite a locked reading
  revalidatePath(`/operations/creative/${shootId}`);
}

/** Flip an asset's qualification (e.g. allow a sub-minSeconds reel anyway). */
export async function setAssetQualifies(formData: FormData): Promise<void> {
  await staffEmail();
  const assetId = String(formData.get('asset_id') || '');
  const shootId = String(formData.get('shoot_id') || '');
  if (!assetId) return;
  const qualifies = formData.get('qualifies') === 'on';
  await fieldDb()
    .from('creative_assets')
    .update({
      qualifies,
      disqualified_reason: qualifies ? null : String(formData.get('reason') || 'Not counted').trim().slice(0, 200),
      updated_at: new Date().toISOString(),
    })
    .eq('id', assetId)
    .is('views_locked_at', null);
  revalidatePath(`/operations/creative/${shootId}`);
}

/**
 * Accept the delivery: FREEZE the rate card onto the shoot and set the floor.
 * Guarded like approvePacket — only from shot/delivered, and never a second
 * time (card_snapshot_at must be null), so an existing snapshot can't be
 * overwritten with a since-edited card.
 */
export async function approveShoot(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const shootId = String(formData.get('shoot_id') || '');
  if (!shootId) return;
  const detail = await loadShootDetail(shootId);
  if (!detail || !['shot', 'delivered'].includes(detail.shoot.status) || detail.shoot.card_snapshot_at != null) return;
  // Snapshot the EFFECTIVE card (per-talent override or default) as of now.
  const card = await loadEffectiveCard(detail.shoot.contractor_id);
  const floor = computeShootPay(card, detail.assets).floorCents;

  const { data: updated } = await fieldDb()
    .from('creative_shoots')
    .update({
      status: 'approved',
      card_snapshot: card,
      card_snapshot_at: new Date().toISOString(),
      posted_price_cents: floor,
      approved_at: new Date().toISOString(),
      approved_by_email: email,
      updated_at: new Date().toISOString(),
    })
    .eq('id', shootId)
    .in('status', ['shot', 'delivered'])
    .is('card_snapshot_at', null)
    .select('id')
    .maybeSingle();

  if (updated) {
    const { data: c } = await fieldDb().from('contractors').select('email, full_name, portal_token').eq('id', detail.shoot.contractor_id).maybeSingle();
    if (c) {
      // Deliberately no dollar figure: pay isn't known until views land.
      await sendApprovedEmail(c as Pick<ContractorRow, 'email' | 'full_name' | 'portal_token'>, { title: detail.shoot.title }).catch(() => {});
    }
  }
  revalidatePath(`/operations/creative/${shootId}`);
  revalidatePath('/operations/creative');
}

/**
 * Lock the payout. Defaults to the computed total from the snapshot card;
 * clamped to that computed ceiling + any bonus so a fat-finger can't pay more
 * than the card allows. Only on an approved, unpaid shoot.
 */
export async function finalizeShootPayout(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const shootId = String(formData.get('shoot_id') || '');
  if (!shootId) return;
  const detail = await loadShootDetail(shootId);
  if (!detail || detail.shoot.status !== 'approved' || detail.shoot.paid_at) return;

  const bonusCents = centsFromDollars(formData.get('bonus_dollars')) ?? 0;
  const raw = centsFromDollars(formData.get('final_dollars'));
  const card = cardFromSnapshot(detail.shoot.card_snapshot, detail.card);
  const pay = computeShootPay(card, detail.assets);
  const ceiling = pay.ceilingCents;
  const finalCents = raw == null ? pay.totalCents : Math.min(raw, ceiling);

  await fieldDb()
    .from('creative_shoots')
    .update({
      final_payout_cents: finalCents,
      final_payout_by_email: email,
      final_payout_at: new Date().toISOString(),
      bonus_cents: Math.min(bonusCents, Math.max(0, ceiling)),
      bonus_reason: bonusCents > 0 ? String(formData.get('bonus_reason') || '').trim().slice(0, 300) || null : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', shootId)
    .eq('status', 'approved')
    .is('paid_at', null);
  revalidatePath(`/operations/creative/${shootId}`);
  revalidatePath('/operations/contractors');
}

/** Mark ONE shoot paid (the per-shoot button; the roster button sweeps all). */
export async function markShootPaid(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const shootId = String(formData.get('shoot_id') || '');
  if (!shootId) return;
  const reference = String(formData.get('reference') || '').trim() || null;
  const { data } = await fieldDb()
    .from('creative_shoots')
    .update({ paid_at: new Date().toISOString(), paid_by_email: email, paid_reference: reference, status: 'settled', updated_at: new Date().toISOString() })
    .eq('id', shootId)
    .eq('status', 'approved')
    .not('final_payout_cents', 'is', null) // refuse an unlocked payout at the write
    .is('paid_at', null)
    .select('contractor_id, final_payout_cents, bonus_cents')
    .maybeSingle();
  const paid = data as { contractor_id: string; final_payout_cents: number | null; bonus_cents: number } | null;
  if (paid?.contractor_id) {
    const { data: c } = await fieldDb().from('contractors').select('*').eq('id', paid.contractor_id).maybeSingle();
    if (c) {
      const contractor = c as ContractorRow;
      await fieldDb().from('creative_shoots').update({ paid_method: contractor.payment_method ?? null }).eq('id', shootId);
      await sendPaidEmail(contractor, (paid.final_payout_cents ?? 0) + (paid.bonus_cents || 0), { method: contractor.payment_method, reference }).catch(() => {});
    }
  }
  revalidatePath(`/operations/creative/${shootId}`);
  revalidatePath('/operations/contractors');
  revalidatePath('/operations/creative');
}

export async function cancelShoot(formData: FormData): Promise<void> {
  await staffEmail();
  const shootId = String(formData.get('shoot_id') || '');
  if (!shootId) return;
  // Never cancel an approved/settled shoot out of the payout ledger.
  await fieldDb()
    .from('creative_shoots')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', shootId)
    .in('status', ['scheduled', 'shot', 'delivered']);
  revalidatePath('/operations/creative');
  redirect('/operations/creative');
}
