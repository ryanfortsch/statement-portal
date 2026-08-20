'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { auth } from '@/auth';
import { fieldDb } from '@/lib/field-db';
import { planMaintenanceRuns, drainClassificationBacklog } from '@/lib/maintenance-runs';
import { draftWorkOrderEmail } from '@/lib/work-order-email';
import { publishPacket } from '@/app/fieldwork/packets/actions';

/** Plan runs on demand from the Work board.
 *
 *  Snappy by design: the synchronous part is pure queries (pool + calendar
 *  + draft reconcile) over already-triaged slips. The AI triage of any
 *  untriaged backlog runs AFTER the response via after() — with a big
 *  backlog (176 imported slips on first ship) the drain takes minutes and
 *  the button was sitting on all of it. The board is force-dynamic, so
 *  the next refresh simply shows whatever the background pass produced. */
export async function planRunsNow(): Promise<
  | { ok: true; created: number; kept: number; noVacancy: number; classifying: number }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  try {
    const res = await planMaintenanceRuns({ skipClassify: true });

    const { count } = await fieldDb()
      .from('work_slips')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .eq('category', 'maintenance')
      .is('run_scope', null);
    const classifying = count ?? 0;
    if (classifying > 0) {
      // Background: drain triage, then re-plan so freshly classified slips
      // land on runs without another click.
      after(async () => {
        try {
          await drainClassificationBacklog(4);
          await planMaintenanceRuns({ skipClassify: true });
        } catch (err) {
          console.error('[planRunsNow] background classify/plan failed', err);
        }
      });
    }

    revalidatePath('/work');
    return {
      ok: true,
      created: res.runs.filter((r) => r.action === 'created').length,
      kept: res.runs.filter((r) => r.action === 'kept').length,
      noVacancy: res.noVacancy.length,
      classifying,
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

/** After the work order goes out and the vendor confirms the day, stamp
 *  every included slip in one click: status Scheduled, due on the visit
 *  day, labeled with the vendor. The board then shows who has each job
 *  and when, Due Today picks them up on the day, and a missed day flips
 *  them to OVERDUE — the built-in chase signal. Never resurrects done or
 *  dismissed slips. */
export async function markRunScheduled(args: {
  slipIds: string[];
  scheduledDate: string | null;
  vendorName: string;
  vendorOrganization?: string | null;
}): Promise<{ ok: true; updated: number; label: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.email) return { ok: false, error: 'Not signed in' };
  if (args.slipIds.length === 0) return { ok: false, error: 'No slips to schedule' };
  const name = args.vendorName.trim();
  if (!name) return { ok: false, error: 'No vendor name' };
  const date = (args.scheduledDate || '').trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'Bad date' };
  const org = args.vendorOrganization?.trim();
  const label = `Vendor: ${name}${org ? ` (${org})` : ''}`;

  const { data, error } = await fieldDb()
    .from('work_slips')
    .update({
      status: 'scheduled',
      scheduled_date: date || null,
      assigned_to_label: label,
    })
    .in('id', args.slipIds)
    .in('status', ['open', 'in_progress', 'scheduled'])
    .select('id');
  if (error) return { ok: false, error: error.message };
  revalidatePath('/work');
  revalidatePath('/work/maintenance');
  return { ok: true, updated: (data ?? []).length, label };
}
