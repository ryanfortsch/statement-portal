import { NextRequest, NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron-auth';
import { recordSyncResult } from '@/lib/sync-status';
import { planAutomations, dispatchDue } from '@/lib/automations';

/**
 * Message automations: planner plus dispatcher.
 *
 * GET or POST /api/cron/automations, every 15 minutes (vercel.json).
 *
 * The planner runs for every home with automations_enabled AND
 * calendar_authority = 'helm' (both flags, never inferred, so a Guesty-run
 * home never receives duplicates of Guesty's own automations): canonical
 * confirmed stays within 30 days, plus stays first seen in the last 24h for
 * booking_confirmed, upserted on UNIQUE(booking_id, automation_id). The
 * dispatcher claims due rows atomically, re-reads the stay, renders with
 * secrets masked and sends on the GUESTS line / Resend / the ops line, or
 * parks the row: awaiting_approval, configured_in_ota, skipped_no_contact.
 * Nothing here texts or emails the team; the property Automations tab and
 * the daily brief are the surface.
 *
 *   ?dry=1            plan and count without writing or sending
 *   ?property_id=X    scope both passes to one home
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function handle(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const dry = url.searchParams.get('dry') === '1' || url.searchParams.get('dry') === 'true';
  const propertyId = url.searchParams.get('property_id')?.trim() || null;
  const now = new Date();

  try {
    const plan = await planAutomations({ now, propertyId, dry });
    const dispatch = await dispatchDue({ now, propertyId, dry });
    const body = {
      ok: true,
      dry,
      property_id: propertyId,
      planned: plan.planned,
      dispatched: dispatch.sent,
      awaiting_approval: dispatch.awaiting_approval,
      skipped_no_contact: dispatch.skipped_no_contact,
      configured_in_ota: dispatch.configured_in_ota,
      failed: dispatch.failed,
      plan,
      dispatch,
      at: now.toISOString(),
    };
    if (!dry) {
      await recordSyncResult('automations', {
        processed: plan.planned + dispatch.claimed,
        failed: dispatch.failed,
        firstError: dispatch.firstError ?? undefined,
        result: {
          properties: plan.properties,
          bookings: plan.bookings,
          planned: plan.planned,
          inserted: plan.inserted,
          retimed: plan.retimed,
          stale: plan.stale,
          superseded: plan.superseded,
          claimed: dispatch.claimed,
          sent: dispatch.sent,
          awaiting_approval: dispatch.awaiting_approval,
          configured_in_ota: dispatch.configured_in_ota,
          skipped_no_contact: dispatch.skipped_no_contact,
          skipped_cancelled: dispatch.skipped_cancelled,
          skipped_dates_moved: dispatch.skipped_dates_moved,
          failed: dispatch.failed,
        },
      });
    }
    return NextResponse.json(body);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!dry) {
      await recordSyncResult('automations', { processed: 0, failed: 1, firstError: message }).catch(() => undefined);
    }
    return NextResponse.json({ ok: false, error: message, at: now.toISOString() }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
