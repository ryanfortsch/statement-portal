'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { fieldDb } from '@/lib/field-db';
import { maybeAwardStreakBonus } from '@/lib/field-streaks';
import { geocodeAddress } from '@/lib/geocode';
import { haversineMiles } from '@/lib/proximity';
import { resolveContractorFromCookie, endContractorSession } from '@/lib/field-auth';
import { canClaim, type PacketRow, type PacketStopRow } from '@/lib/field-types';
import { isWorkingStatus } from '@/lib/field-packet-status';
import { revalidatePacket, getContractorReliability } from '@/lib/field-packets';
import { loadRecentVisits } from '@/lib/field-report';
import { programPacketCodes, revokePacketCodes } from '@/lib/field-locks';
import { saveW9 } from '@/lib/field-w9';
import { savePayment } from '@/lib/field-pay';
import { HELM_CORE_TEMPLATE_ID } from '@/lib/inspections-types';
import { generateDeck } from '@/lib/inspection-deck';
import { sendClaimConfirmation, sendPacketSubmittedEmail, sendContractorOnboardedEmail, sendContractorQuestionEmail, sendStreakBonusOfficeEmail } from '@/lib/field-notify';

/** "Send a note" from the portal's Reach-out affordance. Auth'd by the
 *  contractor cookie so we know who is asking; emails Ryan with reply-to set to
 *  the contractor. Returns a result the client can show. */
export async function sendContractorNote(message: string): Promise<{ ok: boolean; error?: string }> {
  const contractor = await resolveContractorFromCookie();
  if (!contractor) return { ok: false, error: 'Please reopen your portal link and try again.' };
  const text = (message || '').trim();
  if (text.length < 2) return { ok: false, error: 'Add a short message first.' };
  const sent = await sendContractorQuestionEmail(contractor, text.slice(0, 2000));
  return sent ? { ok: true } : { ok: false, error: 'Could not send just now. Give us a text or call instead.' };
}

export type ReportState = { ok: boolean; error?: string; home?: string };

/** Inspector flags an issue at a home they visited in the last 72 hours. Creates
 *  a normal OPEN work_slip (so it flows onto the /work board + property page like
 *  any other) tagged with who reported it and from which visit. The 72h window is
 *  RE-CHECKED here against loadRecentVisits, never trusted from the client. */
export async function reportFieldWorkSlip(_prev: ReportState, formData: FormData): Promise<ReportState> {
  const contractor = await resolveContractorFromCookie();
  if (!contractor) return { ok: false, error: 'Please reopen your portal link and try again.' };

  const propertyId = String(formData.get('property_id') || '').trim();
  const title = String(formData.get('title') || '').trim();
  const location = String(formData.get('location') || '').trim();
  const description = String(formData.get('description') || '').trim();
  const priorityRaw = String(formData.get('priority') || 'normal');
  const priority = (['low', 'normal', 'high'] as const).find((p) => p === priorityRaw) ?? 'normal';
  let photoUrls: string[] = [];
  try {
    const parsed = JSON.parse(String(formData.get('photo_urls') || '[]'));
    if (Array.isArray(parsed)) photoUrls = parsed.filter((u): u is string => typeof u === 'string').slice(0, 12).map((u) => u.slice(0, 500));
  } catch {
    /* no photos */
  }

  if (!propertyId) return { ok: false, error: 'Pick the home you want to flag.' };
  if (title.length < 3) return { ok: false, error: 'Add a short line on what needs attention.' };

  // The real gate: the property MUST be one they actually visited in the window.
  // The dropdown is only a convenience; this is what's enforced.
  const visits = await loadRecentVisits(contractor.id);
  const visit = visits.find((v) => v.propertyId === propertyId);
  if (!visit) {
    return { ok: false, error: "That home is past its 72-hour window now. Call the office and we'll add it." };
  }

  const { error } = await fieldDb().from('work_slips').insert({
    property_id: propertyId,
    title: title.slice(0, 200),
    description: description ? description.slice(0, 4000) : null,
    location: location ? location.slice(0, 200) : null,
    category: 'maintenance',
    priority,
    status: 'open',
    photo_urls: photoUrls,
    created_by_email: contractor.email,
    reported_by_contractor_id: contractor.id,
    reported_from_packet_id: visit.packetId,
  });
  if (error) return { ok: false, error: 'Could not file that just now. Try again, or text the office.' };

  await logEvent({
    packetId: visit.packetId,
    contractorId: contractor.id,
    actorEmail: contractor.email,
    propertyId,
    eventType: 'field_slip_reported',
    payload: { title: title.slice(0, 200), priority },
  });

  // Refresh the report page + home so "Flag another" reflects the current
  // window (a home whose 72h just elapsed drops out) rather than a cached list.
  revalidatePath('/field/report');
  revalidatePath('/field');

  return { ok: true, home: visit.propertyName };
}

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

/** First real activity on a claimed packet (a stop started, a job completed)
 *  moves it claimed -> in_progress. Guarded on the current status in the query
 *  so it's a no-op once already in progress and can never resurrect a
 *  submitted/approved packet. One place instead of the same block inline. */
async function advancePacketToInProgress(packetId: string): Promise<void> {
  await fieldDb()
    .from('inspection_packets')
    .update({ status: 'in_progress' })
    .eq('id', packetId)
    .eq('status', 'claimed');
}

/** Finish onboarding: record W9-on-file + the signed agreement and flip the
 *  contractor to active so they can claim. */
export type OnboardingState = { error: string };

export async function completeOnboarding(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const contractor = await resolveContractorFromCookie();
  if (!contractor) redirect('/field');

  const signedName = String(formData.get('signed_name') || '').trim();
  const agree = formData.get('agree') === 'on';
  const smsOptIn = formData.get('sms_opt_in') === 'on';
  const phone = String(formData.get('phone') || '').trim();
  const fullName = String(formData.get('full_name') || '').trim();
  if (!agree) return { error: 'Check the box agreeing to the contractor terms.' };
  if (signedName.length < 3) return { error: 'Type your full name at the bottom to sign.' };

  // W-9 (stored locked + encrypted; see field-w9). Must save cleanly before we
  // mark the contractor onboarded.
  const { ip: signIp } = await reqContext();
  const w9Error = await saveW9(contractor.id, {
    legalName: String(formData.get('w9_legal_name') || ''),
    businessName: String(formData.get('w9_business_name') || ''),
    taxClassification: String(formData.get('w9_tax_classification') || ''),
    addressLine: String(formData.get('w9_address') || ''),
    city: String(formData.get('w9_city') || ''),
    state: String(formData.get('w9_state') || ''),
    zip: String(formData.get('w9_zip') || ''),
    tinType: String(formData.get('w9_tin_type') || '') === 'ein' ? 'ein' : 'ssn',
    tin: String(formData.get('w9_tin') || ''),
    signedName,
    signedIp: signIp,
  });
  if (w9Error) return { error: w9Error };

  // How to pay them (record-keeping; Helm doesn't move money).
  const payErr = await savePayment(
    contractor.id,
    String(formData.get('payment_method') || ''),
    String(formData.get('payment_details') || ''),
  );
  if (payErr) return { error: payErr };

  // Geocode a home base for the marketplace's "near you" ranking, derived
  // from the W-9 city/state/ZIP the contractor just entered — the form used
  // to ask for a separate "home base (town or ZIP)" that duplicated it.
  // Deliberately town-level (no street line): coarse coords are all ranking
  // needs, and we don't store house-precision coordinates on the contractor
  // row. Best-effort: a failed lookup just leaves coords null (no ranking),
  // and an implausible hit (>150 mi from HQ) stores nothing rather than an
  // absurd mis-geocode — city+state+ZIP make the old wrong-state problem
  // (one real inspector's bare town landed 472 mi away) unlikely, but the
  // guard stays.
  const HQ = { lat: 42.6209, lng: -70.645 };
  const PLAUSIBLE_COMMUTE_MILES = 150;
  let homeLat = contractor.home_lat;
  let homeLng = contractor.home_lng;
  const homeTown = [
    String(formData.get('w9_city') || '').trim(),
    `${String(formData.get('w9_state') || '').trim()} ${String(formData.get('w9_zip') || '').trim()}`.trim(),
  ].filter(Boolean).join(', ');
  if (homeTown) {
    const best = await geocodeAddress(homeTown);
    if (best && haversineMiles(HQ, best) <= PLAUSIBLE_COMMUTE_MILES) {
      homeLat = best.lat;
      homeLng = best.lng;
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
      sms_opt_in: smsOptIn,
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

  // Throttle a contractor whose reliability has genuinely cratered — but only
  // once there's enough history to be fair (a rough patch for a proven worker,
  // not a new inspector). Real no-show/rework pattern → can't claim new work
  // until the office sorts it out.
  const rel = (await getContractorReliability()).get(contractor.id);
  if (rel && rel.completed >= 10 && rel.score != null && rel.score < 35) {
    redirect(`/field/packet/${packetId}?blocked=1`);
  }

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

/** Save the contractor's profile photo URL (uploaded via /api/field/upload). */
export async function saveProfilePhoto(url: string): Promise<void> {
  const contractor = await resolveContractorFromCookie();
  if (!contractor) return;
  await fieldDb()
    .from('contractors')
    .update({ photo_url: url || null, updated_at: new Date().toISOString() })
    .eq('id', contractor.id);
  revalidatePath('/field');
}

/** Toggle the "text me when new work is posted" preference (opt-out; default on).
 *  notifyContractorsOfPacket gates the blast on this. */
export async function setSmsOptIn(optIn: boolean): Promise<{ ok: boolean }> {
  const contractor = await resolveContractorFromCookie();
  if (!contractor) return { ok: false };
  await fieldDb()
    .from('contractors')
    .update({ sms_opt_in: optIn, updated_at: new Date().toISOString() })
    .eq('id', contractor.id);
  revalidatePath('/field/profile');
  return { ok: true };
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
  if (!isWorkingStatus(packet.status)) redirect(`/field/packet/${packetId}`);

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
    .update({
      inspection_id: inspectionId,
      status: 'in_progress',
      // Start tap = intent. 'both' if the lock already recorded their code first
      // (rare); otherwise 'self'. The Seam recorder upgrades 'self' -> 'both'.
      started_at: new Date().toISOString(),
      arrival_source: stop.arrived_verified_at ? 'both' : 'self',
    })
    .eq('id', stopId);
  await advancePacketToInProgress(packetId);
  await logEvent({
    packetId,
    contractorId: contractor.id,
    actorEmail: contractor.email,
    eventType: 'stop_started',
    propertyId: stop.property_id,
  });

  redirect(`/field/inspect/${inspectionId}`);
}

/** Undo an accidental Start: allowed only while the inspection is completely
 *  untouched (no marks, notes, or slips) — any real work means finish it or
 *  call the office. Unlinks and deletes the empty inspection, returns the stop
 *  to pending (clearing the on-site clock and the office "On site" signal),
 *  and reverts the packet to claimed when nothing else has begun. */
/**
 * Reopen a stop the inspector closed out by mistake, while the trip is still
 * theirs (claimed / in_progress, before submit). Their work is PRESERVED — the
 * deck resumes with every mark, note, and photo intact; only the "finished"
 * stamp comes off. Once the packet is submitted the office owns it, so that
 * path is request-changes, not self-serve.
 */
export async function reopenStop(formData: FormData) {
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
  if (!isWorkingStatus(packet.status)) redirect(`/field/packet/${packetId}`);

  const { data: sData } = await fieldDb()
    .from('packet_stops')
    .select('id, status, inspection_id, property_id')
    .eq('id', stopId)
    .eq('packet_id', packetId)
    .maybeSingle();
  const stop = sData as { id: string; status: string; inspection_id: string | null; property_id: string | null } | null;
  if (!stop || stop.status !== 'complete') redirect(`/field/packet/${packetId}`);

  if (stop.inspection_id) {
    // Completing an inspection auto-files one restock slip per low supply. Drop
    // the ones still untouched (open) so re-completing recreates them cleanly
    // instead of doubling them up. An already-actioned slip is left alone.
    await fieldDb()
      .from('work_slips')
      .delete()
      .eq('inspection_id', stop.inspection_id)
      .not('from_supply_key', 'is', null)
      .eq('status', 'open');
    // Un-finalize: the marks stay, the finished stamp + tallies come off and
    // are recomputed when they complete again.
    await fieldDb()
      .from('inspections')
      .update({ completed_at: null, total_items: null, pass_count: null, issue_count: null, na_count: null })
      .eq('id', stop.inspection_id);
  }

  await fieldDb().from('packet_stops').update({ status: 'in_progress', completed_at: null }).eq('id', stopId);
  await logEvent({
    packetId,
    contractorId: contractor.id,
    actorEmail: contractor.email,
    eventType: 'stop_reopened',
    propertyId: stop.property_id ?? undefined,
  });
  revalidatePath(`/field/packet/${packetId}`);
  redirect(`/field/packet/${packetId}`);
}

export async function undoStartStop(formData: FormData) {
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
  if (!isWorkingStatus(packet.status)) redirect(`/field/packet/${packetId}`);

  const { data: sData } = await fieldDb()
    .from('packet_stops')
    .select('*')
    .eq('id', stopId)
    .eq('packet_id', packetId)
    .maybeSingle();
  const stop = sData as PacketStopRow | null;
  if (!stop || stop.status !== 'in_progress' || !stop.inspection_id) redirect(`/field/packet/${packetId}`);

  const [{ count: results }, { count: notes }, { count: slips }] = await Promise.all([
    fieldDb().from('inspection_results').select('id', { count: 'exact', head: true }).eq('inspection_id', stop.inspection_id),
    fieldDb().from('inspection_notes').select('id', { count: 'exact', head: true }).eq('inspection_id', stop.inspection_id),
    fieldDb().from('work_slips').select('id', { count: 'exact', head: true }).eq('inspection_id', stop.inspection_id),
  ]);
  if ((results ?? 0) > 0 || (notes ?? 0) > 0 || (slips ?? 0) > 0) {
    redirect(`/field/packet/${packetId}?resetblocked=1`);
  }

  const inspectionId = stop.inspection_id;
  await fieldDb()
    .from('packet_stops')
    .update({
      status: 'pending',
      inspection_id: null,
      started_at: null,
      // A lock-verified arrival is physical truth; only the tap resets.
      arrival_source: stop.arrived_verified_at ? 'lock' : null,
    })
    .eq('id', stopId);
  await fieldDb().from('inspections').delete().eq('id', inspectionId);

  const { data: others } = await fieldDb()
    .from('packet_stops')
    .select('status, started_at')
    .eq('packet_id', packetId);
  const anyBegun = ((others ?? []) as { status: string; started_at: string | null }[]).some(
    (o) => o.started_at || ['in_progress', 'complete', 'skipped'].includes(o.status),
  );
  if (!anyBegun && packet.status === 'in_progress') {
    await fieldDb().from('inspection_packets').update({ status: 'claimed' }).eq('id', packetId);
  }
  await logEvent({
    packetId,
    contractorId: contractor.id,
    actorEmail: contractor.email,
    eventType: 'stop_start_undone',
    propertyId: stop.property_id,
  });
  revalidatePath(`/field/packet/${packetId}`);
  redirect(`/field/packet/${packetId}`);
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
  if (!isWorkingStatus(packet.status)) redirect(`/field/packet/${packetId}`);

  const { data: sData } = await fieldDb()
    .from('packet_stops')
    .select('*')
    .eq('id', stopId)
    .eq('packet_id', packetId)
    .maybeSingle();
  const stop = sData as PacketStopRow | null;
  if (!stop || !stop.work_slip_id) redirect(`/field/packet/${packetId}`);
  // A completion note is optional now — a restock or a quick fix shouldn't be
  // gated on writing a paragraph. resolution_notes just stores whatever's there.

  const photos = (() => {
    try {
      const v = JSON.parse(String(formData.get('photo_urls') || '[]'));
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  })();

  // Contractor self-report records the resolution but does NOT close the slip —
  // it stays in_progress until the office approves the packet (then it goes
  // done). Prevents a self-reported "done" from being the terminal truth.
  await fieldDb()
    .from('work_slips')
    .update({
      status: 'in_progress',
      resolution_notes: note,
      photo_urls: photos,
      updated_at: new Date().toISOString(),
    })
    .eq('id', stop.work_slip_id);
  await fieldDb().from('packet_stops').update({ status: 'complete', completed_at: new Date().toISOString() }).eq('id', stopId);
  await advancePacketToInProgress(packetId);
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

/** Inspector marks an ATTACHED work slip done (an extra task the office put on a
 *  stop). Records the resolution on the slip (stays in_progress until office
 *  approval) and stamps the attachment's completed_at. Decoupled from
 *  packet_stops.status, so it never closes the stop or skips the inspection, and
 *  several attached slips complete independently. Advisory: does NOT gate submit. */
/** The shared body behind completing an attached one-off task: ownership +
 *  cross-packet IDOR guards, photo MERGE (never destroy the office's reference
 *  photos), slip -> in_progress + resolution, and a stamp on the attachment.
 *  Idempotent: an already-completed attachment (e.g. a stale packet-page tab
 *  firing after the in-flow card) is a no-op, never a clobber. Both the
 *  packet-page FormData action and the in-flow (Stepper) action call this. */
async function applyAttachedSlipCompletion(args: {
  contractor: { id: string; email: string };
  packetId: string;
  attachmentId: string;
  note: string;
  photoUrls: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: pData } = await fieldDb()
    .from('inspection_packets')
    .select('id, status, awarded_contractor_id')
    .eq('id', args.packetId)
    .maybeSingle();
  const packet = pData as { id: string; status: string; awarded_contractor_id: string | null } | null;
  if (!packet || packet.awarded_contractor_id !== args.contractor.id) return { ok: false, error: 'not-your-packet' };
  if (!isWorkingStatus(packet.status)) return { ok: false, error: 'packet-not-live' };

  const { data: aData } = await fieldDb()
    .from('packet_stop_work_slips')
    .select('id, work_slip_id, completed_at, packet_stops!inner(packet_id, property_id)')
    .eq('id', args.attachmentId)
    .maybeSingle();
  const att = aData as { id: string; work_slip_id: string; completed_at: string | null; packet_stops: { packet_id: string; property_id: string } } | null;
  if (!att || att.packet_stops.packet_id !== args.packetId) return { ok: false, error: 'bad-attachment' };
  if (att.completed_at) return { ok: true }; // already done — idempotent no-op

  const { data: cur } = await fieldDb().from('work_slips').select('photo_urls').eq('id', att.work_slip_id).maybeSingle();
  const existing = ((cur as { photo_urls: string[] } | null)?.photo_urls) ?? [];
  const mergedPhotos = [...new Set([...existing, ...args.photoUrls])];
  await fieldDb()
    .from('work_slips')
    .update({ status: 'in_progress', resolution_notes: args.note, photo_urls: mergedPhotos, updated_at: new Date().toISOString() })
    .eq('id', att.work_slip_id);
  // Guard the stamp so a race (two submits both seeing null) can't double-fire
  // the packet bump + audit event.
  const { data: stamped } = await fieldDb()
    .from('packet_stop_work_slips')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', args.attachmentId)
    .is('completed_at', null)
    .select('id')
    .maybeSingle();
  if (!stamped) return { ok: true }; // lost the race; already stamped elsewhere
  await advancePacketToInProgress(args.packetId);
  await logEvent({
    packetId: args.packetId,
    contractorId: args.contractor.id,
    actorEmail: args.contractor.email,
    eventType: 'attached_slip_completed',
    propertyId: att.packet_stops.property_id,
    payload: { attachment_id: args.attachmentId, work_slip_id: att.work_slip_id },
  });
  return { ok: true };
}

export async function completeAttachedSlip(formData: FormData) {
  const packetId = String(formData.get('packet_id') || '');
  const attachmentId = String(formData.get('attachment_id') || '');
  const note = String(formData.get('resolution') || '').trim();
  const contractor = await resolveContractorFromCookie();
  if (!contractor) redirect('/field');
  const photos = (() => {
    try {
      const v = JSON.parse(String(formData.get('photo_urls') || '[]'));
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  })();
  await applyAttachedSlipCompletion({ contractor: { id: contractor.id, email: contractor.email }, packetId, attachmentId, note, photoUrls: photos });
  revalidatePath(`/field/packet/${packetId}`);
  redirect(`/field/packet/${packetId}`);
}

/** Non-redirecting twin used INSIDE the inspection Stepper: an attached task
 *  woven into the deck as a trailing card is marked done here without ejecting
 *  the inspector back to the packet page. Returns a result the client reacts to. */
export async function completeAttachedSlipInFlow(input: {
  packetId: string;
  attachmentId: string;
  note: string;
  photoUrls: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const contractor = await resolveContractorFromCookie();
  if (!contractor) return { ok: false, error: 'not-signed-in' };
  const res = await applyAttachedSlipCompletion({
    contractor: { id: contractor.id, email: contractor.email },
    packetId: input.packetId,
    attachmentId: input.attachmentId,
    note: (input.note || '').trim(),
    photoUrls: Array.isArray(input.photoUrls) ? input.photoUrls.filter((x): x is string => typeof x === 'string') : [],
  });
  if (res.ok) revalidatePath(`/field/packet/${input.packetId}`);
  return res;
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

  const nowIso = new Date().toISOString();
  await fieldDb()
    .from('inspection_packets')
    .update({ status: 'submitted', submitted_at: nowIso })
    .eq('id', packetId);
  // Close out the last still-open stop's clock (the one the inspector was on when
  // they submitted, which never got a next-door-opening departure).
  await fieldDb()
    .from('packet_stops')
    .update({ departed_at: nowIso })
    .eq('packet_id', packetId)
    .is('departed_at', null)
    .not('arrived_verified_at', 'is', null);
  await logEvent({
    packetId,
    contractorId: contractor.id,
    actorEmail: contractor.email,
    eventType: 'submitted',
  });
  // Streak check: if this submit lands on day 5/10 of a consecutive-days run,
  // the bonus stamps onto THIS packet and the office gets a heads-up. Guarded
  // so a streak hiccup can never block a submit.
  try {
    const award = await maybeAwardStreakBonus(packetId);
    if (award) {
      await sendStreakBonusOfficeEmail(contractor, { id: packetId, title: packet.title }, award).catch(() => {});
    }
  } catch {
    // best-effort only
  }
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
