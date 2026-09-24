import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin as supabase, isServiceConfigured as isConfigured } from '@/lib/supabase-admin';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { buildCheckoutSchedule, todayET } from '@/lib/checkout-schedule';

/**
 * Service-created turnover notes - stay-concierge's write path into the
 * cleaners' schedule message.
 *
 * Dotti, 2026-09-24, on Lisa Gruber's 16 Waterman message asking that the
 * crew bring in the deck furniture before a storm: "it would be great to
 * also create a note for the cleaners that is lumped into their cleaner
 * schedule message on the appropriate day (i.e. saturday in this instance
 * as that is when they are checking out)."
 *
 * The concierge knows WHAT the owner asked for. It does not know which day
 * the crew is next at the house: that lives in Helm's checkout schedule,
 * behind the adjustment overlay, the ghost guards and the extension holds.
 * So the caller sends the note and Helm resolves the day, which keeps the
 * one authority over "when is the turnover" in the one place that has it.
 *
 * Notes land 'added', not 'proposed'. The operator already approved this on
 * the owner card, and the digest it joins cannot send without its own
 * approval, so a second tap would be the same decision asked twice. It
 * still shows on the cleaner card with a Remove button.
 *
 * Auth: STAY_CONCIERGE_KEY shared secret, same plane as /api/work-slips.
 * The path is allowlisted in src/proxy.ts PUBLIC_API_PREFIXES; without that
 * the SSO middleware 401s a sessionless caller before this handler runs.
 *
 * Idempotency: `source_key` is unique on the table. A replay returns
 * already_recorded rather than a second line in the crew's message.
 *
 *   POST /api/turnover-notes
 *   { property_id, note_en, note_pt, source_key,
 *     evidence?, category?, service_date? }
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** How far ahead to look for the next time the crew is at this house. A
 *  storm note filed for a property with no checkout inside two weeks is not
 *  a turnover note; it is a work slip, which the owner card files anyway. */
const HORIZON_DAYS = 14;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_CATEGORIES = new Set([
  'breakage',
  'spill',
  'pet',
  'trash',
  'left_behind',
  'access',
  'other',
]);

type Payload = {
  property_id?: string;
  note_en?: string;
  note_pt?: string;
  source_key?: string;
  evidence?: string;
  category?: string;
  service_date?: string;
};

/** The next day the crew is at this property, and the stay they are
 *  cleaning up after. Null when nothing is on the schedule inside the
 *  horizon. */
async function nextTurnover(
  propertyId: string,
): Promise<{ date: string; checkIn: string | null } | null> {
  const days = await buildCheckoutSchedule(supabase, {
    startDate: todayET(),
    days: HORIZON_DAYS,
  });
  for (const day of days) {
    const row = day.rows.find((r) => r.propertyId === propertyId);
    if (row) return { date: day.date, checkIn: row.checkIn || null };
  }
  return null;
}

export async function POST(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  if (!isConfigured) {
    return NextResponse.json({ error: 'helm db not configured' }, { status: 503 });
  }

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const propertyId = (body.property_id || '').trim();
  const noteEn = (body.note_en || '').trim();
  const notePt = (body.note_pt || '').trim();
  const sourceKey = (body.source_key || '').trim();
  if (!propertyId || !noteEn || !notePt || !sourceKey) {
    return NextResponse.json(
      { error: 'property_id, note_en, note_pt and source_key are required' },
      { status: 400 },
    );
  }

  // An explicit day wins; otherwise Helm works out when the crew is next
  // there. A schedule that cannot be READ is unknown, never empty, so a
  // failure here is a 503 the caller can retry and raise, not a silent
  // "no turnover" that drops the note on the floor.
  let serviceDate = DATE_RE.test(body.service_date || '') ? (body.service_date as string) : '';
  let stayCheckIn: string | null = null;
  if (!serviceDate) {
    let found: { date: string; checkIn: string | null } | null;
    try {
      found = await nextTurnover(propertyId);
    } catch (err) {
      return NextResponse.json(
        { error: `schedule unavailable: ${(err as Error).message}` },
        { status: 503 },
      );
    }
    if (!found) {
      // Not an error. The house simply has nobody leaving inside the
      // horizon, so there is no cleaning day to hang this on.
      return NextResponse.json({
        ok: false,
        reason: 'no_upcoming_turnover',
        property_id: propertyId,
        horizon_days: HORIZON_DAYS,
      });
    }
    serviceDate = found.date;
    stayCheckIn = found.checkIn;
  }

  const category = ALLOWED_CATEGORIES.has((body.category || '').trim())
    ? (body.category as string).trim()
    : 'other';

  const { data, error } = await supabase
    .from('cleaner_turnover_notes')
    .insert({
      property_id: propertyId,
      service_date: serviceDate,
      stay_check_in: stayCheckIn,
      source: 'owner_message',
      source_key: sourceKey,
      note_pt: notePt.slice(0, 600),
      note_en: noteEn.slice(0, 600),
      evidence: (body.evidence || '').slice(0, 1000) || null,
      category,
      confidence: 'high',
      // The operator approved this on the owner card. The digest still
      // needs its own approval before it reaches a phone.
      status: 'added',
    })
    .select('id')
    .single();

  if (error) {
    // 23505 = the unique source_key. A replay of the same owner card must
    // not put a second copy of the line in the crew's message.
    if (error.code === '23505') {
      return NextResponse.json({ ok: true, status: 'already_recorded', service_date: serviceDate });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  revalidatePath('/cleaner-messaging');
  revalidatePath('/turnovers/schedule');
  return NextResponse.json({
    ok: true,
    status: 'created',
    id: data?.id ?? null,
    service_date: serviceDate,
    property_id: propertyId,
  });
}
