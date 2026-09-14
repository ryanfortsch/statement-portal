import { NextRequest, NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron-auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { mineCheckoutChanges } from '@/lib/mine-checkout-changes';
import { detectExtensionHolds } from '@/lib/extension-holds';
import { upsertDigestDraft, expireStaleDigests, tomorrowET, hourET } from '@/lib/cleaner-digest';
import { ingestVendorAppointments } from '@/lib/vendor-schedule';
import { mineTurnoverNotes } from '@/lib/turnover-notes';

/**
 * Daily cleaner-schedule digest draft (the day BEFORE, afternoon ET).
 *
 * Two passes in one cron:
 *   1. Mine recent guest threads for agreed checkout changes (late
 *      checkouts, extensions) into checkout_adjustments - the "aware"
 *      layer that keeps the schedule ahead of Guesty.
 *   2. Mine those same threads for what the guests said about the state
 *      they are leaving the house in (broken glass in the grass, an
 *      animal in the trash) into cleaner_turnover_notes, PROPOSED only.
 *   3. Build tomorrow's schedule from the merged truth and draft the
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
 * Scheduled at BOTH 18:00 and 19:00 UTC, the same trick as the send cron.
 * Eastern is UTC-4 in summer and UTC-5 in winter, so exactly one of those
 * lands on DRAFT_HOUR_ET on any given date; the other sees the wrong local
 * hour and no-ops. Before this the single 20:00 UTC slot drafted at 4 PM
 * all summer and silently slid to 3 PM every November.
 *
 * Manual params:
 *   ?date=YYYY-MM-DD  draft a specific service date (default tomorrow ET)
 *   ?skip_mine=1      skip the AI thread pass (holds + draft only, fast)
 *   ?dry=1            report what would be drafted without writing
 *   ?force=1          ignore the hour gate (any explicit ?date or ?dry
 *                     run is treated as manual and skips the gate too)
 */
export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/** Local hour the draft lands, 24h Eastern. 2 PM: the morning's
 *  checkouts have cleared and there are four hours before the 6 PM
 *  auto-send to review it. (Dotti, 2026-09-14: moved up from 4 PM.) */
const DRAFT_HOUR_ET = 14;

async function handle(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const dry = url.searchParams.get('dry') === '1';
  const skipMine = url.searchParams.get('skip_mine') === '1';
  const force = url.searchParams.get('force') === '1';
  const explicitDate = url.searchParams.get('date');
  const serviceDate = explicitDate || tomorrowET();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
    return NextResponse.json({ error: 'bad date' }, { status: 400 });
  }

  // The DST gate. Only the unattended daily run is subject to it: an
  // operator asking for a specific date, a dry run, or ?force=1 is a
  // manual call and runs whenever it is made.
  const hour = hourET();
  const manual = force || dry || Boolean(explicitDate);
  if (!manual && hour !== DRAFT_HOUR_ET) {
    return NextResponse.json({ ok: true, skipped: 'wrong_hour', hourET: hour, draftHourET: DRAFT_HOUR_ET, serviceDate });
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

  // What the guests said about the mess they are leaving. Proposals only:
  // none of this reaches the crew until the operator taps Add on the card.
  let notes = null;
  if (!skipMine && !dry) {
    try {
      notes = await mineTurnoverNotes(supabase);
    } catch (err) {
      notes = { errors: [err instanceof Error ? err.message : String(err)] };
    }
  }

  if (dry) {
    const { buildCheckoutSchedule } = await import('@/lib/checkout-schedule');
    const { composeDigestBodyLive } = await import('@/lib/cleaner-digest');
    const [day] = await buildCheckoutSchedule(supabase, { startDate: serviceDate, days: 1 });
    return NextResponse.json({ ok: true, dry: true, serviceDate, counts: day.counts, body: await composeDigestBodyLive(supabase, day) });
  }

  // The draft is the last step and the one that reads the schedule. If it
  // cannot be built, say so plainly in the response (and to sync_status
  // readers via the 200 body) rather than 500ing the cron or, worse,
  // writing an empty draft that the card would show as a real day.
  try {
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
      notes,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      serviceDate,
      error: err instanceof Error ? err.message : String(err),
      expired,
      vendor,
      holds,
      mine,
      notes,
    });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
