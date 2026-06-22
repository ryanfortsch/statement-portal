'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { fieldDb } from '@/lib/field-db';
import { geocodeAddress } from '@/lib/geocode';
import { resolveContractorFromCookie, endContractorSession } from '@/lib/field-auth';
import { canClaim, type PacketRow, type PacketStopRow } from '@/lib/field-types';
import { revalidatePacket } from '@/lib/field-packets';
import { programPacketCodes, revokePacketCodes } from '@/lib/field-locks';
import { HELM_CORE_TEMPLATE_ID } from '@/lib/inspections-types';
import { generateDeck } from '@/lib/inspection-deck';
import { sendClaimConfirmation, sendPacketSubmittedEmail, sendContractorOnboardedEmail } from '@/lib/field-notify';

async function reqContext() {
  const h = await headers();
  return {
    ip: (h.get('x-forwarded-for') || '').split(',')[0].trim() || null,
    userAgent: h.get('user-agent'),
  };
}

async function logEvent(args: {
  packetId?: string | null;
  contractorId?: string | null;
  actorEmail?: string | null;
  eventType: string;
  propertyId?: string | null;
  payload?: Record<string, unknown> | null;
}) {
  const { ip, userAgent } = await reqContext();
  await fieldDb().from('packet_events').insert({
    packet_id: args.packetId ?? null,
    contractor_id: args.contractorId ?? null,
    actor_email: args.actorEmail ?? null,
    event_type: args.eventType,
    property_id: args.propertyId ?? null,
    payload: args.payload ?? null,
    ip,
    user_agent: userAgent,
  });
}

/** Finish onboarding: record W9-on-file + the signed agreement and flip the
 *  contractor to active so they can claim. */
export async function completeOnboarding(formData: FormData) {
  const contractor = await resolveContractorFromCookie();
  if (!contractor) redirect('/field');

  const signedName = String(formData.get('signed_name') || '').trim();
  const agree = formData.get('agree') === 'on';
  const w9 = formData.get('w9_confirm') === 'on';
  const phone = String(formData.get('phone') || '').trim();
  const fullName = String(formData.get('full_name') || '').trim();
  const homeAddress = String(formData.get('home_address') || '').trim();
  if (!agree || !w9 || signedName.length < 3) {
    redirect('/field/onboarding?error=incomplete');
  }

  // Geocode their home base so the marketplace can rank packets "near you".
  // Best-effort: a failed lookup just leaves coords null (no ranking).
  let homeLat = contractor.home_lat;
  let homeLng = contractor.home_lng;
  if (homeAddress) {
    const coords = await geocodeAddress(homeAddress);
    if (coords) {
      homeLat = coords.lat;
      homeLng = coords.lng;
    }
  }

  const { ip, userAgent } = await reqContext();
  await fieldDb()
    .from('contractors')
    .update({
      full_name: fullName || contractor.full_name,
      phone: phone || contractor.phone,
      home_lat: homeLat,
      home_lng: homeLng,
      w9_on_file: true,
      agreement_signed_at: new Date().toISOString(),
      agreement_signed_name: signedName,
      agreement_ip: ip,
      agreement_user_agent: userAgent,
      status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', contractor.id);

  await logEvent({ contractorId: contractor.id, actorEmail: contractor.email, eventType: 'onboarded' });
  await sendContractorOnboardedEmail({
    ...contractor,
    full_name: fullName || contractor.full_name,
    phone: phone || contractor.phone,
  }).catch(() => {});
  revalidatePath('/field');
  redirect('/field');
}

/** Atomic first-come claim. Only the first claimer flips a 'published'
 *  packet to 'claimed'; everyone else gets bounced back with ?taken=1. */
export async function claimPacket(formData: FormData) {
  const packetId = String(formData.get('packet_id') || '');
  const contractor = await resolveContractorFromCookie();
  if (!contractor) redirect('/field');
  if (!canClaim(contractor)) redirect('/field/onboarding');

  // Re-validate windows at the moment of claim: if a guest moved into one of
  // the stops since publish, drop it and bounce the contractor back to the
  // refreshed packet rather than letting them walk into an occupied house.
  const reval = await revalidatePacket(packetId);
  if (reval.emptied || reval.removed > 0) {
    redirect(`/field/packet/${packetId}?stale=1`);
  }

  const { data, error } = await fieldDb()
    .from('inspection_packets')
    .update({
      status: 'claimed',
      awarded_contractor_id: contractor.id,
      claimed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', packetId)
    .eq('status', 'published')
    .eq('trade', contractor.trade) // a contractor can only claim work of their own trade
    .select('*')
    .maybeSingle();

  const packet = (data as PacketRow | null) ?? null;
  if (error || !packet) {
    redirect(`/field/packet/${packetId}?taken=1`);
  }

  await logEvent({
    packetId,
    contractorId: contractor.id,
    actorEmail: contractor.email,
    eventType: 'claimed',
  });
  // Access details are now revealed to this contractor — record the reveal.
  await logEvent({
    packetId,
    contractorId: contractor.id,
    actorEmail: contractor.email,
    eventType: 'access_revealed',
  });
  await sendClaimConfirmation(contractor, packet).catch(() => {});
  // Program the inspector's door code onto the stops' Schlage locks for the
  // claim→submit window (no-op until Seam + locks are connected).
  await programPacketCodes(packetId).catch(() => {});

  revalidatePath('/field');
  revalidatePath(`/field/packet/${packetId}`);
  redirect(`/field/packet/${packetId}`);
}

/** Start (or resume) the inspection for one stop, then drop the contractor
 *  into the existing Stepper. */
export async function startStopInspection(formData: FormData) {
  const packetId = String(formData.get('packet_id') || '');
  const stopId = String(formData.get('stop_id') || '');
  const contractor = await resolveContractorFromCookie();
  if (!contractor) redirect('/field');

  const { data: pData } = await fieldDb()
    .from('inspection_packets')
    .select('id, status, awarded_contractor_id')
    .eq('id', packetId)
    .maybeSingle();
  const packet = pData as { id: string; status: string; awarded_contractor_id: string | null } | null;
  if (!packet || packet.awarded_contractor_id !== contractor.id) redirect('/field');
  if (!['claimed', 'in_progress'].includes(packet.status)) redirect(`/field/packet/${packetId}`);

  const { data: sData } = await fieldDb()
    .from('packet_stops')
    .select('*')
    .eq('id', stopId)
    .eq('packet_id', packetId)
    .maybeSingle();
  const stop = sData as PacketStopRow | null;
  if (!stop) redirect(`/field/packet/${packetId}`);
  // Never run the inspection deck on a maintenance stop (it has a work slip,
  // not a Helm-Core walk) — guards cross-trade claims + deleted-slip edges.
  if (stop.work_slip_id) redirect(`/field/packet/${packetId}`);

  // Resume if already started.
  if (stop.inspection_id) {
    redirect(`/field/inspect/${stop.inspection_id}`);
  }

  const deck = await generateDeck({
    templateId: HELM_CORE_TEMPLATE_ID,
    propertyId: stop.property_id,
    client: fieldDb(),
  });

  const { data: insp, error } = await fieldDb()
    .from('inspections')
    .insert({
      property_id: stop.property_id,
      template_id: HELM_CORE_TEMPLATE_ID,
      inspector_email: contractor.email,
      inspector_name: contractor.full_name,
      ordered_item_ids: deck.itemIds,
      ordered_cards: deck.cards,
    })
    .select('id')
    .single();
  if (error || !insp) redirect(`/field/packet/${packetId}`);
  const inspectionId = (insp as { id: string }).id;

  await fieldDb()
    .from('packet_stops')
    .update({ inspection_id: inspectionId, status: 'in_progress' })
    .eq('id', stopId);
  if (packet.status === 'claimed') {
    await fieldDb().from('inspection_packets').update({ status: 'in_progress' }).eq('id', packetId);
  }
  await logEvent({
    packetId,
    contractorId: contractor.id,
    actorEmail: contractor.email,
    eventType: 'stop_started',
    propertyId: stop.property_id,
  });

  redirect(`/field/inspect/${inspectionId}`);
}

/** Complete a maintenance stop: record the resolution on the work slip and mark
 *  the stop done. No inspection deck — the "work" is the slip's job, and a short
 *  note on what was done is the maintenance quality floor. */
export async function completeMaintenanceStop(formData: FormData) {
  const packetId = String(formData.get('packet_id') || '');
  const stopId = String(formData.get('stop_id') || '');
  const note = String(formData.get('resolution') || '').trim();
  const contractor = await resolveContractorFromCookie();
  if (!contractor) redirect('/field');

  const { data: pData } = await fieldDb()
    .from('inspection_packets')
    .select('id, status, awarded_contractor_id')
    .eq('id', packetId)
    .maybeSingle();
  const packet = pData as { id: string; status: string; awarded_contractor_id: string | null } | null;
  if (!packet || packet.awarded_contractor_id !== contractor.id) redirect('/field');
  if (!['claimed', 'in_progress'].includes(packet.status)) redirect(`/field/packet/${packetId}`);

  const { data: sData } = await fieldDb()
    .from('packet_stops')
    .select('*')
    .eq('id', stopId)
    .eq('packet_id', packetId)
    .maybeSingle();
  const stop = sData as PacketStopRow | null;
  if (!stop || !stop.work_slip_id) redirect(`/field/packet/${packetId}`);
  if (note.length < 4) redirect(`/field/packet/${packetId}?note=1`);

  await fieldDb()
    .from('work_slips')
    .update({
      status: 'done',
      completed_at: new Date().toISOString(),
      resolution_notes: note,
      updated_at: new Date().toISOString(),
    })
    .eq('id', stop.work_slip_id);
  await fieldDb().from('packet_stops').update({ status: 'complete' }).eq('id', stopId);
  if (packet.status === 'claimed') {
    await fieldDb().from('inspection_packets').update({ status: 'in_progress' }).eq('id', packetId);
  }
  await logEvent({
    packetId,
    contractorId: contractor.id,
    actorEmail: contractor.email,
    eventType: 'stop_completed',
    propertyId: stop.property_id,
    payload: { work_slip_id: stop.work_slip_id },
  });
  revalidatePath(`/field/packet/${packetId}`);
  redirect(`/field/packet/${packetId}`);
}

/** Submit the whole packet for office review once every stop is complete. */
export async function submitPacket(formData: FormData) {
  const packetId = String(formData.get('packet_id') || '');
  const contractor = await resolveContractorFromCookie();
  if (!contractor) redirect('/field');

  const { data: pData } = await fieldDb()
    .from('inspection_packets')
    .select('*')
    .eq('id', packetId)
    .maybeSingle();
  const packet = (pData as PacketRow | null) ?? null;
  if (!packet || packet.awarded_contractor_id !== contractor.id) redirect('/field');

  const { data: stops } = await fieldDb()
    .from('packet_stops')
    .select('status')
    .eq('packet_id', packetId);
  const allComplete =
    (stops ?? []).length > 0 &&
    (stops as { status: string }[]).every((s) => s.status === 'complete' || s.status === 'skipped');
  if (!allComplete) redirect(`/field/packet/${packetId}?incomplete=1`);

  await fieldDb()
    .from('inspection_packets')
    .update({ status: 'submitted', submitted_at: new Date().toISOString() })
    .eq('id', packetId);
  await logEvent({
    packetId,
    contractorId: contractor.id,
    actorEmail: contractor.email,
    eventType: 'submitted',
  });
  await sendPacketSubmittedEmail(contractor, packet).catch(() => {});
  // Work is in for review — pull the inspector's door codes back off the locks.
  await revokePacketCodes(packetId).catch(() => {});

  revalidatePath(`/field/packet/${packetId}`);
  redirect(`/field/packet/${packetId}`);
}

export async function signOutField() {
  await endContractorSession();
  redirect('/field');
}
