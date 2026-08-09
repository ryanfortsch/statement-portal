'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { fieldDb } from '@/lib/field-db';
import { planMaintenanceRuns } from '@/lib/maintenance-runs';
import { draftWorkOrderEmail } from '@/lib/work-order-email';
import { publishPacket } from '@/app/operations/packets/actions';

/** Run the classify + plan pass on demand from the Work board. */
export async function planRunsNow(): Promise<
  { ok: true; created: number; kept: number; noVacancy: number } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  try {
    const res = await planMaintenanceRuns();
    revalidatePath('/work');
    return {
      ok: true,
      created: res.runs.filter((r) => r.action === 'created').length,
      kept: res.runs.filter((r) => r.action === 'kept').length,
      noVacancy: res.noVacancy.length,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Publish a suggested run so the maintenance contractors can claim it.
 *  Thin wrapper over the packets module's publishPacket (which re-validates
 *  stops against current bookings before going live). publishPacket's
 *  status-guarded update can silently no-op (packet deleted by a replan,
 *  or already past draft), so verify the packet actually went live. */
export async function publishRun(packetId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!packetId) return { ok: false, error: 'No packet id' };
  try {
    const fd = new FormData();
    fd.set('packet_id', packetId);
    await publishPacket(fd);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  revalidatePath('/work');
  const { data } = await fieldDb().from('inspection_packets').select('status').eq('id', packetId).maybeSingle();
  const status = (data as { status: string } | null)?.status;
  if (!status) return { ok: false, error: 'This run was re-planned away — refresh the board' };
  if (status === 'draft' || status === 'cancelled') {
    return { ok: false, error: 'Publish did not go through (a guest may have booked the day) — check the packet' };
  }
  return { ok: true };
}

/** Create a Gmail DRAFT of an organized work-order email (jobs + labeled
 *  photos) for a set of slips, addressed to a roster recipient. FROM
 *  Dotti, CC Allie + Ryan — the operator reviews and sends in Gmail, the
 *  same rhythm as the statement workflow. */
export async function emailWorkOrder(args: {
  slipIds: string[];
  toName: string;
  toEmail: string;
  note?: string;
  visitDate?: string | null;
}): Promise<
  | { ok: true; draftUrl: string; mailbox: 'dotti' | 'shared'; jobCount: number; photoCount: number; warnings: string[] }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (!args.toName.trim()) return { ok: false, error: 'Who is this going to?' };
  try {
    const res = await draftWorkOrderEmail({
      slipIds: args.slipIds,
      toName: args.toName.trim(),
      toEmail: args.toEmail,
      note: args.note,
      visitDate: args.visitDate ?? null,
      sentByEmail: session.user.email,
    });
    if (res.ok) revalidatePath('/work');
    return res;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
