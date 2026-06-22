/**
 * Field end-to-end test harness.
 *
 * Seeds a self-contained slice you can drive through every side of the Field
 * flow: two fully-onboarded test contractors (one inspector, one maintenance)
 * with working portal links, a few test maintenance work slips, and one
 * published packet of each trade ready to claim. Everything is marked so the
 * reset removes exactly the test data (plus the legacy "Demo Inspector"), and
 * nothing real is touched.
 */
import 'server-only';
import { fieldDb } from '@/lib/field-db';
import { newPortalToken } from '@/lib/field-auth';
import { fieldBaseUrl } from '@/lib/field-notify';
import { loadFieldProperties, createMaintenancePacket } from '@/lib/field-packets';
import { priceCents } from '@/lib/field-pricing';
import { centroid, maxPairwiseMiles } from '@/lib/proximity';

const TEST_MARK = 'fieldtest@helm.local'; // created_by / invited_by marker for all test rows
const HQ = { lat: 42.6209, lng: -70.665 };
const LIVE_STATUSES = ['draft', 'published', 'claimed', 'in_progress', 'submitted'];

const TEST_CONTRACTORS: Array<{ email: string; full_name: string; trade: 'inspection' | 'maintenance' }> = [
  { email: 'fieldtest-inspector@helm.local', full_name: 'Tess Tester (inspection)', trade: 'inspection' },
  { email: 'fieldtest-maintenance@helm.local', full_name: 'Manny Tester (maintenance)', trade: 'maintenance' },
];

// A deliberately NOT-onboarded inspector: open its portal link to walk the real
// invite → W-9 + agreement → active journey a new Perfection inspector goes
// through. Re-seeding resets it back to 'invited' so you can re-test.
const ONBOARDING_TEST = {
  email: 'fieldtest-onboarding@helm.local',
  full_name: 'New Inspector (onboarding test)',
  trade: 'inspection' as const,
};
const ALL_TEST_EMAILS = [...TEST_CONTRACTORS.map((t) => t.email), ONBOARDING_TEST.email];

const TEST_SLIPS: Array<{ propIndex: number; title: string; action: string; location: string }> = [
  { propIndex: 0, title: '[TEST] Replace kitchen faucet aerator', action: 'Unscrew the aerator, clean or replace, test for leaks.', location: 'Kitchen' },
  { propIndex: 0, title: '[TEST] Re-caulk the master tub', action: 'Strip the old caulk and re-run the tub-to-tile seam.', location: 'Master bath' },
  { propIndex: 1, title: '[TEST] Tighten the back deck railing', action: 'Re-secure the loose top rail on the rear deck.', location: 'Exterior' },
];

function addDaysISO(n: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

export type FieldTestContractor = {
  id: string;
  full_name: string;
  email: string;
  trade: string;
  status: string;
  portal_token: string;
  onboarded: boolean;
};
export type FieldTestPacket = {
  id: string;
  title: string;
  trade: string;
  status: string;
  stop_count: number;
  posted_price_cents: number;
  visit_date: string;
};
export type FieldTestState = {
  seeded: boolean;
  contractors: FieldTestContractor[];
  openTestSlips: number;
  packets: FieldTestPacket[];
  baseUrl: string;
  hasLegacyDemo: boolean;
};

export async function loadFieldTestState(): Promise<FieldTestState> {
  const db = fieldDb();
  const { data: cons } = await db
    .from('contractors')
    .select('id, full_name, email, trade, status, portal_token, w9_on_file, agreement_signed_at')
    .in('email', ALL_TEST_EMAILS);
  const contractors: FieldTestContractor[] = (
    (cons ?? []) as Array<{
      id: string;
      full_name: string;
      email: string;
      trade: string;
      status: string;
      portal_token: string;
      w9_on_file: boolean;
      agreement_signed_at: string | null;
    }>
  ).map((c) => ({
    id: c.id,
    full_name: c.full_name,
    email: c.email,
    trade: c.trade,
    status: c.status,
    portal_token: c.portal_token,
    onboarded: c.status === 'active' && c.w9_on_file && !!c.agreement_signed_at,
  }));

  const { count: openTestSlips } = await db
    .from('work_slips')
    .select('id', { count: 'exact', head: true })
    .eq('created_by_email', TEST_MARK)
    .eq('status', 'open');

  const { data: pkts } = await db
    .from('inspection_packets')
    .select('id, title, trade, status, stop_count, posted_price_cents, visit_date')
    .eq('created_by_email', TEST_MARK)
    .order('created_at', { ascending: false });

  const { data: demo } = await db.from('contractors').select('id').eq('full_name', 'Demo Inspector').maybeSingle();

  return {
    seeded: contractors.length > 0,
    contractors,
    openTestSlips: openTestSlips ?? 0,
    packets: (pkts ?? []) as FieldTestPacket[],
    baseUrl: fieldBaseUrl(),
    hasLegacyDemo: !!demo,
  };
}

/** Idempotent: safe to run repeatedly. Onboards the test contractors, ensures
 *  the test work slips exist, and publishes one packet of each trade if none
 *  is currently live. */
export async function seedFieldTest(): Promise<void> {
  const db = fieldDb();
  const now = new Date().toISOString();

  // 1. Two onboarded test contractors (no phone, so no real SMS goes out).
  for (const t of TEST_CONTRACTORS) {
    const { data: existing } = await db.from('contractors').select('id').eq('email', t.email).maybeSingle();
    if (existing) {
      await db
        .from('contractors')
        .update({ status: 'active', w9_on_file: true, agreement_signed_at: now, trade: t.trade, updated_at: now })
        .eq('id', (existing as { id: string }).id);
    } else {
      await db.from('contractors').insert({
        full_name: t.full_name,
        email: t.email,
        trade: t.trade,
        status: 'active',
        portal_token: newPortalToken(),
        w9_on_file: true,
        agreement_signed_at: now,
        agreement_signed_name: 'Test Signature',
        home_lat: HQ.lat,
        home_lng: HQ.lng,
        service_radius_miles: 100,
        invited_by_email: TEST_MARK,
      });
    }
  }

  // 1b. A not-yet-onboarded inspector for testing the onboarding journey.
  //     Reset to 'invited' each seed so the W-9 + agreement form is walkable.
  {
    const { data: ex } = await db.from('contractors').select('id').eq('email', ONBOARDING_TEST.email).maybeSingle();
    if (ex) {
      await db
        .from('contractors')
        .update({
          status: 'invited',
          w9_on_file: false,
          agreement_signed_at: null,
          agreement_signed_name: null,
          home_lat: null,
          home_lng: null,
          trade: ONBOARDING_TEST.trade,
          updated_at: now,
        })
        .eq('id', (ex as { id: string }).id);
    } else {
      await db.from('contractors').insert({
        full_name: ONBOARDING_TEST.full_name,
        email: ONBOARDING_TEST.email,
        trade: ONBOARDING_TEST.trade,
        status: 'invited',
        portal_token: newPortalToken(),
        w9_on_file: false,
        invited_by_email: TEST_MARK,
      });
    }
  }

  // 2. Pick a few real ops properties (with coords) for the test work.
  const props = (await loadFieldProperties())
    .filter((p) => p.latitude != null && p.longitude != null)
    .sort((a, b) => a.id.localeCompare(b.id)) // stable pick across re-seeds
    .slice(0, 3);
  if (props.length === 0) return;

  // 3. Test maintenance work slips (idempotent by title + property).
  for (const s of TEST_SLIPS) {
    const prop = props[Math.min(s.propIndex, props.length - 1)];
    const { data: ex } = await db
      .from('work_slips')
      .select('id')
      .eq('title', s.title)
      .eq('property_id', prop.id)
      .maybeSingle();
    if (!ex) {
      await db.from('work_slips').insert({
        property_id: prop.id,
        title: s.title,
        action_summary: s.action,
        location: s.location,
        category: 'maintenance',
        priority: 'normal',
        status: 'open',
        assigned_to_type: 'unassigned',
        created_by_email: TEST_MARK,
      });
    }
  }

  // 4. One published packet of each trade, if none is currently live.
  const { data: liveTest } = await db
    .from('inspection_packets')
    .select('trade')
    .eq('created_by_email', TEST_MARK)
    .in('status', LIVE_STATUSES);
  const liveTrades = new Set(((liveTest ?? []) as { trade: string }[]).map((r) => r.trade));
  const visit = addDaysISO(3);

  if (!liveTrades.has('inspection')) {
    const insProps = props.slice(0, Math.min(2, props.length));
    const pts = insProps.map((p) => ({ lat: p.latitude!, lng: p.longitude! }));
    const spread = pts.length > 1 ? maxPairwiseMiles(pts) : 0;
    const cen = centroid(pts);
    const price = priceCents({
      basePrices: insProps.map((p) => p.inspection_base_price_cents),
      spreadMiles: spread,
      center: cen,
      isRush: false,
    });
    const { data: packet } = await db
      .from('inspection_packets')
      .insert({
        title: `[TEST] Inspection · ${insProps.length} ${insProps.length === 1 ? 'stop' : 'stops'}`,
        status: 'published',
        trade: 'inspection',
        visit_date: visit,
        window_start: visit,
        window_end: visit,
        claim_deadline: visit,
        centroid_lat: cen?.lat ?? null,
        centroid_lng: cen?.lng ?? null,
        max_pairwise_miles: spread,
        stop_count: insProps.length,
        posted_price_cents: price,
        auto_generated: false,
        created_by_email: TEST_MARK,
        published_at: now,
      })
      .select('id')
      .single();
    if (packet) {
      await db.from('packet_stops').insert(
        insProps.map((p, i) => ({
          packet_id: (packet as { id: string }).id,
          property_id: p.id,
          booking_id: null,
          work_slip_id: null,
          window_basis: 'vacant',
          prior_checkout: null,
          next_checkin: null,
          base_price_cents: p.inspection_base_price_cents,
          walk_order: i,
        })),
      );
    }
  }

  if (!liveTrades.has('maintenance')) {
    const { data: slips } = await db
      .from('work_slips')
      .select('id')
      .eq('created_by_email', TEST_MARK)
      .eq('status', 'open');
    const slipIds = ((slips ?? []) as { id: string }[]).map((s) => s.id);
    if (slipIds.length) {
      await createMaintenancePacket({
        workSlipIds: slipIds,
        visitDate: visit,
        createdByEmail: TEST_MARK,
        publish: true,
      });
    }
  }
}

/** Remove every test artifact (and the legacy "Demo Inspector" + its packets).
 *  Packets go before contractors because awarded_contractor_id has no cascade. */
export async function resetFieldTest(): Promise<{ packets: number; contractors: number; slips: number }> {
  const db = fieldDb();

  // The test + demo contractors.
  const { data: testCons } = await db.from('contractors').select('id, email').in('email', ALL_TEST_EMAILS);
  const { data: demoCons } = await db.from('contractors').select('id, email').eq('full_name', 'Demo Inspector');
  const conRows = [...((testCons ?? []) as { id: string; email: string }[]), ...((demoCons ?? []) as { id: string; email: string }[])];
  const conIds = [...new Set(conRows.map((c) => c.id))];
  const conEmails = [...new Set(conRows.map((c) => c.email))];

  // Packets: test-marked OR awarded to a test/demo contractor.
  const { data: byMark } = await db.from('inspection_packets').select('id').eq('created_by_email', TEST_MARK);
  let pktIds = ((byMark ?? []) as { id: string }[]).map((p) => p.id);
  if (conIds.length) {
    const { data: byAward } = await db.from('inspection_packets').select('id').in('awarded_contractor_id', conIds);
    pktIds = [...new Set([...pktIds, ...((byAward ?? []) as { id: string }[]).map((p) => p.id)])];
  }
  if (pktIds.length) await db.from('inspection_packets').delete().in('id', pktIds); // cascades stops + events

  // Inspections the test/demo contractors ran (no FK to clean them up otherwise).
  if (conEmails.length) await db.from('inspections').delete().in('inspector_email', conEmails);

  // Contractors (cascades their sessions).
  if (conIds.length) await db.from('contractors').delete().in('id', conIds);

  // Test work slips.
  const { data: slips } = await db.from('work_slips').delete().eq('created_by_email', TEST_MARK).select('id');

  return {
    packets: pktIds.length,
    contractors: conIds.length,
    slips: ((slips ?? []) as { id: string }[]).length,
  };
}
