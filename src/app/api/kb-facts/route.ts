import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase, isServiceConfigured as isConfigured } from '@/lib/supabase-admin';
import { getPropertyAccessMap } from '@/lib/property-access';
import { normalizeTime } from '@/lib/checkout-schedule';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { civicForProperty } from '@/lib/civic';
import type { HelmPropertyRow } from '@/lib/properties';

/**
 * Outbound sync endpoint: the guest-relevant property facts the stay-concierge
 * guest-messaging AI needs to answer questions like "what's the wifi?" without
 * punting. Helm is the source of truth for property data; the AI reads its own
 * local markdown knowledge base. This endpoint bridges the two: stay-concierge
 * polls it on a schedule and writes a managed section into each property's KB
 * so a fact entered on the Helm property page (wifi, parking, a guest note)
 * reaches the AI on the next sync.
 *
 * Auth: same STAY_CONCIERGE_KEY shared secret that gates owners-sync. One
 * shared key, two-way trust. Server-to-server only.
 *
 *   GET /api/kb-facts?key=<STAY_CONCIERGE_KEY>
 *
 * We deliberately include the wifi PASSWORD (from the RLS-locked
 * property_access table, read here via the service role) because guests need
 * it and the stay-concierge KB is a local, git-ignored, credential-holding
 * file, not an anon-readable surface. We deliberately DO NOT include door /
 * gate / garage / alarm / smart-lock codes: those are issued per-stay, not
 * blanket-shared, and the AI must never broadcast them.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type PropertyRow = {
  id: string;
  name: string;
  wifi_name: string | null;
  wifi_label: string | null;
  wifi_name_2: string | null;
  wifi_label_2: string | null;
  city: string | null;
  address: string | null;
  parking: string | null;
  trash_day: string | null;
  recycling_day: string | null;
  trash_notes: string | null;
  has_pack_n_play: boolean | null;
  has_high_chair: boolean | null;
  default_checkout_time: string | null;
  guesty_listing_id: string | null;
  // House policy (#1620). Guest-facing subset only: discount_stance is
  // deliberately absent, see the payload below.
  quiet_hours: string | null;
  max_occupancy: number | null;
  pet_policy: string | null;
  smoking_policy: string | null;
  cancellation_policy: string | null;
  house_rules: string | null;
};

type NoteRow = { property_id: string; title: string | null; body: string | null };

export async function GET(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  if (!isConfigured) {
    return NextResponse.json({ error: 'helm db not configured' }, { status: 503 });
  }

  const { data: props, error } = await supabase
    .from('properties')
    .select(
      'id, name, city, address, wifi_name, wifi_label, wifi_name_2, wifi_label_2, parking, trash_day, recycling_day, trash_notes, has_pack_n_play, has_high_chair, default_checkout_time, guesty_listing_id, quiet_hours, max_occupancy, pet_policy, smoking_policy, cancellation_policy, house_rules',
    )
    .eq('is_active', true);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = (props ?? []) as PropertyRow[];
  const ids = rows.map((r) => r.id);

  // Wifi passwords live in the RLS-locked property_access table (service role).
  const access = await getPropertyAccessMap(ids);

  // Guest-facing notes only (the operator's explicit "safe to tell a guest" flag).
  // Ordered so the payload is deterministic: without it, multi-note properties
  // came back in whichever row order the backend picked that request, and the
  // stay-concierge KB sync rewrote 16 Waterman's section on every 30-min pass.
  const { data: noteData } = await supabase
    .from('property_notes')
    .select('property_id, title, body')
    .eq('guest_facing', true)
    .is('resolved_at', null)
    .order('created_at', { ascending: true });
  const notesByProp = new Map<string, NoteRow[]>();
  for (const n of (noteData ?? []) as NoteRow[]) {
    if (!notesByProp.has(n.property_id)) notesByProp.set(n.property_id, []);
    notesByProp.get(n.property_id)!.push(n);
  }

  const clean = (v: string | null | undefined): string => (v ?? '').trim();

  const properties = rows.map((p) => {
    const acc = access.get(p.id);
    const civic = civicForProperty(p as unknown as HelmPropertyRow);
    return {
      property_id: p.id,
      name: p.name,
      // The concierge's fleet watch joins a new Guesty listing to its Helm
      // property on this id before scaffolding its knowledge base (2026-09-19).
      guesty_listing_id: p.guesty_listing_id ?? '',
      wifi_name: clean(p.wifi_name),
      wifi_password: clean(acc?.wifi_password),
      wifi_label: clean(p.wifi_label),
      wifi_name_2: clean(p.wifi_name_2),
      wifi_password_2: clean(acc?.wifi_password_2),
      wifi_label_2: clean(p.wifi_label_2),
      parking: clean(p.parking),
      // City is bridged so the guest AI can gate its own waste wording. It
      // could not before: the payload carried a collection day and no city,
      // so that side hardcodes the Gloucester rule and stays off Rockport and
      // Beverly only by the accident of their day being blank. Anything that
      // reads trash_day should read city beside it.
      city: clean(p.city).split(',')[0].trim(),
      // Resolved, not raw. The street table can answer for a home whose
      // trash_day column was never filled, and the printed Information Note
      // already prints that day. Sending the raw column left three live
      // Gloucester homes silent to the guest AI while their posted note in
      // the kitchen named a day.
      trash_day: clean(civic.trashDay),
      recycling_day: clean(civic.recyclingDay),
      trash_notes: clean(p.trash_notes),
      // The city's receptacle and set-out rule, resolved per request off the
      // cart cutover date. Helm owns this string so every surface says it the
      // same way. See src/lib/civic.ts.
      receptacle_rule: clean(civic.receptacleRule),
      // Per-property check-in / checkout times: the same columns the cleaner
      // checkout schedule reads (filled from each Guesty listing's defaults
      // by /api/sync-guesty, operator-editable on /turnovers/schedule),
      // normalized through the schedule's own normalizeTime so the guest AI
      // can never quote a time the cleaner schedule doesn't use. The reason
      // this pair is here: the guest AI carried a portfolio-wide "checkout
      // is 11 AM" fact, and on 2026-08-24 it quoted that as "the standard"
      // to a guest at 3 Windward, whose real checkout is 10:00 -- handing
      // over an hour the cleaning schedule had not planned for. Three homes
      // (3 Windward, 3 South, 225 Washington) run 10:00, not 11:00.
      // Checkout ONLY. `default_checkin_time` is deliberately NOT bridged:
      // #1293 repurposed that column as CLEANER guidance (15:00, the hour of
      // margin before the guest lands at 16:00), so sending it here would
      // have the guest AI tell guests 3 PM and put them at the door in the
      // middle of the turnover -- the exact thing the margin exists to
      // prevent. Guesty stays authoritative for what the GUEST is told about
      // arrival; Helm is authoritative for what the CLEANER is told. Checkout
      // is safe to bridge because it is still synced from each Guesty listing
      // and is genuinely what the guest is told (10:00 at four homes, 11:00
      // elsewhere).
      check_out_time: normalizeTime(p.default_checkout_time) ?? '',
      // On-site guest gear: lets the AI answer a pack-n-play / high-chair ask
      // with "it's already in the home" instead of promising to bring one.
      has_pack_n_play: p.has_pack_n_play === true,
      has_high_chair: p.has_high_chair === true,
      // House policy (#1620). Until these columns existed, a guest asking
      // "do you take dogs" or "what are the quiet hours" had no source on
      // the record, so the answer was invented or the guest was asked to
      // wait. The pet fee ambiguity at 30 Woodward ($200 or $250) is what
      // that costs.
      //
      // `discount_stance` is DELIBERATELY not here. It records what we will
      // and will not discount, which is our negotiating position, not a
      // guest fact. It belongs to the coaching loop, and a responder with
      // it in the KB would eventually quote it to the person it concerns.
      //
      // Empty string rather than null for the text fields, matching
      // check_out_time above: the consumer tests truthiness, so a missing
      // policy simply produces no line.
      quiet_hours: clean(p.quiet_hours),
      max_occupancy: p.max_occupancy ?? null,
      pet_policy: clean(p.pet_policy),
      smoking_policy: clean(p.smoking_policy),
      cancellation_policy: clean(p.cancellation_policy),
      house_rules: clean(p.house_rules),
      guest_notes: (notesByProp.get(p.id) ?? [])
        .map((n) => ({ title: clean(n.title), body: clean(n.body) }))
        .filter((n) => n.title || n.body),
    };
  });

  return NextResponse.json({
    properties,
    count: properties.length,
    generated_at: new Date().toISOString(),
  });
}
