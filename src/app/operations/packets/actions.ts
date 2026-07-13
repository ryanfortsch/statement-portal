'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { fieldDb } from '@/lib/field-db';
import { newPortalToken } from '@/lib/field-auth';
import { suggestPackets, persistSuggestions, revalidatePacket, createPacketFromProperties, createMaintenancePacket, createSetupPacket, autoAttachInventorySlips } from '@/lib/field-packets';
import { revokePacketCodes, programPacketCodes } from '@/lib/field-locks';
import { revealTin } from '@/lib/field-w9';
import { revealPayment } from '@/lib/field-pay';
import { sendInviteEmail, notifyContractorsOfPacket, sendPaidEmail, sendChangesRequestedEmail, sendClaimConfirmation, sendApprovedEmail, sendReassignedEmail, sendEstimateRaisedEmail } from '@/lib/field-notify';
import { sendInspectionReportEmail } from '@/lib/inspection-report-email';
import { canClaim, parseTrade, effectiveBaseCents, type PacketRow } from '@/lib/field-types';
import { isAssignableStatus, isPayoutAdjustableStatus } from '@/lib/field-packet-status';
import type { ContractorRow } from '@/lib/field-types';

async function staffEmail(): Promise<string> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');
  return session.user.email;
}

// ── Attach work slips + instructions to a packet stop ──────────────────
// Hand the assigned inspector extra tasks per property: open work slips (with a
// per-slip note) plus free-form per-stop / per-packet instructions. Allowed
// anytime the packet is still live (incl. after a contractor claims it) — the
// attachment just shows up on their packet on next load. Unpriced, so no payout
// or stop-count effect.

export async function attachSlipToStop(packetId: string, stopId: string, workSlipId: string): Promise<{ ok: boolean }> {
  const email = await staffEmail();
  const { error } = await fieldDb()
    .from('packet_stop_work_slips')
    .upsert({ stop_id: stopId, work_slip_id: workSlipId, created_by_email: email }, { onConflict: 'stop_id,work_slip_id', ignoreDuplicates: true });
  revalidatePath(`/operations/packets/${packetId}`);
  return { ok: !error };
}

export async function detachSlipFromStop(packetId: string, attachmentId: string): Promise<{ ok: boolean }> {
  await staffEmail();
  const { error } = await fieldDb().from('packet_stop_work_slips').delete().eq('id', attachmentId);
  revalidatePath(`/operations/packets/${packetId}`);
  return { ok: !error };
}

export async function updateStopSlipNote(packetId: string, attachmentId: string, note: string): Promise<{ ok: boolean }> {
  await staffEmail();
  const { error } = await fieldDb()
    .from('packet_stop_work_slips')
    .update({ office_note: note.trim().slice(0, 2000) || null })
    .eq('id', attachmentId);
  revalidatePath(`/operations/packets/${packetId}`);
  return { ok: !error };
}

export async function setStopInstructions(packetId: string, stopId: string, text: string): Promise<{ ok: boolean }> {
  await staffEmail();
  const { error } = await fieldDb()
    .from('packet_stops')
    .update({ instructions: text.trim().slice(0, 4000) || null })
    .eq('id', stopId);
  revalidatePath(`/operations/packets/${packetId}`);
  return { ok: !error };
}

export async function setPacketInstructions(packetId: string, text: string): Promise<{ ok: boolean }> {
  await staffEmail();
  const { error } = await fieldDb()
    .from('inspection_packets')
    .update({ instructions: text.trim().slice(0, 4000) || null })
    .eq('id', packetId);
  revalidatePath(`/operations/packets/${packetId}`);
  return { ok: !error };
}

/** Office-only: decrypt a contractor's full TIN for filing their 1099. */
export async function revealW9(contractorId: string): Promise<string | null> {
  const email = await staffEmail(); // staff session required
  const tin = await revealTin(contractorId);
  // Audit every SSN/EIN reveal: who looked at whose TIN, when.
  await fieldDb()
    .from('packet_events')
    .insert({ contractor_id: contractorId, actor_email: email, event_type: 'w9_revealed' })
    .then(
      () => {},
      () => {},
    );
  return tin;
}

/** Directly assign (or reassign) a packet to a specific contractor — bypasses
 *  the first-come claim race. Only published/claimed packets (not work already
 *  in progress). Pulls the prior contractor's codes on a reassign, programs the
 *  new one's, and confirms with the new contractor. */
export async function assignPacket(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const packetId = String(formData.get('packet_id') || '');
  const contractorId = String(formData.get('contractor_id') || '');
  if (!packetId || !contractorId) return;

  const { data: pkt } = await fieldDb()
    .from('inspection_packets')
    .select('id, status, trade, awarded_contractor_id')
    .eq('id', packetId)
    .maybeSingle();
  const packet = pkt as { id: string; status: string; trade: string; awarded_contractor_id: string | null } | null;
  if (!packet || !isAssignableStatus(packet.status)) return;
  if (packet.awarded_contractor_id === contractorId) return; // no-op

  const { data: c } = await fieldDb().from('contractors').select('*').eq('id', contractorId).maybeSingle();
  const contractor = (c as ContractorRow | null) ?? null;
  if (!contractor || !canClaim(contractor) || contractor.trade !== packet.trade) return;

  // Reassigning away from someone — pull their live codes + let them know.
  if (packet.awarded_contractor_id) {
    await revokePacketCodes(packetId).catch(() => {});
    const { data: prev } = await fieldDb().from('contractors').select('email, full_name, portal_token').eq('id', packet.awarded_contractor_id).maybeSingle();
    const { data: pk } = await fieldDb().from('inspection_packets').select('title').eq('id', packetId).maybeSingle();
    if (prev && pk) await sendReassignedEmail(prev as ContractorRow, pk as { title: string }).catch(() => {});
  }

  await fieldDb()
    .from('inspection_packets')
    .update({ status: 'claimed', awarded_contractor_id: contractorId, claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', packetId);
  await fieldDb()
    .from('packet_events')
    .insert({ packet_id: packetId, contractor_id: contractorId, actor_email: email, event_type: 'assigned' });
  await programPacketCodes(packetId).catch(() => {});

  const { data: full } = await fieldDb().from('inspection_packets').select('*').eq('id', packetId).maybeSingle();
  if (full) await sendClaimConfirmation(contractor, full as PacketRow).catch(() => {});

  revalidatePath(`/operations/packets/${packetId}`);
  revalidatePath('/operations/packets');
}

/** Move a draft/published packet to a different visit date. */
export async function setPacketVisitDate(formData: FormData): Promise<void> {
  await staffEmail();
  const packetId = String(formData.get('packet_id') || '');
  const visitDate = String(formData.get('visit_date') || '');
  // Optional start time; an empty field clears it back to "anytime that day".
  const visitTime = String(formData.get('visit_time') || '');
  if (!packetId || !visitDate) return;
  await fieldDb()
    .from('inspection_packets')
    .update({ visit_date: visitDate, visit_time: visitTime || null, window_start: visitDate, window_end: visitDate, claim_deadline: visitDate, updated_at: new Date().toISOString() })
    .eq('id', packetId)
    .in('status', ['draft', 'published']);
  revalidatePath(`/operations/packets/${packetId}`);
  revalidatePath('/operations/packets');
}


/** Set (or clear) the packet's hard completion deadline (time-of-day, ET on the
 *  visit day). Unlike the start time, this is settable AFTER claim: a deadline
 *  is exactly what the office adjusts once someone's on the hook. An empty or
 *  malformed value clears it. Shown to the inspector; feeds the at-risk flag. */
export async function setPacketCompleteBy(formData: FormData): Promise<void> {
  await staffEmail();
  const packetId = String(formData.get('packet_id') || '');
  if (!packetId) return;
  const raw = String(formData.get('complete_by') || '').trim();
  const completeBy = /^\d{2}:\d{2}$/.test(raw) ? raw : null; // <input type=time> gives HH:MM; anything else clears
  await fieldDb()
    .from('inspection_packets')
    .update({ complete_by: completeBy, updated_at: new Date().toISOString() })
    .eq('id', packetId)
    .in('status', ['draft', 'published', 'claimed', 'in_progress']);
  revalidatePath(`/operations/packets/${packetId}`);
  revalidatePath('/operations/packets');
}

/** Create (and optionally publish) a property-SETUP packet: staging a new home
 *  for photos + outfitting it for operations. Publishing texts the inspection
 *  contractors like any other packet. */
export async function createSetupPacketAction(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const propertyId = String(formData.get('property_id') || '');
  const visitDate = String(formData.get('visit_date') || '');
  const visitTime = String(formData.get('visit_time') || '');
  const priceDollars = Number(formData.get('price_dollars') || 0);
  const scope = String(formData.get('scope') || '');
  const publish = String(formData.get('mode') || 'publish') !== 'draft';
  const supplyRun = formData.get('supply_run') === 'on';
  if (!propertyId || !visitDate) return;

  const packetId = await createSetupPacket({
    propertyId,
    visitDate,
    visitTime: visitTime || undefined,
    priceCentsOverride: priceDollars > 0 ? Math.round(priceDollars * 100) : undefined,
    scope,
    supplyRun,
    createdByEmail: email,
    publish,
  });
  if (!packetId) return;
  if (publish) {
    await fieldDb().from('packet_events').insert({ packet_id: packetId, actor_email: email, event_type: 'published' });
    notifyContractorsOfPacket(packetId).catch(() => {});
  }
  revalidatePath('/operations/packets');
  redirect(`/operations/packets/${packetId}`);
}

/** Office-only: decrypt a contractor's full payout details (e.g. ACH account). */
export async function revealPay(contractorId: string): Promise<string | null> {
  await staffEmail();
  return revealPayment(contractorId);
}

/** Run the grouping algorithm over a date window and persist new draft packets. */
export async function runSuggest(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const windowStart = String(formData.get('window_start') || '') || undefined;
  const windowEnd = String(formData.get('window_end') || '') || undefined;
  const suggestions = await suggestPackets(windowStart, windowEnd);
  await persistSuggestions(suggestions, email);
  revalidatePath('/operations/packets');
}

/** Work-first board: bundle the operator's hand-picked inspections for a day
 *  into one packet and publish it to contractors in a single step. */
export async function bundleAndSend(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const visitDate = String(formData.get('visit_date') || '');
  const ids = String(formData.get('property_ids') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const priceDollars = Number(formData.get('price_dollars') || 0);
  if (!visitDate || ids.length === 0) redirect('/operations/packets?sent=0');
  const packetId = await createPacketFromProperties({
    propertyIds: ids,
    visitDate,
    priceCentsOverride: priceDollars > 0 ? Math.round(priceDollars * 100) : undefined,
    createdByEmail: email,
    publish: true,
  });
  if (packetId) {
    await fieldDb().from('packet_events').insert({ packet_id: packetId, actor_email: email, event_type: 'published' });
    notifyContractorsOfPacket(packetId).catch(() => {});
    revalidatePath('/operations/packets');
    redirect('/operations/packets?sent=1');
  }
  // Nothing got bundled — every picked day is now covered/occupied. Tell the
  // operator instead of silently doing nothing.
  revalidatePath('/operations/packets');
  redirect('/operations/packets?sent=0');
}

/** Bundle selected open maintenance work slips into a published maintenance
 *  packet and text the maintenance contractors. */
export async function bundleMaintenanceAndSend(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const visitDate = String(formData.get('visit_date') || '');
  const slipIds = String(formData.get('work_slip_ids') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const priceDollars = Number(formData.get('price_dollars') || 0);
  if (!visitDate || slipIds.length === 0) redirect('/operations/packets/maintenance?sent=0');
  const packetId = await createMaintenancePacket({
    workSlipIds: slipIds,
    visitDate,
    priceCentsOverride: priceDollars > 0 ? Math.round(priceDollars * 100) : undefined,
    createdByEmail: email,
    publish: true,
  });
  revalidatePath('/operations/packets');
  revalidatePath('/operations/packets/maintenance');
  if (packetId) {
    await fieldDb().from('packet_events').insert({ packet_id: packetId, actor_email: email, event_type: 'published' });
    notifyContractorsOfPacket(packetId).catch(() => {});
    redirect('/operations/packets?sent=1');
  }
  redirect('/operations/packets/maintenance?sent=0');
}

export async function setPacketPrice(formData: FormData): Promise<void> {
  await staffEmail();
  const packetId = String(formData.get('packet_id') || '');
  const dollarsValue = Number(formData.get('price_dollars') || 0);
  if (!packetId || !Number.isFinite(dollarsValue) || dollarsValue < 0) return;
  // Price is only editable while the packet is a draft — once it's published
  // or claimed the pay is locked, so a contractor's agreed price can't move
  // out from under them.
  await fieldDb()
    .from('inspection_packets')
    .update({ posted_price_cents: Math.round(dollarsValue * 100), updated_at: new Date().toISOString() })
    .eq('id', packetId)
    .eq('status', 'draft');
  revalidatePath(`/operations/packets/${packetId}`);
  revalidatePath('/operations/packets');
}

/** Raise the agreed estimate on a CLAIMED / in-progress packet. Raise-only on
 *  purpose: bumping pay is always safe for the contractor, but lowering an
 *  agreed price out from under someone isn't (that still needs a release). The
 *  contractor is re-notified of the new number. Once the packet is submitted,
 *  the final-payout flow owns the dollars instead. */
export async function raisePacketEstimate(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const packetId = String(formData.get('packet_id') || '');
  const dollarsValue = Number(formData.get('price_dollars') || 0);
  const reason = String(formData.get('reason') || '').trim().slice(0, 500) || null;
  if (!packetId || !Number.isFinite(dollarsValue) || dollarsValue <= 0) return;
  const newCents = Math.round(dollarsValue * 100);

  const { data: pk } = await fieldDb()
    .from('inspection_packets')
    .select('posted_price_cents, status, awarded_contractor_id')
    .eq('id', packetId)
    .maybeSingle();
  const packet = pk as { posted_price_cents: number; status: string; awarded_contractor_id: string | null } | null;
  if (!packet || !['claimed', 'in_progress'].includes(packet.status) || newCents <= packet.posted_price_cents) return;
  const oldCents = packet.posted_price_cents;

  // Re-guard status AND raise-only on the write, so a race can't lower the price
  // or move it on a packet that just got submitted/released.
  const { data: changed } = await fieldDb()
    .from('inspection_packets')
    .update({ posted_price_cents: newCents, updated_at: new Date().toISOString() })
    .eq('id', packetId)
    .in('status', ['claimed', 'in_progress'])
    .lt('posted_price_cents', newCents)
    .select('id, title, posted_price_cents')
    .maybeSingle();
  if (!changed) {
    revalidatePath(`/operations/packets/${packetId}`);
    return;
  }

  await fieldDb().from('packet_events').insert({
    packet_id: packetId,
    contractor_id: packet.awarded_contractor_id,
    actor_email: email,
    event_type: 'estimate_raised',
    payload: { from_cents: oldCents, to_cents: newCents, reason },
  });

  // Tell the contractor their agreed pay went up (best-effort).
  if (packet.awarded_contractor_id) {
    const { data: c } = await fieldDb().from('contractors').select('*').eq('id', packet.awarded_contractor_id).maybeSingle();
    if (c) await sendEstimateRaisedEmail(c as ContractorRow, changed as { id: string; title: string; posted_price_cents: number }, oldCents, reason).catch(() => {});
  }

  revalidatePath(`/operations/packets/${packetId}`);
  revalidatePath('/operations/packets');
}

/** Mark every approved-but-unpaid packet for one contractor as paid (the
 *  weekly "pay everything owed to X" batch). */
/** Add or adjust the above-and-beyond bonus on a submitted/approved packet,
 *  any time before it's marked paid. 0 clears it. Clamped to 2x the posted
 *  price as a fat-finger guard. The bonus rides the paid receipt and the
 *  contractor's approved view; the posted price itself never changes. */
export async function setPacketBonus(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const packetId = String(formData.get('packet_id') || '');
  const bonusDollars = Number(formData.get('bonus_dollars') || 0);
  const reason = String(formData.get('bonus_reason') || '').trim().slice(0, 500) || null;
  if (!packetId || !Number.isFinite(bonusDollars) || bonusDollars < 0) return;

  const { data: pk } = await fieldDb()
    .from('inspection_packets')
    .select('posted_price_cents, status, paid_at')
    .eq('id', packetId)
    .maybeSingle();
  const packet = pk as { posted_price_cents: number; status: string; paid_at: string | null } | null;
  if (!packet || packet.paid_at || !isPayoutAdjustableStatus(packet.status)) return;

  const bonusCents = Math.min(Math.round(bonusDollars * 100), packet.posted_price_cents * 2);
  // Re-guard status AND paid_at on the write itself (the pre-read can race a
  // concurrent requestChanges / mark-paid), and only audit when a row actually
  // changed so packet_events never claims a bonus that didn't land.
  const { data: changed } = await fieldDb()
    .from('inspection_packets')
    .update({
      bonus_cents: bonusCents,
      bonus_reason: bonusCents > 0 ? reason : null,
      bonus_by_email: bonusCents > 0 ? email : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', packetId)
    .in('status', ['submitted', 'approved'])
    .is('paid_at', null)
    .select('id')
    .maybeSingle();
  if (changed) {
    await fieldDb().from('packet_events').insert({
      packet_id: packetId,
      actor_email: email,
      event_type: bonusCents > 0 ? 'bonus_set' : 'bonus_cleared',
      payload: bonusCents > 0 ? { bonus_cents: bonusCents, reason } : null,
    });
  }
  revalidatePath(`/operations/packets/${packetId}`);
  revalidatePath('/operations/contractors');
}

/** Lock in the FINAL base payout, set from actual time on site. Editable while
 *  the packet is submitted or approved-and-unpaid (same window as the bonus).
 *  An empty value clears it back to the estimate. Guarded to 0..3x the estimate
 *  against a fat-finger. Methodology stays office-side; the contractor just
 *  sees the number settle from "estimated" to final. */
export async function finalizePacketPayout(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const packetId = String(formData.get('packet_id') || '');
  const raw = String(formData.get('final_dollars') ?? '').trim();
  if (!packetId) return;

  const { data: pk } = await fieldDb()
    .from('inspection_packets')
    .select('posted_price_cents, status, paid_at')
    .eq('id', packetId)
    .maybeSingle();
  const packet = pk as { posted_price_cents: number; status: string; paid_at: string | null } | null;
  if (!packet || packet.paid_at || !isPayoutAdjustableStatus(packet.status)) return;

  let finalCents: number | null = null;
  if (raw !== '') {
    const d = Number(raw);
    if (!Number.isFinite(d) || d < 0) return;
    finalCents = Math.min(Math.round(d * 100), packet.posted_price_cents * 3);
  }

  // Re-guard status + paid_at on the write (the pre-read can race a concurrent
  // mark-paid / requestChanges), audit only when a row actually changed.
  const { data: changed } = await fieldDb()
    .from('inspection_packets')
    .update({
      final_payout_cents: finalCents,
      final_payout_by_email: finalCents != null ? email : null,
      final_payout_at: finalCents != null ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', packetId)
    .in('status', ['submitted', 'approved'])
    .is('paid_at', null)
    .select('id')
    .maybeSingle();
  if (changed) {
    await fieldDb()
      .from('packet_events')
      .insert({
        packet_id: packetId,
        actor_email: email,
        event_type: finalCents != null ? 'payout_finalized' : 'payout_reset_to_estimate',
        payload: finalCents != null ? { final_cents: finalCents } : null,
      })
      .then(() => {}, () => {});
  }
  revalidatePath(`/operations/packets/${packetId}`);
  revalidatePath('/operations/packets');
  revalidatePath('/operations/contractors');
}

export async function markContractorPaid(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const contractorId = String(formData.get('contractor_id') || '');
  if (!contractorId) return;
  const reference = String(formData.get('reference') || '').trim() || null;
  const { data: c } = await fieldDb().from('contractors').select('*').eq('id', contractorId).maybeSingle();
  const contractor = (c as ContractorRow | null) ?? null;
  const { data: marked } = await fieldDb()
    .from('inspection_packets')
    .update({
      paid_at: new Date().toISOString(),
      paid_by_email: email,
      paid_method: contractor?.payment_method ?? null,
      paid_reference: reference,
      updated_at: new Date().toISOString(),
    })
    .eq('awarded_contractor_id', contractorId)
    .eq('status', 'approved')
    .is('paid_at', null)
    .select('posted_price_cents, final_payout_cents, bonus_cents');
  const total = ((marked ?? []) as { posted_price_cents: number; final_payout_cents: number | null; bonus_cents: number }[]).reduce(
    (a, r) => a + effectiveBaseCents(r) + (r.bonus_cents || 0),
    0,
  );
  if (total > 0 && contractor) {
    await sendPaidEmail(contractor, total, { method: contractor.payment_method, reference }).catch(() => {});
  }
  revalidatePath('/operations/contractors');
  revalidatePath('/operations/packets');
}

/** Record that the awarded contractor has been paid for an approved packet.
 *  Field's own ledger; the actual payment runs through QuickBooks/books. */
export async function markPacketPaid(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const packetId = String(formData.get('packet_id') || '');
  const reference = String(formData.get('reference') || '').trim() || null;
  const { data } = await fieldDb()
    .from('inspection_packets')
    .update({ paid_at: new Date().toISOString(), paid_by_email: email, paid_reference: reference, updated_at: new Date().toISOString() })
    .eq('id', packetId)
    .eq('status', 'approved')
    .is('paid_at', null)
    .select('posted_price_cents, final_payout_cents, bonus_cents, awarded_contractor_id')
    .maybeSingle();
  const paid = data as { posted_price_cents: number; final_payout_cents: number | null; bonus_cents: number; awarded_contractor_id: string | null } | null;
  if (paid?.awarded_contractor_id) {
    const { data: c } = await fieldDb().from('contractors').select('*').eq('id', paid.awarded_contractor_id).maybeSingle();
    if (c) {
      const contractor = c as ContractorRow;
      // Stamp the remittance method from what's on file, then receipt the contractor.
      await fieldDb().from('inspection_packets').update({ paid_method: contractor.payment_method ?? null }).eq('id', packetId);
      await sendPaidEmail(contractor, effectiveBaseCents(paid) + (paid.bonus_cents || 0), { method: contractor.payment_method, reference }).catch(() => {});
    }
  }
  revalidatePath(`/operations/packets/${packetId}`);
  revalidatePath('/operations/packets');
  revalidatePath('/operations/contractors');
}

export async function publishPacket(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const packetId = String(formData.get('packet_id') || '');
  // Re-check against current bookings/blocks before it goes live: a guest may
  // have moved into one of these properties since the packet was suggested.
  // Stale stops are dropped (and the packet cancelled if none survive, in
  // which case the publish update below no-ops on the status guard).
  await revalidatePacket(packetId);
  await fieldDb()
    .from('inspection_packets')
    .update({
      status: 'published',
      published_at: new Date().toISOString(),
      created_by_email: email,
      updated_at: new Date().toISOString(),
    })
    .eq('id', packetId)
    .in('status', ['draft']);
  await fieldDb().from('packet_events').insert({
    packet_id: packetId,
    actor_email: email,
    event_type: 'published',
  });
  // Restock slips created since the draft attach themselves at publish.
  await autoAttachInventorySlips(packetId).catch(() => {});
  // Text active inspectors near the cluster — fire-and-forget so a Quo hiccup
  // never blocks the publish. No-op when Quo isn't configured or the packet
  // didn't actually go live (revalidation may have emptied it).
  notifyContractorsOfPacket(packetId).catch(() => {});
  revalidatePath(`/operations/packets/${packetId}`);
  revalidatePath('/operations/packets');
}

export async function unpublishPacket(formData: FormData): Promise<void> {
  await staffEmail();
  const packetId = String(formData.get('packet_id') || '');
  await fieldDb()
    .from('inspection_packets')
    .update({ status: 'draft', published_at: null, updated_at: new Date().toISOString() })
    .eq('id', packetId)
    .eq('status', 'published');
  revalidatePath(`/operations/packets/${packetId}`);
  revalidatePath('/operations/packets');
}

export async function cancelPacket(formData: FormData): Promise<void> {
  await staffEmail();
  const packetId = String(formData.get('packet_id') || '');
  await fieldDb()
    .from('inspection_packets')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', packetId)
    // Never cancel an approved/paid packet — it would vanish from the payout
    // ledger (getContractorPayStats filters status='approved').
    .in('status', ['draft', 'published', 'claimed', 'in_progress']);
  await revokePacketCodes(packetId).catch(() => {}); // pull any live door codes
  revalidatePath(`/operations/packets/${packetId}`);
  revalidatePath('/operations/packets');
}

/** Release a stalled (claimed but not started) packet back to the open
 *  marketplace — clears the contractor so door codes stop revealing, reopens
 *  for claim, and re-notifies. The graceful failover when a 1099 falls through
 *  before they've started. */
export async function releasePacket(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const packetId = String(formData.get('packet_id') || '');
  // Capture who was released BEFORE we clear them — the release is a reliability
  // signal (a claim that fell through pre-start) and the update nulls the field.
  const { data: pre } = await fieldDb()
    .from('inspection_packets')
    .select('awarded_contractor_id')
    .eq('id', packetId)
    .eq('status', 'claimed')
    .maybeSingle();
  const releasedContractorId = (pre as { awarded_contractor_id: string | null } | null)?.awarded_contractor_id ?? null;
  const { data } = await fieldDb()
    .from('inspection_packets')
    .update({ status: 'published', awarded_contractor_id: null, claimed_at: null, updated_at: new Date().toISOString() })
    .eq('id', packetId)
    .eq('status', 'claimed')
    .select('id')
    .maybeSingle();
  if (data) {
    await fieldDb()
      .from('packet_events')
      .insert({ packet_id: packetId, contractor_id: releasedContractorId, actor_email: email, event_type: 'released' });
    await revokePacketCodes(packetId).catch(() => {}); // released inspector loses the door codes
    if (releasedContractorId) {
      const { data: rc } = await fieldDb().from('contractors').select('email, full_name, portal_token').eq('id', releasedContractorId).maybeSingle();
      const { data: pk } = await fieldDb().from('inspection_packets').select('title').eq('id', packetId).maybeSingle();
      if (rc && pk) await sendReassignedEmail(rc as ContractorRow, pk as { title: string }).catch(() => {});
    }
    notifyContractorsOfPacket(packetId).catch(() => {});
  }
  revalidatePath('/operations/packets');
  revalidatePath(`/operations/packets/${packetId}`);
}

/** The ATTACHED slips (extra tasks riding on a stop, in packet_stop_work_slips
 *  — NOT the stop's own packet_stops.work_slip_id) that the inspector marked
 *  done on this packet. Their underlying work_slips sit at 'in_progress' until
 *  the office resolves the packet: approve closes them, request-changes
 *  reopens them. Returns both ids so callers can touch the attachment and the
 *  slip. */
async function completedAttachmentsForPacket(packetId: string): Promise<{ id: string; work_slip_id: string }[]> {
  const { data: stops } = await fieldDb().from('packet_stops').select('id').eq('packet_id', packetId);
  const stopIds = ((stops ?? []) as { id: string }[]).map((s) => s.id);
  if (!stopIds.length) return [];
  const { data: atts } = await fieldDb()
    .from('packet_stop_work_slips')
    .select('id, work_slip_id')
    .in('stop_id', stopIds)
    .not('completed_at', 'is', null);
  return ((atts ?? []) as { id: string; work_slip_id: string }[]);
}

export async function approvePacket(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const packetId = String(formData.get('packet_id') || '');

  // Optional above-and-beyond bonus, set right in the approve form. Clamped to
  // 0..2x the posted price as a fat-finger guard (same philosophy as the price
  // override clamp at bundle time).
  const bonusDollars = Number(formData.get('bonus_dollars') || 0);
  const bonusReason = String(formData.get('bonus_reason') || '').trim().slice(0, 500) || null;
  let bonusCents = Number.isFinite(bonusDollars) && bonusDollars > 0 ? Math.round(bonusDollars * 100) : 0;

  // Optional final payout, set right in the approve form (the "toggle the price
  // as I approve it" path). Empty leaves the estimate in place. Guarded 0..3x
  // the estimate against a fat-finger.
  const finalRaw = String(formData.get('final_dollars') ?? '').trim();

  let finalCents: number | null = null;
  if (bonusCents > 0 || finalRaw !== '') {
    const { data: pk } = await fieldDb().from('inspection_packets').select('posted_price_cents').eq('id', packetId).maybeSingle();
    const posted = (pk as { posted_price_cents: number } | null)?.posted_price_cents ?? 0;
    if (bonusCents > 0) bonusCents = Math.min(bonusCents, posted * 2);
    if (finalRaw !== '') {
      const d = Number(finalRaw);
      if (Number.isFinite(d) && d >= 0) finalCents = Math.min(Math.round(d * 100), posted * 3);
    }
  }

  const { data: approved } = await fieldDb()
    .from('inspection_packets')
    .update({
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by_email: email,
      ...(bonusCents > 0 ? { bonus_cents: bonusCents, bonus_reason: bonusReason, bonus_by_email: email } : {}),
      ...(finalCents != null ? { final_payout_cents: finalCents, final_payout_by_email: email, final_payout_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', packetId)
    .eq('status', 'submitted')
    .select('id, title, awarded_contractor_id, posted_price_cents, final_payout_cents, bonus_cents, bonus_reason')
    .maybeSingle();
  if (approved) {
    await fieldDb().from('packet_events').insert({ packet_id: packetId, actor_email: email, event_type: 'approved' });
    // The contractor's inspection reports were held at completion — fan them
    // out to the office now that the work has passed review.
    const { data: stops } = await fieldDb().from('packet_stops').select('inspection_id').eq('packet_id', packetId);
    for (const s of (stops ?? []) as { inspection_id: string | null }[]) {
      if (s.inspection_id) await sendInspectionReportEmail(s.inspection_id).catch(() => {});
    }
    // Close the maintenance work slips this packet covered — terminal "done"
    // is office-approved, not self-reported.
    const { data: mstops } = await fieldDb().from('packet_stops').select('work_slip_id').eq('packet_id', packetId).not('work_slip_id', 'is', null);
    const slipIds = ((mstops ?? []) as { work_slip_id: string }[]).map((s) => s.work_slip_id);
    if (slipIds.length) {
      await fieldDb()
        .from('work_slips')
        .update({ status: 'done', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .in('id', slipIds);
    }
    // Same for the ATTACHED slips the inspector completed (they live in
    // packet_stop_work_slips, so the block above misses them) — otherwise a
    // restock / gear task stays stuck at 'in_progress' on the work board after
    // the packet is approved.
    const attWorkSlipIds = (await completedAttachmentsForPacket(packetId)).map((a) => a.work_slip_id);
    if (attWorkSlipIds.length) {
      await fieldDb()
        .from('work_slips')
        .update({ status: 'done', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .in('id', attWorkSlipIds);
    }
    // Receipt the contractor: approved, payment queued (bonus celebrated).
    const ap = approved as { title: string; awarded_contractor_id: string | null; posted_price_cents: number; final_payout_cents: number | null; bonus_cents: number; bonus_reason: string | null };
    if (ap.awarded_contractor_id) {
      const { data: c } = await fieldDb().from('contractors').select('email, full_name, portal_token').eq('id', ap.awarded_contractor_id).maybeSingle();
      if (c) {
        await sendApprovedEmail(c as ContractorRow, {
          title: ap.title,
          totalCents: effectiveBaseCents(ap) + (ap.bonus_cents || 0),
          bonusCents: ap.bonus_cents || 0,
          bonusReason: ap.bonus_reason,
        }).catch(() => {});
      }
    }
  }
  revalidatePath(`/operations/packets/${packetId}`);
  revalidatePath('/operations/packets');
}

/** Bounce a submitted packet back to the contractor for a redo, with a note.
 *  Reopens it (in_progress) and resets the stops so they re-inspect; the prior
 *  inspection rows stay as an audit trail. */
export async function requestChanges(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const packetId = String(formData.get('packet_id') || '');
  const note = String(formData.get('note') || '').trim();
  const { data } = await fieldDb()
    .from('inspection_packets')
    .update({ status: 'in_progress', notes: note || null, submitted_at: null, updated_at: new Date().toISOString() })
    .eq('id', packetId)
    .eq('status', 'submitted')
    .select('id, title, awarded_contractor_id')
    .maybeSingle();
  if (data) {
    // Reopen any maintenance work slips this packet had marked done, so the
    // rejected jobs aren't stuck at 'done' (and re-surface if not redone).
    const { data: rs } = await fieldDb()
      .from('packet_stops')
      .select('work_slip_id')
      .eq('packet_id', packetId)
      .not('work_slip_id', 'is', null);
    const slipIds = ((rs ?? []) as { work_slip_id: string }[]).map((s) => s.work_slip_id);
    if (slipIds.length) {
      await fieldDb()
        .from('work_slips')
        .update({ status: 'open', completed_at: null, resolution_notes: null, updated_at: new Date().toISOString() })
        .in('id', slipIds);
    }
    // Reopen the ATTACHED slips too (parity with the stop slips): clear the
    // attachment completion and revert the underlying slip so the redo is clean.
    const atts = await completedAttachmentsForPacket(packetId);
    if (atts.length) {
      await fieldDb().from('packet_stop_work_slips').update({ completed_at: null }).in('id', atts.map((a) => a.id));
      await fieldDb()
        .from('work_slips')
        .update({ status: 'open', completed_at: null, resolution_notes: null, updated_at: new Date().toISOString() })
        .in('id', atts.map((a) => a.work_slip_id));
    }
    await fieldDb().from('packet_stops').update({ status: 'pending', inspection_id: null }).eq('packet_id', packetId);
    const row = data as { id: string; title: string; awarded_contractor_id: string | null };
    await fieldDb().from('packet_events').insert({
      packet_id: packetId,
      contractor_id: row.awarded_contractor_id ?? null,
      actor_email: email,
      event_type: 'changes_requested',
      payload: note ? { note } : null,
    });
    // Tell the contractor — this is the one transition that needs them to act.
    if (row.awarded_contractor_id) {
      const { data: c } = await fieldDb()
        .from('contractors')
        .select('email, full_name, portal_token')
        .eq('id', row.awarded_contractor_id)
        .maybeSingle();
      if (c) {
        await sendChangesRequestedEmail(
          c as { email: string; full_name: string; portal_token: string },
          { id: row.id, title: row.title },
          note,
        ).catch(() => {});
      }
    }
  }
  revalidatePath(`/operations/packets/${packetId}`);
  revalidatePath('/operations/packets');
}

export async function removeStop(formData: FormData): Promise<void> {
  await staffEmail();
  const packetId = String(formData.get('packet_id') || '');
  const stopId = String(formData.get('stop_id') || '');
  // Only reshape drafts — never strand a claimed/live packet (or empty it to a
  // zombie 0-stop packet someone already claimed).
  const { data: pre } = await fieldDb().from('inspection_packets').select('status').eq('id', packetId).maybeSingle();
  if ((pre as { status: string } | null)?.status !== 'draft') return;
  const { data: stop } = await fieldDb()
    .from('packet_stops')
    .select('base_price_cents')
    .eq('id', stopId)
    .maybeSingle();
  // Already gone — a double-submitted remove (the link has no pending state).
  // Bail before touching the packet row: blindly decrementing stop_count on
  // the second fire is how a 2-row packet gets stored as "1 stop".
  if (!stop) return;
  await fieldDb().from('packet_stops').delete().eq('id', stopId).eq('packet_id', packetId);
  // Count the SURVIVING rows instead of decrementing the column, so the stored
  // count can never drift from reality. The price stays a subtraction (not a
  // recompute from bases) to preserve any operator-set posted price.
  const { count: liveCount } = await fieldDb()
    .from('packet_stops')
    .select('id', { count: 'exact', head: true })
    .eq('packet_id', packetId);
  const { data: pkt } = await fieldDb()
    .from('inspection_packets')
    .select('posted_price_cents')
    .eq('id', packetId)
    .maybeSingle();
  if (pkt) {
    const base = (stop as { base_price_cents: number }).base_price_cents ?? 0;
    const p = pkt as { posted_price_cents: number };
    await fieldDb()
      .from('inspection_packets')
      .update({
        posted_price_cents: Math.max(0, p.posted_price_cents - base),
        stop_count: liveCount ?? 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', packetId);
  }
  revalidatePath(`/operations/packets/${packetId}`);
}

/** Invite a contractor: create the row + email their personal portal link. */
export async function inviteContractor(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const fullName = String(formData.get('full_name') || '').trim();
  const contractorEmail = String(formData.get('email') || '').trim().toLowerCase();
  const phone = String(formData.get('phone') || '').trim() || null;
  const trade = parseTrade(formData.get('trade') as string | null);
  if (!fullName || !contractorEmail) return;

  // Already invited? Re-send their link instead of throwing on the unique email.
  const { data: existing } = await fieldDb()
    .from('contractors')
    .select('*')
    .eq('email', contractorEmail)
    .maybeSingle();
  if (existing) {
    await sendInviteEmail(existing as ContractorRow).catch(() => {});
    revalidatePath('/operations/contractors');
    return;
  }

  const { data } = await fieldDb()
    .from('contractors')
    .insert({
      full_name: fullName,
      email: contractorEmail,
      phone,
      trade,
      status: 'invited',
      portal_token: newPortalToken(),
      invited_by_email: email,
    })
    .select('*')
    .single();
  const contractor = (data as ContractorRow | null) ?? null;
  if (contractor) await sendInviteEmail(contractor).catch(() => {});
  revalidatePath('/operations/contractors');
}

/** Pause / reactivate / archive an inspector. Paused can still see their
 *  claimed packets but can't claim new work (canClaim checks status==='active').
 *  Archived is cut off entirely — the token + session stop resolving — so we
 *  also drop their sessions. */
export async function setContractorStatus(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const id = String(formData.get('contractor_id') || '');
  const status = String(formData.get('status') || '');
  if (!['active', 'paused', 'archived'].includes(status)) return;
  await fieldDb().from('contractors').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  if (status === 'archived') {
    // Hard offboard: kill sessions, AND pull any live door codes + release the
    // unfinished work this contractor was holding — so a removed inspector
    // can't keep entering homes or sit on coverage.
    await fieldDb().from('contractor_sessions').delete().eq('contractor_id', id);
    const { data: live } = await fieldDb()
      .from('inspection_packets')
      .select('id')
      .eq('awarded_contractor_id', id)
      .in('status', ['claimed', 'in_progress']);
    for (const p of (live ?? []) as { id: string }[]) {
      await revokePacketCodes(p.id).catch(() => {});
      const { data: rel } = await fieldDb()
        .from('inspection_packets')
        .update({ status: 'published', awarded_contractor_id: null, claimed_at: null, updated_at: new Date().toISOString() })
        .eq('id', p.id)
        .in('status', ['claimed', 'in_progress'])
        .select('id')
        .maybeSingle();
      if (rel) {
        await fieldDb()
          .from('packet_events')
          .insert({ packet_id: p.id, contractor_id: id, actor_email: email, event_type: 'released' });
        notifyContractorsOfPacket(p.id).catch(() => {});
      }
    }
  }
  revalidatePath('/operations/contractors');
  revalidatePath('/operations/packets');
}

/** Rotate an inspector's portal token (kills the old link + all live sessions)
 *  and email them the fresh link. Use when a link may have leaked. */
export async function rotateContractorToken(formData: FormData): Promise<void> {
  await staffEmail();
  const id = String(formData.get('contractor_id') || '');
  const { data } = await fieldDb()
    .from('contractors')
    .update({ portal_token: newPortalToken(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  await fieldDb().from('contractor_sessions').delete().eq('contractor_id', id);
  const c = (data as ContractorRow | null) ?? null;
  if (c) await sendInviteEmail(c).catch(() => {});
  revalidatePath('/operations/contractors');
}

/** Re-send the existing portal link (no rotation). */
export async function resendInvite(formData: FormData): Promise<void> {
  await staffEmail();
  const id = String(formData.get('contractor_id') || '');
  const { data } = await fieldDb().from('contractors').select('*').eq('id', id).maybeSingle();
  const c = (data as ContractorRow | null) ?? null;
  if (c) await sendInviteEmail(c).catch(() => {});
  revalidatePath('/operations/contractors');
}

/** Mark an inspector's W-9 on file (or clear it). The W-9 PDF itself stays in
 *  QuickBooks per the established boundary — this just drives the on-file flag
 *  the 1099 rollup reads, keyed by the contractor's vendor_key (stamped here
 *  so future name-matching stays stable). */
/** Set a contractor's background-check status. Claiming is gated on 'cleared'
 *  (canClaim), so this is what lets a vetted inspector start taking work. */
export async function setContractorBackgroundCheck(formData: FormData): Promise<void> {
  const staff = await staffEmail();
  const contractorId = String(formData.get('contractor_id') || '');
  const statusIn = String(formData.get('bg_status') || '');
  const allowed = ['not_started', 'pending', 'cleared', 'failed'];
  if (!contractorId || !allowed.includes(statusIn)) return;
  await fieldDb()
    .from('contractors')
    .update({
      background_check_status: statusIn,
      background_check_at: statusIn === 'cleared' || statusIn === 'failed' ? new Date().toISOString() : null,
      background_check_by_email: staff,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contractorId);
  revalidatePath('/operations/contractors');
}

export async function setContractorW9(formData: FormData): Promise<void> {
  await staffEmail();
  const contractorId = String(formData.get('contractor_id') || '');
  const onFile = formData.get('on_file') === 'true';
  const { data } = await fieldDb()
    .from('contractors')
    .select('id, full_name, vendor_key')
    .eq('id', contractorId)
    .maybeSingle();
  const c = data as { id: string; full_name: string; vendor_key: string | null } | null;
  if (!c) return;
  const key = (c.vendor_key || c.full_name).trim().toLowerCase().replace(/\s+/g, ' ');
  await fieldDb()
    .from('vendor_w9')
    .upsert(
      { vendor_key: key, display_name: c.full_name, on_file: onFile, updated_at: new Date().toISOString() },
      { onConflict: 'vendor_key' },
    );
  await fieldDb()
    .from('contractors')
    .update({ w9_on_file: onFile, vendor_key: key, updated_at: new Date().toISOString() })
    .eq('id', contractorId);
  revalidatePath('/operations/contractors');
}
