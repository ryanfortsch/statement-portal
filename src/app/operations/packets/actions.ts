'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { fieldDb } from '@/lib/field-db';
import { newPortalToken } from '@/lib/field-auth';
import { suggestPackets, persistSuggestions, revalidatePacket, createPacketFromProperties, createMaintenancePacket } from '@/lib/field-packets';
import { revokePacketCodes, programPacketCodes } from '@/lib/field-locks';
import { revealTin } from '@/lib/field-w9';
import { revealPayment } from '@/lib/field-pay';
import { sendInviteEmail, notifyContractorsOfPacket, sendPaidEmail, sendChangesRequestedEmail, sendClaimConfirmation } from '@/lib/field-notify';
import { sendInspectionReportEmail } from '@/lib/inspection-report-email';
import { canClaim, type PacketRow } from '@/lib/field-types';
import type { ContractorRow } from '@/lib/field-types';

async function staffEmail(): Promise<string> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');
  return session.user.email;
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
  if (!packet || !['published', 'claimed'].includes(packet.status)) return;
  if (packet.awarded_contractor_id === contractorId) return; // no-op

  const { data: c } = await fieldDb().from('contractors').select('*').eq('id', contractorId).maybeSingle();
  const contractor = (c as ContractorRow | null) ?? null;
  if (!contractor || !canClaim(contractor) || contractor.trade !== packet.trade) return;

  // Reassigning away from someone — pull their live codes first.
  if (packet.awarded_contractor_id) await revokePacketCodes(packetId).catch(() => {});

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
  if (!packetId || !visitDate) return;
  await fieldDb()
    .from('inspection_packets')
    .update({ visit_date: visitDate, window_start: visitDate, window_end: visitDate, claim_deadline: visitDate, updated_at: new Date().toISOString() })
    .eq('id', packetId)
    .in('status', ['draft', 'published']);
  revalidatePath(`/operations/packets/${packetId}`);
  revalidatePath('/operations/packets');
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

/** Mark every approved-but-unpaid packet for one contractor as paid (the
 *  weekly "pay everything owed to X" batch). */
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
    .select('posted_price_cents');
  const total = ((marked ?? []) as { posted_price_cents: number }[]).reduce((a, r) => a + r.posted_price_cents, 0);
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
    .select('posted_price_cents, awarded_contractor_id')
    .maybeSingle();
  const paid = data as { posted_price_cents: number; awarded_contractor_id: string | null } | null;
  if (paid?.awarded_contractor_id) {
    const { data: c } = await fieldDb().from('contractors').select('*').eq('id', paid.awarded_contractor_id).maybeSingle();
    if (c) {
      const contractor = c as ContractorRow;
      // Stamp the remittance method from what's on file, then receipt the contractor.
      await fieldDb().from('inspection_packets').update({ paid_method: contractor.payment_method ?? null }).eq('id', packetId);
      await sendPaidEmail(contractor, paid.posted_price_cents, { method: contractor.payment_method, reference }).catch(() => {});
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
    notifyContractorsOfPacket(packetId).catch(() => {});
  }
  revalidatePath('/operations/packets');
  revalidatePath(`/operations/packets/${packetId}`);
}

export async function approvePacket(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const packetId = String(formData.get('packet_id') || '');
  const { data: approved } = await fieldDb()
    .from('inspection_packets')
    .update({
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by_email: email,
      updated_at: new Date().toISOString(),
    })
    .eq('id', packetId)
    .eq('status', 'submitted')
    .select('id')
    .maybeSingle();
  if (approved) {
    await fieldDb().from('packet_events').insert({ packet_id: packetId, actor_email: email, event_type: 'approved' });
    // The contractor's inspection reports were held at completion — fan them
    // out to the office now that the work has passed review.
    const { data: stops } = await fieldDb().from('packet_stops').select('inspection_id').eq('packet_id', packetId);
    for (const s of (stops ?? []) as { inspection_id: string | null }[]) {
      if (s.inspection_id) await sendInspectionReportEmail(s.inspection_id).catch(() => {});
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
        .select('email, full_name')
        .eq('id', row.awarded_contractor_id)
        .maybeSingle();
      if (c) {
        await sendChangesRequestedEmail(
          c as { email: string; full_name: string },
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
  await fieldDb().from('packet_stops').delete().eq('id', stopId).eq('packet_id', packetId);
  const { data: pkt } = await fieldDb()
    .from('inspection_packets')
    .select('posted_price_cents, stop_count')
    .eq('id', packetId)
    .maybeSingle();
  if (pkt) {
    const base = (stop as { base_price_cents: number } | null)?.base_price_cents ?? 0;
    const p = pkt as { posted_price_cents: number; stop_count: number };
    await fieldDb()
      .from('inspection_packets')
      .update({
        posted_price_cents: Math.max(0, p.posted_price_cents - base),
        stop_count: Math.max(0, p.stop_count - 1),
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
  const tradeIn = String(formData.get('trade') || 'inspection');
  const trade = tradeIn === 'maintenance' || tradeIn === 'cleaning' ? tradeIn : 'inspection';
  if (!fullName || !contractorEmail) return;

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
