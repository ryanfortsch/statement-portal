import { NextRequest, NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron-auth';
import { hourET } from '@/lib/cleaner-digest';
import { sendMeetingReminders } from '@/lib/meetings';
import { REMINDER_HOUR_ET, inReminderWindow } from '@/lib/meetings-core';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/cron/meeting-reminders
 *
 * The evening before an important meeting (an owner or prospect sit-down
 * logged on the CRM contact page), text the operator from the RISING TIDE
 * 24/7 line. Same rail and recipient as the AirDNA reminder: DOTTI_PHONE,
 * or MEETING_REMINDER_PHONES when the team wants more than one phone.
 *
 * Scheduled at 21, 22 and 23 UTC (vercel.json). The route gates on the
 * Eastern clock so the text lands at 5 PM ET year round: during EDT the
 * 21:00 slot is 5 PM and the later two are retries; during EST 21:00 is
 * 4 PM and no-ops, 22:00 is 5 PM and sends. A send that fails keeps the
 * row unstamped, so the next slot retries (three attempts, then it stops
 * and the home feed card is the surface).
 *
 * The home feed shows today's and tomorrow's meetings whether or not a
 * text went out; this text is the belt, the card is the braces.
 *
 *   ?dry=1     compose and report, no claim, no send
 *   ?force=1   ignore the hour gate (a manual run from the dashboard)
 */
export async function GET(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const dry = url.searchParams.get('dry') === '1';
  const force = url.searchParams.get('force') === '1';

  const hour = hourET();
  if (!force && !dry && !inReminderWindow(hour)) {
    return NextResponse.json({ ok: true, skipped: 'wrong_hour', hourET: hour, sendHourET: REMINDER_HOUR_ET });
  }

  try {
    const sweep = await sendMeetingReminders({ dry });
    return NextResponse.json({ ok: true, dry, hourET: hour, ...sweep });
  } catch (err) {
    console.error('[cron/meeting-reminders]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
