import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase, isServiceConfigured as isConfigured } from '@/lib/supabase-admin';
import { getPropertyAccessMap } from '@/lib/property-access';
import { normalizeTime } from '@/lib/checkout-schedule';

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
  parking: string | null;
  trash_day: string | null;
  recycling_day: string | null;
  trash_notes: string | null;
  has_pack_n_play: boolean | null;
  has_high_chair: boolean | null;
  default_checkin_time: string | null;
  default_checkout_time: string | null;
};

type NoteRow = { property_id: string; title: string | null; body: string | null };

export async function GET(req: Request) {
  const expected = process.env.STAY_CONCIERGE_KEY;
  if (!expected) {
    return NextResponse.json({ error: 'sync disabled (no key configured)' }, { status: 503 });
  }
  const { searchParams } = new URL(req.url);
  const provided = searchParams.get('key') ?? req.headers.get('x-stay-concierge-key');
  if (provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isConfigured) {
    return NextResponse.json({ error: 'helm db not configured' }, { status: 503 });
  }

  const { data: props, error } = await supabase
    .from('properties')
    .select(
      'id, name, wifi_name, wifi_label, wifi_name_2, wifi_label_2, parking, trash_day, recycling_day, trash_notes, has_pack_n_play, has_high_chair, default_checkin_time, default_checkout_time',
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
  const { data: noteData } = await supabase
    .from('property_notes')
    .select('property_id, title, body')
    .eq('guest_facing', true)
    .is('resolved_at', null);
  const notesByProp = new Map<string, NoteRow[]>();
  for (const n of (noteData ?? []) as NoteRow[]) {
    if (!notesByProp.has(n.property_id)) notesByProp.set(n.property_id, []);
    notesByProp.get(n.property_id)!.push(n);
  }

  const clean = (v: string | null | undefined): string => (v ?? '').trim();

  const properties = rows.map((p) => {
    const acc = access.get(p.id);
    return {
      property_id: p.id,
      name: p.name,
      wifi_name: clean(p.wifi_name),
      wifi_password: clean(acc?.wifi_password),
      wifi_label: clean(p.wifi_label),
      wifi_name_2: clean(p.wifi_name_2),
      wifi_password_2: clean(acc?.wifi_password_2),
      wifi_label_2: clean(p.wifi_label_2),
      parking: clean(p.parking),
      trash_day: clean(p.trash_day),
      recycling_day: clean(p.recycling_day),
      trash_notes: clean(p.trash_notes),
      // Per-property check-in / checkout times, synced from each Guesty
      // listing's own defaults by /api/sync-guesty. These are the reason
      // this pair is here: the guest AI carries a portfolio-wide "checkout
      // is 11 AM" fact, and on 2026-08-24 it quoted that as "the standard"
      // to a guest at 3 Windward, whose real checkout is 10:00 -- handing
      // over an hour the cleaning schedule had not planned for. Three homes
      // (3 Windward, 3 South, 225 Washington) run 10:00, not 11:00.
      check_in_time: clean(p.default_checkin_time),
      check_out_time: clean(p.default_checkout_time),
      // On-site guest gear: lets the AI answer a pack-n-play / high-chair ask
      // with "it's already in the home" instead of promising to bring one.
      has_pack_n_play: p.has_pack_n_play === true,
      has_high_chair: p.has_high_chair === true,
      // Per-property default times, the same columns the cleaner checkout
      // schedule reads (filled from Guesty by sync-guesty, operator-editable
      // on /turnovers/schedule). Normalized through the schedule's own
      // normalizeTime so the guest AI can never quote a time the cleaner
      // schedule doesn't use (2026-08-24: the AI told a 3 Windward guest
      // "standard 11 AM checkout" when the property's default is 10:00).
      check_in_time: normalizeTime(p.default_checkin_time) ?? '',
      check_out_time: normalizeTime(p.default_checkout_time) ?? '',
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
