import { NextRequest, NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { mineCheckoutChanges } from '@/lib/mine-checkout-changes';
import { detectExtensionHolds } from '@/lib/extension-holds';
import { upsertDigestDraft, expireStaleDigests, tomorrowET } from '@/lib/cleaner-digest';
import { ingestVendorAppointments } from '@/lib/vendor-schedule';

/**
 * Daily cleaner-schedule digest draft (the day BEFORE, afternoon ET).
 *
 * Two passes in one cron:
 *   1. Mine recent guest threads for agreed checkout changes (late
 *      checkouts, extensions) into checkout_adjustments - the "aware"
 *      layer that keeps the schedule ahead of Guesty.
 *   2. Build tomorrow's schedule from the merged truth and draft the
 *      digest SMS as a pending cleaner_schedule_digests row.
 *
 * NOTHING SENDS FROM HERE. The draft surfaces as a card on
 * /cleaner-messaging; the operator approves (and can edit) there, and
 * only that click texts Rosa via Quo. That approval gate is why this
 * cron can run at a draft-friendly hour without any quiet-hours logic.
 *
 * Also expires pending digests whose day already passed (never approved
 * means never sent - the card should not offer yesterday).
 *
 * Manual params:
 *   ?date=YYYY-MM-DD  draft a specific service date (default tomorrow ET)
 *   ?skip_mine=1      skip the AI thread pass (holds + draft only, fast)
 *   ?dry=1            report what would be drafted without writing
 */
export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

async function handle(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const dry = url.searchParams.get('dry') === '1';
  const skipMine = url.searchParams.get('skip_mine') === '1';
  const serviceDate = url.searchParams.get('date') || tomorrowET();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
    return NextResponse.json({ error: 'bad date' }, { status: 400 });
  }

  const expired = dry ? 0 : await expireStaleDigests(supabase);

  // Deterministic first: a paid extension held in the Guesty calendar is
  // hard data, and it must land whether or not the concierge (and so the
  // AI thread miner) is reachable at all.
  let holds = null;
  if (!dry) {
    try {
      holds = await detectExtensionHolds(supabase);
    } catch (err) {
      holds = { errors: [err instanceof Error ? err.message : String(err)] };
    }
  }

  // The cleaning vendor's own Jobber reminders, sitting unread in
  // quo_events. Parsed here so /turnovers/schedule can show whether A-1
  // agrees with us before a cleaner walks into an occupied house.
  let vendor = null;
  if (!dry) {
    try {
      vendor = await ingestVendorAppointments(supabase);
    } catch (err) {
      vendor = { errors: [err instanceof Error ? err.message : String(err)] };
    }
  }

  let mine = null;
  if (!skipMine && !dry) {
    try {
      mine = await mineCheckoutChanges(supabase);
    } catch (err) {
      // The digest must still draft when the miner (concierge or gateway)
      // is down - the schedule is just Guesty + operator adjustments then.
      mine = { errors: [err instanceof Error ? err.message : String(err)] };
    }
  }

  if (dry) {
    const { buildCheckoutSchedule } = await import('@/lib/checkout-schedule');
    const { composeDigestBody } = await import('@/lib/cleaner-digest');
    const [day] = await buildCheckoutSchedule(supabase, { startDate: serviceDate, days: 1 });
    return NextResponse.json({ ok: true, dry: true, serviceDate, counts: day.counts, body: composeDigestBody(day) });
  }

  const { digest, day } = await upsertDigestDraft(supabase, serviceDate);
  return NextResponse.json({
    ok: true,
    serviceDate,
    digestId: digest.id,
    digestStatus: digest.status,
    counts: day.counts,
    expired,
    vendor,
    holds,
    mine,
  });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
