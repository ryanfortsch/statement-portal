import 'server-only';
import { fieldDb } from '@/lib/field-db';
import { recomputePacketExpenses } from '@/lib/field-packets';
import { loadRecentVisits } from '@/lib/field-report';

/**
 * Out-of-pocket receipts and the payout that carries them.
 *
 * A receipt is money a contractor spent for a home (drain-o, a shower rod,
 * TP holders). It lives on a work slip as expense_cents and reaches their pay
 * only through a packet's expenses_cents. This module owns the two questions
 * every surface asks: which packet should carry a receipt, and which receipts
 * have no packet yet.
 *
 * Homing rules:
 *   - receipt_packet_id, when set, is the ONE packet the receipt counts toward
 *     (recomputePacketExpenses honors that on every path).
 *   - A receipt filed from a task completion or attached task rides that
 *     packet through the stop/attachment link. A post-visit report rides
 *     reported_from_packet_id. Neither needs receipt_packet_id unless that
 *     packet was already paid when the money showed up.
 *   - Anything else (a board slip, a late receipt on a paid packet) is OPEN
 *     until the office folds it into an unpaid packet from the approve screen.
 */

/** Same cap as every receipt rail: $500. */
export const RECEIPT_CAP_CENTS = 50_000;

/** Parse the "$ receipt total" form field into cents. 0 when blank or junk. */
export function parseReceiptDollars(raw: FormDataEntryValue | null | undefined): number {
  const n = Number(raw || 0);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n * 100), RECEIPT_CAP_CENTS) : 0;
}

/** Statuses whose payout can still take a receipt: unpaid and past the
 *  listing stage, so the money lands on a trip that is actually theirs. */
const HOMEABLE_STATUSES = ['claimed', 'in_progress', 'submitted', 'approved'];

/**
 * The packet whose payout should carry a receipt this contractor just
 * recorded at `propertyId`: their live packet with a stop at that home (they
 * are on the trip right now), else their most recent in-window visit there
 * (72h, the post-visit report's rule). Null when nothing qualifies; the
 * receipt stays open and the office homes it at the next approval.
 */
export async function resolveReceiptPacket(contractorId: string, propertyId: string): Promise<string | null> {
  const { data: live } = await fieldDb()
    .from('packet_stops')
    .select('packet_id, inspection_packets!inner(id, status, paid_at, awarded_contractor_id, visit_date)')
    .eq('property_id', propertyId)
    .eq('inspection_packets.awarded_contractor_id', contractorId)
    .in('inspection_packets.status', ['claimed', 'in_progress'])
    .is('inspection_packets.paid_at', null);
  type LiveRow = { packet_id: string; inspection_packets: { visit_date: string } | { visit_date: string }[] };
  const candidates = ((live ?? []) as unknown as LiveRow[])
    .map((r) => ({ packetId: r.packet_id, visitDate: (Array.isArray(r.inspection_packets) ? r.inspection_packets[0] : r.inspection_packets)?.visit_date ?? '' }))
    .sort((a, b) => b.visitDate.localeCompare(a.visitDate));
  if (candidates.length) return candidates[0].packetId;

  const visits = await loadRecentVisits(contractorId).catch(() => []);
  const visit = visits.find((v) => v.propertyId === propertyId);
  if (!visit) return null;
  const { data: pk } = await fieldDb().from('inspection_packets').select('id, status, paid_at').eq('id', visit.packetId).maybeSingle();
  const packet = pk as { id: string; status: string; paid_at: string | null } | null;
  if (!packet || packet.paid_at || !HOMEABLE_STATUSES.includes(packet.status)) return null;
  return packet.id;
}

export type OpenReceipt = {
  slipId: string;
  title: string;
  description: string | null;
  propertyId: string;
  propertyName: string;
  expenseCents: number;
  photoUrls: string[];
  createdAt: string;
  /** Where the money got stuck: a paid packet it was reported from, or nowhere. */
  priorPacket: { id: string; title: string; paidAt: string | null } | null;
};

/**
 * Receipts this contractor is owed that no unpaid payout carries: money on a
 * slip, no receipt_packet_id, and not riding a packet through a stop or an
 * attachment or an unpaid reported_from packet.
 */
export async function loadOpenReceipts(contractorId: string): Promise<OpenReceipt[]> {
  const { data } = await fieldDb()
    .from('work_slips')
    .select('id, title, description, property_id, expense_cents, photo_urls, created_at, reported_from_packet_id')
    .gt('expense_cents', 0)
    .is('receipt_packet_id', null)
    .or(`receipt_contractor_id.eq.${contractorId},and(receipt_contractor_id.is.null,reported_by_contractor_id.eq.${contractorId})`)
    .order('created_at', { ascending: true });
  type Row = {
    id: string;
    title: string;
    description: string | null;
    property_id: string;
    expense_cents: number;
    photo_urls: string[] | null;
    created_at: string;
    reported_from_packet_id: string | null;
  };
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];
  const slipIds = rows.map((r) => r.id);

  // Slips already riding a packet through a stop or an attachment count there.
  const [{ data: stops }, { data: attached }] = await Promise.all([
    fieldDb().from('packet_stops').select('work_slip_id, inspection_packets!inner(status)').in('work_slip_id', slipIds).neq('inspection_packets.status', 'cancelled'),
    fieldDb()
      .from('packet_stop_work_slips')
      .select('work_slip_id, packet_stops!inner(inspection_packets!inner(status))')
      .in('work_slip_id', slipIds)
      .neq('packet_stops.inspection_packets.status', 'cancelled'),
  ]);
  const riding = new Set<string>([
    ...((stops ?? []) as unknown as { work_slip_id: string }[]).map((r) => r.work_slip_id),
    ...((attached ?? []) as unknown as { work_slip_id: string }[]).map((r) => r.work_slip_id),
  ]);

  // A post-visit report rides its source packet while that packet is unpaid.
  const reportedIds = [...new Set(rows.map((r) => r.reported_from_packet_id).filter((v): v is string => !!v))];
  const packetById = new Map<string, { id: string; title: string; paid_at: string | null; status: string }>();
  if (reportedIds.length) {
    const { data: pk } = await fieldDb().from('inspection_packets').select('id, title, paid_at, status').in('id', reportedIds);
    for (const p of (pk ?? []) as { id: string; title: string; paid_at: string | null; status: string }[]) packetById.set(p.id, p);
  }

  const open = rows.filter((r) => {
    if (riding.has(r.id)) return false;
    const src = r.reported_from_packet_id ? packetById.get(r.reported_from_packet_id) : null;
    if (src && !src.paid_at && HOMEABLE_STATUSES.includes(src.status)) return false; // still riding it
    return true;
  });
  if (open.length === 0) return [];

  const { data: props } = await fieldDb().from('properties').select('id, name').in('id', [...new Set(open.map((r) => r.property_id))]);
  const nameById = new Map(((props ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));

  return open.map((r) => {
    const src = r.reported_from_packet_id ? packetById.get(r.reported_from_packet_id) : null;
    return {
      slipId: r.id,
      title: r.title,
      description: r.description,
      propertyId: r.property_id,
      propertyName: nameById.get(r.property_id) ?? r.property_id,
      expenseCents: r.expense_cents,
      photoUrls: r.photo_urls ?? [],
      createdAt: r.created_at,
      priorPacket: src ? { id: src.id, title: src.title, paidAt: src.paid_at } : null,
    };
  });
}

export type HomedReceipt = {
  slipId: string;
  title: string;
  propertyId: string;
  propertyName: string;
  expenseCents: number;
  photoUrls: string[];
};

/** Receipts the office (or the contractor's own filing) folded onto this
 *  packet's payout, so "+ $48.84 receipts" has a face. Stop and attachment
 *  receipts are not here; the inspection summary already shows those. */
export async function loadPacketReceipts(packetId: string): Promise<HomedReceipt[]> {
  const { data } = await fieldDb()
    .from('work_slips')
    .select('id, title, property_id, expense_cents, photo_urls')
    .eq('receipt_packet_id', packetId)
    .gt('expense_cents', 0)
    .order('created_at', { ascending: true });
  const rows = (data ?? []) as { id: string; title: string; property_id: string; expense_cents: number; photo_urls: string[] | null }[];
  if (rows.length === 0) return [];
  const { data: props } = await fieldDb().from('properties').select('id, name').in('id', [...new Set(rows.map((r) => r.property_id))]);
  const nameById = new Map(((props ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  return rows.map((r) => ({
    slipId: r.id,
    title: r.title,
    propertyId: r.property_id,
    propertyName: nameById.get(r.property_id) ?? r.property_id,
    expenseCents: r.expense_cents,
    photoUrls: r.photo_urls ?? [],
  }));
}

/**
 * Put a receipt on a packet's payout. Refuses a paid packet (its payout is a
 * record) and a packet that is not yet anyone's trip. Stamps who is owed when
 * the slip does not say, recomputes the packet, and leaves an audit event.
 * Idempotent: homing onto the packet it already rides is a no-op.
 */
export async function homeReceipt(args: {
  slipId: string;
  packetId: string;
  actorEmail?: string | null;
  contractorId?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const [{ data: pk }, { data: sl }] = await Promise.all([
    fieldDb().from('inspection_packets').select('id, status, paid_at, awarded_contractor_id').eq('id', args.packetId).maybeSingle(),
    fieldDb().from('work_slips').select('id, expense_cents, receipt_packet_id, receipt_contractor_id, reported_by_contractor_id').eq('id', args.slipId).maybeSingle(),
  ]);
  const packet = pk as { id: string; status: string; paid_at: string | null; awarded_contractor_id: string | null } | null;
  const slip = sl as { id: string; expense_cents: number | null; receipt_packet_id: string | null; receipt_contractor_id: string | null; reported_by_contractor_id: string | null } | null;
  if (!packet || !slip) return { ok: false, error: 'not-found' };
  if (packet.paid_at) return { ok: false, error: 'packet-paid' };
  if (!HOMEABLE_STATUSES.includes(packet.status)) return { ok: false, error: 'packet-not-live' };
  if (!slip.expense_cents || slip.expense_cents <= 0) return { ok: false, error: 'no-receipt' };
  const owed = slip.receipt_contractor_id ?? args.contractorId ?? slip.reported_by_contractor_id ?? packet.awarded_contractor_id;
  if (owed && packet.awarded_contractor_id && owed !== packet.awarded_contractor_id) return { ok: false, error: 'wrong-contractor' };
  if (slip.receipt_packet_id === packet.id) return { ok: true };

  const previous = slip.receipt_packet_id;
  await fieldDb()
    .from('work_slips')
    .update({ receipt_packet_id: packet.id, receipt_contractor_id: owed ?? null, updated_at: new Date().toISOString() })
    .eq('id', slip.id);
  await recomputePacketExpenses(packet.id).catch(() => {});
  if (previous) await recomputePacketExpenses(previous).catch(() => {});
  await fieldDb().from('packet_events').insert({
    packet_id: packet.id,
    contractor_id: owed ?? null,
    actor_email: args.actorEmail ?? null,
    event_type: 'receipt_homed',
    payload: { work_slip_id: slip.id, expense_cents: slip.expense_cents, ...(previous ? { moved_from_packet_id: previous } : {}) },
  });
  return { ok: true };
}

/** Take a receipt back off a packet's payout (a mis-click, or the office paid
 *  it another way). The receipt goes back to open; the packet recomputes. */
export async function unhomeReceipt(args: { slipId: string; actorEmail?: string | null }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: sl } = await fieldDb().from('work_slips').select('id, expense_cents, receipt_packet_id, receipt_contractor_id').eq('id', args.slipId).maybeSingle();
  const slip = sl as { id: string; expense_cents: number | null; receipt_packet_id: string | null; receipt_contractor_id: string | null } | null;
  if (!slip || !slip.receipt_packet_id) return { ok: false, error: 'not-homed' };
  const { data: pk } = await fieldDb().from('inspection_packets').select('id, paid_at').eq('id', slip.receipt_packet_id).maybeSingle();
  const packet = pk as { id: string; paid_at: string | null } | null;
  if (packet?.paid_at) return { ok: false, error: 'packet-paid' };
  await fieldDb().from('work_slips').update({ receipt_packet_id: null, updated_at: new Date().toISOString() }).eq('id', slip.id);
  await recomputePacketExpenses(slip.receipt_packet_id).catch(() => {});
  await fieldDb().from('packet_events').insert({
    packet_id: slip.receipt_packet_id,
    contractor_id: slip.receipt_contractor_id,
    actor_email: args.actorEmail ?? null,
    event_type: 'receipt_unhomed',
    payload: { work_slip_id: slip.id, expense_cents: slip.expense_cents },
  });
  return { ok: true };
}
