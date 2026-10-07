import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { supabaseAdmin as db } from '@/lib/supabase-admin';
import { CheckoutCommitmentSchema } from '@/lib/checkout-commitment';
import { insertAdjustment, todayET, type CheckoutAdjustment } from '@/lib/checkout-schedule';
import { upsertDigestDraft } from '@/lib/cleaner-digest';

export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  const parsed = CheckoutCommitmentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid confirmed checkout change' }, { status: 400 });
  const p = parsed.data;
  try {
    // The bridge carries the concierge's property slug, not a display-name match.
    const aliases: Record<string, string> = { '3_south_street': '3_south_st', '3_windward_pt': '3_windward' };
    let propertyId = aliases[p.listing_id] || p.listing_id;
    // Composer conversations carry Guesty listing IDs; approval cards carry
    // concierge slugs. Resolve only the explicit registry mapping.
    if (/^[a-f0-9]{24}$/i.test(propertyId)) {
      const mapping = await db.from('guesty_listings').select('property_id').eq('listing_id', propertyId).single();
      if (mapping.error || !mapping.data?.property_id) throw new Error('Listing mapping is unavailable');
      propertyId = mapping.data.property_id;
    }
    const prop = await db.from('properties').select('id,region').eq('id', propertyId).single();
    if (prop.error || !prop.data) throw new Error('Property could not be verified');
    const prior = await db.from('checkout_adjustments').select('*').eq('miner_key', p.event_key).maybeSingle();
    if (prior.error) throw prior.error;
    let adjustment = prior.data as CheckoutAdjustment | null;
    if (!adjustment) {
      const standing = await db.from('checkout_adjustments').select('*').eq('property_id', propertyId)
        .eq('stay_check_in', p.check_in).eq('status', 'active').maybeSingle();
      if (standing.error) throw standing.error;
      // An old retry must never replace a later schedule decision. Conflicts
      // and changed dates remain proposals; an extension needs calendar proof.
      const newer = standing.data && Date.parse(standing.data.created_at) > Date.parse(p.sent_at);
      await insertAdjustment(db, {
        propertyId, stayCheckIn: p.check_in, originalCheckOut: p.check_out,
        adjustedCheckOut: p.date || standing.data?.adjusted_check_out || null,
        adjustedCheckoutTime: p.time || standing.data?.adjusted_checkout_time || null,
        source: 'miner', minerKey: p.event_key, evidence: p.evidence,
        note: 'Confirmed in a delivered guest message', createdBy: 'checkout-message',
        confidence: newer || !!p.date ? 'low' : p.confidence,
      });
      const saved = await db.from('checkout_adjustments').select('*').eq('miner_key', p.event_key).single();
      if (saved.error || !saved.data) throw new Error('Checkout adjustment was not saved');
      adjustment = saved.data as CheckoutAdjustment;
    }
    const serviceDate = adjustment.adjusted_check_out || adjustment.original_check_out;
    let digestStatus = '';
    if (adjustment.status === 'active' && serviceDate >= todayET()) {
      // Never silently revive an operator-skipped digest, nor overwrite a
      // sent message. The existing Send update action builds the correction.
      const existing = await db.from('cleaner_schedule_digests').select('id,status')
        .eq('service_date', serviceDate).eq('region', prop.data.region || 'cape_ann').maybeSingle();
      if (existing.error) throw existing.error;
      digestStatus = existing.data?.status || '';
      if (!existing.data || digestStatus === 'pending') {
        const { digest } = await upsertDigestDraft(db, serviceDate, prop.data.region || 'cape_ann');
        if (!digest?.id) throw new Error('Cleaner schedule draft was not saved');
        digestStatus = digest.status;
      }
      if (digestStatus === 'sending') throw new Error('Cleaner schedule is sending; recheck after delivery');
    }
    return NextResponse.json({ ok: true, status: adjustment.status, date: serviceDate, digest_status: digestStatus });
  } catch {
    return NextResponse.json({ error: 'Cleaner schedule update not confirmed; retry with the same event key' }, { status: 503 });
  }
}
