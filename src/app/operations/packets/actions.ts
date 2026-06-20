'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { fieldDb } from '@/lib/field-db';
import { newPortalToken } from '@/lib/field-auth';
import { suggestPackets, persistSuggestions, revalidatePacket } from '@/lib/field-packets';
import { sendInviteEmail } from '@/lib/field-notify';
import type { ContractorRow } from '@/lib/field-types';

async function staffEmail(): Promise<string> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');
  return session.user.email;
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

/** Record that the awarded contractor has been paid for an approved packet.
 *  Field's own ledger; the actual payment runs through QuickBooks/books. */
export async function markPacketPaid(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const packetId = String(formData.get('packet_id') || '');
  await fieldDb()
    .from('inspection_packets')
    .update({ paid_at: new Date().toISOString(), paid_by_email: email, updated_at: new Date().toISOString() })
    .eq('id', packetId)
    .eq('status', 'approved');
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
    .eq('id', packetId);
  revalidatePath(`/operations/packets/${packetId}`);
  revalidatePath('/operations/packets');
}

export async function approvePacket(formData: FormData): Promise<void> {
  const email = await staffEmail();
  const packetId = String(formData.get('packet_id') || '');
  await fieldDb()
    .from('inspection_packets')
    .update({
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by_email: email,
      updated_at: new Date().toISOString(),
    })
    .eq('id', packetId)
    .eq('status', 'submitted');
  await fieldDb().from('packet_events').insert({
    packet_id: packetId,
    actor_email: email,
    event_type: 'approved',
  });
  revalidatePath(`/operations/packets/${packetId}`);
  revalidatePath('/operations/packets');
}

export async function removeStop(formData: FormData): Promise<void> {
  await staffEmail();
  const packetId = String(formData.get('packet_id') || '');
  const stopId = String(formData.get('stop_id') || '');
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
  if (!fullName || !contractorEmail) return;

  const { data } = await fieldDb()
    .from('contractors')
    .insert({
      full_name: fullName,
      email: contractorEmail,
      phone,
      trade: 'inspection',
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
