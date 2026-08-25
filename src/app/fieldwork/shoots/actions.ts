'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { fieldDb } from '@/lib/field-db';
import type { RateCard } from '@/lib/creative-rates';
import { loadShootDetail, shootPaySummary } from '@/lib/creative-shoots';
import { syncCreativeDrive } from '@/lib/creative-drive';
import { sendPaidEmail, sendShootBrief } from '@/lib/field-notify';
import type { ContractorRow } from '@/lib/field-types';

async function staffEmail(): Promise<string> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');
  return session.user.email;
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
  // Logging an UPCOMING shoot BRIEFS the contributor: email + text with the
  // portal brief link (address, arrival, entry, the listing to study).
  // Logging after the fact (a past date — the ledger's usual flow) sends
  // nothing: there is no day left to brief. Failures never block the log —
  // the shoot page has a Send-brief control.
  const todayEt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  if (id && shootDate >= todayEt) {
    await notifyShootBrief(id, contractorId, title, shootDate, propertyId).catch(() => {});
  }
  revalidatePath('/fieldwork/shoots');
  if (id) redirect(`/fieldwork/shoots/${id}`);
}

async function notifyShootBrief(
  shootId: string,
  contractorId: string,
  title: string,
  shootDate: string,
  propertyId: string | null,
): Promise<{ emailed: boolean; texted: boolean }> {
  const [{ data: c }, propertyName] = await Promise.all([
    fieldDb().from('contractors').select('full_name, email, phone, portal_token').eq('id', contractorId).maybeSingle(),
    propertyId
      ? fieldDb().from('properties').select('name').eq('id', propertyId).maybeSingle().then((r) => (r.data as { name: string } | null)?.name ?? null)
      : Promise.resolve(null),
  ]);
  const contractor = c as Pick<ContractorRow, 'full_name' | 'email' | 'phone' | 'portal_token'> | null;
  if (!contractor) return { emailed: false, texted: false };
  return sendShootBrief(contractor, { id: shootId, title, shoot_date: shootDate }, propertyName);
}

/** Re-send the shoot brief (email + text) from the office shoot page. The
 *  landing note tells the truth about what actually went out. */
export async function resendShootBrief(formData: FormData): Promise<void> {
  await staffEmail();
  const shootId = String(formData.get('shoot_id') || '');
  if (!shootId) return;
  const { data: s } = await fieldDb()
    .from('creative_shoots')
    .select('id, title, shoot_date, property_id, contractor_id, status')
    .eq('id', shootId)
    .maybeSingle();
  const shoot = s as { id: string; title: string; shoot_date: string; property_id: string | null; contractor_id: string; status: string } | null;
  if (!shoot || shoot.status === 'cancelled') return;
  const sent = await notifyShootBrief(shoot.id, shoot.contractor_id, shoot.title, shoot.shoot_date, shoot.property_id).catch(() => ({ emailed: false, texted: false }));
  const note =
    sent.emailed && sent.texted
      ? 'ok:brief sent — email and text'
      : sent.emailed
        ? 'ok:brief emailed (no text went out)'
        : sent.texted
          ? 'ok:brief texted (no email went out)'
          : 'err:brief did NOT send — nothing went out (check their contact info)';
  revalidatePath(`/fieldwork/shoots/${shootId}`);
  redirect(`/fieldwork/shoots/${shootId}?brief=${encodeURIComponent(note)}`);
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
  revalidatePath(`/fieldwork/shoots/${shootId}`);
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
  revalidatePath(`/fieldwork/shoots/${shootId}`);
}

export async function deleteAsset(formData: FormData): Promise<void> {
  await staffEmail();
  const assetId = String(formData.get('asset_id') || '');
  const shootId = String(formData.get('shoot_id') || '');
  if (!assetId) return;
  await fieldDb().from('creative_assets').delete().eq('id', assetId).is('views_locked_at', null);
  revalidatePath(`/fieldwork/shoots/${shootId}`);
}

/** Record a views reading. `lock` freezes this asset's pay at its rung. */
export async function readAssetViews(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const assetId = String(formData.get('asset_id') || '');
  const shootId = String(formData.get('shoot_id') || '');
  // The field accepts the comma form the rest of the page shows ("28,100").
  const views = Number(String(formData.get('views') || '').replace(/[,\s]/g, ''));
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
  revalidatePath(`/fieldwork/shoots/${shootId}`);
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
  revalidatePath(`/fieldwork/shoots/${shootId}`);
}

// Freeze the shoot's rate card at the FIRST base payment, so every post on the
// shoot prices against the same card even if the standard card is edited later.
async function freezeCardIfNeeded(shoot: { id: string; card_snapshot: unknown }, card: RateCard): Promise<void> {
  if (shoot.card_snapshot) return;
  await fieldDb()
    .from('creative_shoots')
    .update({ card_snapshot: card, card_snapshot_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', shoot.id)
    .is('card_snapshot_at', null);
}

// After any per-post payment, flip the shoot to 'settled' once every counting
// post is fully paid (base + any reel bonus), or back to 'shot' if not. The
// shoot's paid_at is the "fully settled" marker the board + history read.
async function refreshShootSettlement(shootId: string): Promise<void> {
  const detail = await loadShootDetail(shootId);
  if (!detail || detail.shoot.status === 'cancelled') return;
  const sum = shootPaySummary(detail.assets, detail.pay, detail.shoot);
  const status = sum.fullySettled ? 'settled' : 'shot';
  if (detail.shoot.status !== status || !!detail.shoot.paid_at !== sum.fullySettled) {
    await fieldDb()
      .from('creative_shoots')
      .update({ status, paid_at: sum.fullySettled ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
      .eq('id', shootId)
      .neq('status', 'cancelled');
  }
}

/**
 * Pay a single POST's base — the reel base or the flat carousel rate — the day
 * it goes live. Idempotent (guarded on base_paid_at IS NULL). Freezes the
 * shoot's card on the first base paid, so later posts price against the same card.
 */
export async function payAssetBase(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const shootId = String(formData.get('shoot_id') || '');
  const assetId = String(formData.get('asset_id') || '');
  if (!shootId || !assetId) return;
  const reference = String(formData.get('reference') || '').trim() || null;
  const detail = await loadShootDetail(shootId);
  if (!detail) return;
  const asset = detail.assets.find((a) => a.id === assetId);
  const ap = detail.pay.assets.find((p) => p.assetId === assetId);
  // Base is owed on DELIVERY (the asset is logged), not on posting — posting can
  // come weeks later, or never. Only a counting, unpaid post can take a base.
  if (!asset || !ap || !ap.counts || asset.base_paid_at) {
    revalidatePath(`/fieldwork/shoots/${shootId}`); // refresh, never a dead click
    return;
  }
  // Belt-and-suspenders on the cap: never pay a reel base once maxPerShoot reels
  // already have their base paid AND still count (the ranking pins them, but
  // guard the write too). A paid reel that was later un-counted ("Don't count
  // this" on a wrong-version upload) holds no slot — counting it here while the
  // pay math excluded it made this button a silent dead click.
  if (asset.kind === 'reel') {
    const countsById = new Map(detail.pay.assets.map((p) => [p.assetId, p.counts]));
    const paidReels = detail.assets.filter((x) => x.kind === 'reel' && x.base_paid_at && countsById.get(x.id)).length;
    if (paidReels >= detail.card.maxPerShoot) {
      revalidatePath(`/fieldwork/shoots/${shootId}`);
      return;
    }
  }

  await freezeCardIfNeeded(detail.shoot, detail.card);
  const base = ap.baseCents;
  const { data: c } = await fieldDb().from('contractors').select('*').eq('id', detail.shoot.contractor_id).maybeSingle();
  const contractor = c as ContractorRow | null;

  const { data: updated } = await fieldDb()
    .from('creative_assets')
    .update({
      base_cents: base,
      base_paid_at: new Date().toISOString(),
      base_by_email: email,
      base_method: contractor?.payment_method ?? null,
      base_reference: reference,
      updated_at: new Date().toISOString(),
    })
    .eq('id', assetId)
    .is('base_paid_at', null) // idempotent — no double-pay on a double click
    .select('id')
    .maybeSingle();

  if (updated && contractor) {
    const note =
      asset.kind === 'reel'
        ? 'This is your base for delivering the reel. Once we post it, a view bonus follows about two weeks after that.'
        : 'This is the full pay for delivering your carousel.';
    await sendPaidEmail(contractor, base, { method: contractor.payment_method, reference, creative: true, note }).catch(() => {});
  }
  await refreshShootSettlement(shootId);
  revalidatePath(`/fieldwork/shoots/${shootId}`);
  revalidatePath('/fieldwork/shoots');
  revalidatePath('/fieldwork/roster');
}

/**
 * Pay the base on EVERY delivered, counting, unpaid post at once — the
 * "$100 per asset on delivery" lump ($300 for two reels + a carousel). Per-post
 * records are still written; this is just the one-click convenience.
 */
export async function payAllDeliveredBases(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const shootId = String(formData.get('shoot_id') || '');
  if (!shootId) return;
  const reference = String(formData.get('reference') || '').trim() || null;
  const detail = await loadShootDetail(shootId);
  if (!detail) return;
  await freezeCardIfNeeded(detail.shoot, detail.card);
  const { data: c } = await fieldDb().from('contractors').select('*').eq('id', detail.shoot.contractor_id).maybeSingle();
  const contractor = c as ContractorRow | null;
  const now = new Date().toISOString();
  let paid = 0;
  // Same cap semantics as payAssetBase: only paid reels that still COUNT hold
  // a slot (a paid-then-un-counted wrong version doesn't block the real one).
  const countsById = new Map(detail.pay.assets.map((p) => [p.assetId, p.counts]));
  let paidReels = detail.assets.filter((x) => x.kind === 'reel' && x.base_paid_at && countsById.get(x.id)).length;
  for (const a of detail.assets) {
    const ap = detail.pay.assets.find((p) => p.assetId === a.id);
    if (!ap || !ap.counts || a.base_paid_at) continue; // ap.counts already applies the reel cap
    if (a.kind === 'reel' && paidReels >= detail.card.maxPerShoot) continue;
    const { data: u } = await fieldDb()
      .from('creative_assets')
      .update({ base_cents: ap.baseCents, base_paid_at: now, base_by_email: email, base_method: contractor?.payment_method ?? null, base_reference: reference, updated_at: now })
      .eq('id', a.id)
      .is('base_paid_at', null)
      .select('id')
      .maybeSingle();
    if (u) {
      paid += ap.baseCents;
      if (a.kind === 'reel') paidReels++;
    }
  }
  if (paid > 0 && contractor) {
    await sendPaidEmail(contractor, paid, {
      method: contractor.payment_method,
      reference,
      creative: true,
      note: 'This is your base for the assets you delivered. View bonuses on the reels follow after we post them.',
    }).catch(() => {});
  }
  await refreshShootSettlement(shootId);
  revalidatePath(`/fieldwork/shoots/${shootId}`);
  revalidatePath('/fieldwork/shoots');
  revalidatePath('/fieldwork/roster');
}

/**
 * Mark a delivered post as POSTED — records the go-live date (and URL). This is
 * what starts a reel's view-bonus clock; posting can be weeks after delivery, or
 * never. Locked once the views lock.
 */
export async function markAssetPosted(formData: FormData): Promise<void> {
  await staffEmail();
  const shootId = String(formData.get('shoot_id') || '');
  const assetId = String(formData.get('asset_id') || '');
  const postedAt = String(formData.get('posted_at') || '').trim();
  if (!shootId || !assetId || !postedAt) return;
  const patch: Record<string, unknown> = { posted_at: postedAt, updated_at: new Date().toISOString() };
  const url = String(formData.get('post_url') || '').trim();
  if (url) patch.post_url = url;
  await fieldDb().from('creative_assets').update(patch).eq('id', assetId).is('views_locked_at', null);
  await refreshShootSettlement(shootId);
  revalidatePath(`/fieldwork/shoots/${shootId}`);
  revalidatePath('/fieldwork/shoots');
}

/**
 * Pay a reel's VIEW BONUS — the tier total beyond the base — once its count has
 * locked. Reels only; nothing to pay if the views never beat the base rung.
 */
export async function payAssetTopup(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const shootId = String(formData.get('shoot_id') || '');
  const assetId = String(formData.get('asset_id') || '');
  if (!shootId || !assetId) return;
  const reference = String(formData.get('reference') || '').trim() || null;
  const detail = await loadShootDetail(shootId);
  if (!detail) return;
  const asset = detail.assets.find((a) => a.id === assetId);
  const ap = detail.pay.assets.find((p) => p.assetId === assetId);
  // ap.locked covers both rails: views read + locked, OR an office-decided
  // bonus override (which pins the number without a views read).
  if (!asset || !ap || asset.kind !== 'reel' || !asset.base_paid_at || !ap.locked || asset.topup_paid_at) return;
  const topup = ap.topupCents;
  if (topup <= 0) return; // views never beat the base rung — no bonus owed

  const { data: c } = await fieldDb().from('contractors').select('*').eq('id', detail.shoot.contractor_id).maybeSingle();
  const contractor = c as ContractorRow | null;

  const { data: updated } = await fieldDb()
    .from('creative_assets')
    .update({
      topup_cents: topup,
      topup_paid_at: new Date().toISOString(),
      topup_by_email: email,
      topup_method: contractor?.payment_method ?? null,
      topup_reference: reference,
      updated_at: new Date().toISOString(),
    })
    .eq('id', assetId)
    .not('base_paid_at', 'is', null)
    .or('views_locked_at.not.is.null,topup_override_cents.not.is.null')
    .is('topup_paid_at', null) // idempotent
    .select('id')
    .maybeSingle();

  if (updated && contractor) {
    await sendPaidEmail(contractor, topup, {
      method: contractor.payment_method,
      reference,
      creative: true,
      note: 'This is the view bonus for your reel, on top of the base you were already paid.',
    }).catch(() => {});
  }
  await refreshShootSettlement(shootId);
  revalidatePath(`/fieldwork/shoots/${shootId}`);
  revalidatePath('/fieldwork/shoots');
  revalidatePath('/fieldwork/roster');
}

/**
 * Office edit on a reel's view bonus: pin it at a decided dollar amount
 * (stops the climb, moves it to payable) or clear it back to live counting.
 * Refused once the bonus is paid — receipts are immutable. Flows to every
 * surface (board, shoot header, roster, Cooper's portal) through
 * computeShootPay, so nothing can drift.
 */
export async function setAssetTopupOverride(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const shootId = String(formData.get('shoot_id') || '');
  const assetId = String(formData.get('asset_id') || '');
  if (!shootId || !assetId) return;
  const clearing = String(formData.get('clear') || '') === '1';
  const raw = String(formData.get('dollars') ?? '').trim();

  let cents: number | null = null;
  if (!clearing) {
    const d = Number(raw);
    if (!Number.isFinite(d) || d < 0) return;
    // Fat-finger guard, same philosophy as the packet clamps: a reel bonus
    // lives in card-tier territory, never five figures.
    cents = Math.min(Math.round(d * 100), 500_000);
  }

  const detail = await loadShootDetail(shootId);
  if (!detail) return;
  const asset = detail.assets.find((a) => a.id === assetId);
  if (!asset || asset.kind !== 'reel' || asset.topup_paid_at) return;

  await fieldDb()
    .from('creative_assets')
    .update({
      topup_override_cents: cents,
      topup_override_by_email: cents == null ? null : email,
      topup_override_at: cents == null ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', assetId)
    .is('topup_paid_at', null); // a paid bonus is a receipt — never rewrite it

  await refreshShootSettlement(shootId);
  revalidatePath(`/fieldwork/shoots/${shootId}`);
  revalidatePath('/fieldwork/shoots');
  revalidatePath('/fieldwork/roster');
}

/**
 * Office edit on the shoot's PAID TO DATE. The operator types the correct
 * total; we store the DELTA against the per-post receipts, so later real
 * payments still add on top. by/at/note are the audit trail. Saving the
 * receipts total itself (or "back to receipts") clears the adjustment.
 * No receipt email — this is bookkeeping, not a payment event.
 */
export async function setShootPaidAdjustment(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const shootId = String(formData.get('shoot_id') || '');
  if (!shootId) return;
  const clearing = String(formData.get('clear') || '') === '1';
  const detail = await loadShootDetail(shootId);
  if (!detail || detail.shoot.status === 'cancelled') return;
  const sum = shootPaySummary(detail.assets, detail.pay, detail.shoot);

  let adjustment = 0;
  let note: string | null = null;
  if (!clearing) {
    // Accept the dollar forms the page shows ("$400", "412.50", "1,200").
    const d = Number(String(formData.get('dollars') ?? '').trim().replace(/[$,\s]/g, ''));
    if (!Number.isFinite(d) || d < 0) return;
    // Fat-finger guard, same philosophy as the bonus override: a shoot's paid
    // total lives in rate-card territory, never five figures.
    const target = Math.min(Math.round(d * 100), 2_000_000);
    adjustment = target - sum.receiptsPaidCents;
    note = String(formData.get('note') || '').trim().slice(0, 300) || null;
  }

  await fieldDb()
    .from('creative_shoots')
    .update({
      paid_adjustment_cents: adjustment,
      paid_adjustment_note: adjustment === 0 ? null : note,
      paid_adjustment_by_email: adjustment === 0 ? null : email,
      paid_adjustment_at: adjustment === 0 ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', shootId)
    .neq('status', 'cancelled');

  revalidatePath(`/fieldwork/shoots/${shootId}`);
  revalidatePath('/fieldwork/shoots');
  revalidatePath('/fieldwork/roster');
}

/**
 * Scan the contributors' Drive folders now (same sync the 2-hour cron runs)
 * and land back where the click came from with a one-line result. New files
 * become logged assets, so their delivery base goes due immediately.
 */
export async function syncDriveNow(formData: FormData): Promise<void> {
  await staffEmail();
  const returnTo = String(formData.get('return_to') || '/fieldwork/shoots');
  const safe = returnTo.startsWith('/fieldwork/shoots') ? returnTo : '/fieldwork/shoots';
  let note: string;
  try {
    const r = await syncCreativeDrive();
    if (r.ok || r.newFiles > 0) {
      // Parked = raw footage sitting in a DRONE box: dropped from the delivery
      // list, so say so rather than letting rows vanish without a word.
      const parked = r.shoots.reduce((n, s) => n + s.parkedFiles, 0);
      const bits = [
        r.newFiles > 0 ? `${r.newFiles} new file${r.newFiles === 1 ? '' : 's'}` : 'no new files',
        parked > 0 ? `${parked} raw file${parked === 1 ? '' : 's'} parked in the drone box` : null,
        r.assetsCreated > 0 ? `${r.assetsCreated} asset${r.assetsCreated === 1 ? '' : 's'} logged` : null,
        r.errors.length > 0 ? `${r.errors.length} folder issue${r.errors.length === 1 ? '' : 's'}` : null,
      ].filter(Boolean);
      note = `ok:${bits.join(', ')}`;
    } else {
      note = `err:${(r.errors[0] ?? 'Drive sync failed').slice(0, 160)}`;
    }
  } catch (err) {
    note = `err:${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`;
  }
  revalidatePath('/fieldwork/shoots');
  revalidatePath(safe);
  redirect(`${safe}?drive=${encodeURIComponent(note)}`);
}

/** Pin (or clear) a shoot's Drive folder by pasted link or id — the manual
 *  override for folders the name-matcher can't resolve. */
export async function setShootDriveFolder(formData: FormData): Promise<void> {
  await staffEmail();
  const shootId = String(formData.get('shoot_id') || '');
  if (!shootId) return;
  const raw = String(formData.get('folder') || '').trim();
  let folderId: string | null = null;
  if (raw) {
    const m = raw.match(/folders\/([A-Za-z0-9_-]{10,})/) ?? raw.match(/^([A-Za-z0-9_-]{10,})$/);
    if (!m) {
      redirect(`/fieldwork/shoots/${shootId}?drive=${encodeURIComponent('err:that does not look like a Drive folder link')}`);
    }
    folderId = m![1];
  }
  await fieldDb()
    .from('creative_shoots')
    .update({ drive_folder_id: folderId, updated_at: new Date().toISOString() })
    .eq('id', shootId);
  revalidatePath(`/fieldwork/shoots/${shootId}`);
  redirect(`/fieldwork/shoots/${shootId}?drive=${encodeURIComponent(folderId ? 'ok:folder linked - sync to pull its files' : 'ok:folder cleared')}`);
}

export async function cancelShoot(formData: FormData): Promise<void> {
  await staffEmail();
  const shootId = String(formData.get('shoot_id') || '');
  if (!shootId) return;
  // Never cancel a shoot whose posts have already been paid out of the ledger.
  const { data: paidAsset } = await fieldDb()
    .from('creative_assets')
    .select('id')
    .eq('shoot_id', shootId)
    .or('base_paid_at.not.is.null,topup_paid_at.not.is.null')
    .limit(1)
    .maybeSingle();
  if (paidAsset) return;
  await fieldDb()
    .from('creative_shoots')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', shootId)
    .in('status', ['scheduled', 'shot', 'delivered']);
  revalidatePath('/fieldwork/shoots');
  redirect('/fieldwork/shoots');
}
