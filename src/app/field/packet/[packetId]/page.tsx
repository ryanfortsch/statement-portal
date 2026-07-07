import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { resolveContractorFromCookie } from '@/lib/field-auth';
import { fieldDb } from '@/lib/field-db';
import { loadPacketDetail, loadPacketSupplyRun, staleStopIds, SUPPLY_CLOSET, SUPPLY_CLOSET_COORDS, SUPPLY_CLOSET_CODE, type SupplyRun } from '@/lib/field-packets';
import { canClaim, cityShort, fmtVisitTime, onboardingComplete, dollars, packetHeadline, type AccessBundle, type ContractorRow, type PacketStopDetail, type AttachedSlip } from '@/lib/field-types';
import { claimPacket, submitPacket, undoStartStop } from '../../actions';
import { PendingButton } from './PendingButton';
import { MaintenanceComplete } from './MaintenanceComplete';
import { StartStop } from './StartStop';
import { OnSite } from './OnSite';
import { FieldShell } from '../../FieldShell';
import { PacketRouteMap } from '../../PacketRouteMap';
import { CopyCode } from '../../CopyCode';
import { PhotoThumbs } from '@/components/PhotoUploader';
import { AutoRefresh } from '@/components/AutoRefresh';

// Office phone for the door-side "stuck? call us" fallbacks.
const OFFICE_TEL = '+19788652387';

/** A geocodable maps target for a stop, or null when we have neither coords nor
 *  a real street address (so we hide the link instead of sending them to a
 *  search for an internal name like "21 Horton"). */
function mapsUrl(s: PacketStopDetail): string | null {
  if (s.property.latitude != null && s.property.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${s.property.latitude},${s.property.longitude}`;
  }
  const addr = (s.property.address || '').trim();
  if (!addr) return null;
  const q = `${addr}${s.property.city ? `, ${s.property.city}` : ''}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Packet · Rising Tide Field',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

function fmtDate(d: string): string {
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  } catch {
    return d;
  }
}

function fmtShortDate(d: string): string {
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return d;
  }
}

/** Per-stop timing truth, driven by the bookings — not a fixed window. The day
 *  opens at the 11 AM checkout; the ONLY hard deadline is a guest checking in
 *  THAT day (4 PM); and a same-day checkout means the cleaner owns midday, so
 *  the inspector goes after. Already-cleaned homes are open from 11. */
function stopTiming(s: PacketStopDetail, visitDate: string): { label: string; urgent: boolean } {
  // Two facts, no coaching: did a guest check out today, and when's the next
  // check-in. The sequencing advice lives in the DayPlan banner up top; per
  // Dotti, the per-stop line stays this simple.
  const first = s.window_basis === 'checkout_day' ? 'Checkout today' : 'Already cleaned';
  if (!s.next_checkin) return { label: `${first} · no next check-in scheduled`, urgent: false };
  const today = s.next_checkin === visitDate;
  const when = today ? 'today, 4 PM' : `${fmtShortDate(s.next_checkin)}, 4 PM`;
  return { label: `${first} · next check-in: ${when}`, urgent: today };
}

/** The one question an inspector has before anything else: "do I have a hard
 *  finish time today?" Answered up front instead of leaving her to guess
 *  (Delaney had no way to know there were no check-ins on her visit day). */
function DayPlan({ stops, visitDate }: { stops: PacketStopDetail[]; visitDate: string }) {
  if (stops.length === 0) return null;
  const arriving = stops.filter((s) => s.next_checkin === visitDate).length;
  const turnovers = stops.filter((s) => s.window_basis === 'checkout_day').length;
  const cleanedFirst =
    turnovers > 0 && turnovers < stops.length
      ? ' Do the already-cleaned homes first, then swing back to the turnover after the cleaner wraps.'
      : '';
  if (arriving === 0) {
    return (
      <div style={{ borderLeft: '3px solid var(--positive, #2e7d4f)', background: 'rgba(46,125,79,0.06)', padding: '12px 14px', marginBottom: 22, fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 560 }}>
        <strong style={{ color: 'var(--ink)' }}>No guest check-ins this day: no hard finish time.</strong> Start
        anytime from 11 AM.{cleanedFirst}
      </div>
    );
  }
  return (
    <div style={{ borderLeft: '3px solid var(--signal)', background: 'rgba(200,90,58,0.06)', padding: '12px 14px', marginBottom: 22, fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 560 }}>
      <strong style={{ color: 'var(--signal)' }}>
        {arriving === stops.length
          ? `Guests check in at 4 PM at ${stops.length === 1 ? 'this home' : `all ${stops.length} homes`}.`
          : `${arriving} of ${stops.length} homes ${arriving === 1 ? 'gets a guest' : 'get guests'} at 4 PM.`}
      </strong>{' '}
      {arriving === stops.length ? 'Everything must be inspected by then.' : 'Those must be done by then; the rest are flexible.'}
      {cleanedFirst}
    </div>
  );
}

const INSPECTION_PILLARS: Array<{ n: number; title: string; desc: string }> = [
  {
    n: 1,
    title: 'Perfection',
    desc: "The home should look flawless: staged, spotless, guest-ready. You're the last set of eyes before anyone checks in.",
  },
  {
    n: 2,
    title: 'Maintenance',
    desc: 'Get ahead of problems. Flag anything worn, leaking, or drifting toward a repair so we fix it before a guest ever notices.',
  },
  {
    n: 3,
    title: 'Supplies & inventory',
    desc: "Check the essentials are stocked, and note whatever's running low so we can restock fast.",
  },
];

/** What an inspection visit actually is, in three plain passes — replaces the
 *  vague "guest-readiness walk / Helm Core 12" jargon. */
function InspectionScope() {
  return (
    <div style={{ marginBottom: 28, maxWidth: 560 }}>
      {INSPECTION_PILLARS.map((p) => (
        <div key={p.n} style={{ display: 'flex', gap: 16, alignItems: 'baseline', padding: '14px 0', borderTop: '1px solid var(--rule)' }}>
          <span className="font-serif" style={{ fontSize: 26, lineHeight: 1, color: 'var(--signal)', minWidth: 26 }}>{p.n}</span>
          <div>
            <div className="font-serif" style={{ fontSize: 18 }}>{p.title}</div>
            <div style={{ fontSize: 13.5, color: 'var(--ink-3)', marginTop: 3, lineHeight: 1.55 }}>{p.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}


/** Property setup, framed for the specialist walking in: a brand-new home
 *  joining the program, staged for photos and outfitted for guests. Rendered
 *  in place of the inspection pillars and the check-in day plan (a setup day
 *  has neither). */
function SetupScope() {
  return (
    <div style={{ borderLeft: '3px solid var(--signal)', background: 'rgba(200,90,58,0.06)', padding: '12px 14px', marginBottom: 22, fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 560 }}>
      <strong style={{ color: 'var(--ink)' }}>Property setup: plan 2 to 4 hours on site.</strong> A new home joining
      the program. Stage it so it&apos;s photo-ready and outfit it for guests. Anything unclear, call the office.
    </div>
  );
}

/** An extra work slip the office attached to a stop: title, details, the
 *  per-attachment office note, and (for the assigned inspector, until done) a
 *  completion form keyed to the attachment, not the stop. */
function AttachedSlipCard({ packetId, slip, isMine }: { packetId: string; slip: AttachedSlip; isMine: boolean }) {
  const done = !!slip.completedAt;
  return (
    <div style={{ borderTop: '1px solid var(--rule-soft)', paddingTop: 10, marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
        <div style={{ fontSize: 14, color: 'var(--ink)' }}>{slip.title}</div>
        {done && <span style={{ fontSize: 12, color: 'var(--positive)', flexShrink: 0 }}>✓ Done</span>}
      </div>
      {/* Deliberately spare at the door: title + where + what to bring + any
          office note. Priority and Supplies-Check provenance are office detail. */}
      {slip.location && (
        <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 3 }}>{slip.location}</div>
      )}
      {slip.bring_list && (
        <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 6 }}>
          <span style={{ color: 'var(--ink-4)' }}>Bring: </span>{slip.bring_list}
        </div>
      )}
      {slip.officeNote && (
        <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 6, borderLeft: '3px solid var(--tide)', background: 'rgba(78,124,158,0.06)', padding: '6px 10px', lineHeight: 1.5 }}>
          <span style={{ color: 'var(--tide-deep)', fontWeight: 600 }}>Note: </span>{slip.officeNote}
        </div>
      )}
      {slip.photo_urls && slip.photo_urls.length > 0 && <PhotoThumbs urls={slip.photo_urls} size={56} />}
      {isMine && !done && (
        <MaintenanceComplete packetId={packetId} attachmentId={slip.attachmentId} label="Mark done" />
      )}
    </div>
  );
}

/** The supply-closet entry code, tap-to-copy. Renders only when the code is
 *  configured (env var). Lives inside the supply cards, which only show to the
 *  assigned inspector who's on the job. */
function SupplyClosetCode() {
  if (!SUPPLY_CLOSET_CODE) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 14, marginBottom: 14 }}>
      <span style={{ color: 'var(--ink-4)' }}>Door code</span>
      <CopyCode value={SUPPLY_CLOSET_CODE} />
    </div>
  );
}

/** Stop 1 of every route: the supply closet at 85 Eastern Ave. The inspector
 *  grabs ONE bag, packed for the whole trip — the routine refills for every home
 *  on the route plus the parts each work slip needs. Helm names the trip the bag
 *  is packed for and lists the job-specific parts so nothing's left behind. */
function SupplyRunCard({ run }: { run: SupplyRun }) {
  const homes = run.bins.map((b) => b.propertyName);
  const restock = [...new Set(run.bins.flatMap((b) => b.lowItems))];
  // No early return: the kit pickup is stop 1 of EVERY route, even when
  // nothing specific is flagged — the bag itself always gets grabbed.
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${SUPPLY_CLOSET_COORDS.lat},${SUPPLY_CLOSET_COORDS.lng}`;
  return (
    <div style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '16px 18px', marginBottom: 24, background: 'rgba(0,0,0,0.015)' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--signal)', fontWeight: 600, marginBottom: 4 }}>
        Stop 1 · Supply closet
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          Grab your bag at <strong style={{ color: 'var(--ink)' }}>{SUPPLY_CLOSET}</strong>. One bag, packed for this whole trip.
        </div>
        <a href={mapsHref} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--signal)', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', border: '1px solid var(--rule)', borderRadius: 999, padding: '9px 16px', minHeight: 40, background: 'var(--paper-2, #fff)' }}>
          Directions →
        </a>
      </div>

      <SupplyClosetCode />

      {homes.length > 0 && (
        <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5, marginBottom: restock.length > 0 || run.jobs.length > 0 ? 12 : 0 }}>
          <span style={{ color: 'var(--ink-4)' }}>Packed for: </span>
          <span style={{ color: 'var(--ink)' }}>{homes.join(' · ')}</span>
        </div>
      )}

      {restock.length > 0 && (
        <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5, marginBottom: run.jobs.length > 0 ? 12 : 0 }}>
          <span style={{ color: 'var(--ink-4)' }}>Also restocking: </span>
          <span style={{ color: 'var(--signal)' }}>{restock.join(', ')}</span>
        </div>
      )}

      {run.jobs.length > 0 && (
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 8 }}>Job parts in the bag</div>
          <div style={{ display: 'grid', gap: 9 }}>
            {run.jobs.map((j, i) => (
              <div key={`${j.title}-${i}`} style={{ fontSize: 13, lineHeight: 1.5 }}>
                <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{j.bring}</span>
                <span style={{ color: 'var(--ink-4)' }}> · {j.title} ({j.propertyName})</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The last leg of every route: back to 85 Eastern to drop the kit off. Renders
 *  after the homes so the day reads closet → homes → closet. */
function KitReturnCard() {
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${SUPPLY_CLOSET_COORDS.lat},${SUPPLY_CLOSET_COORDS.lng}`;
  return (
    <div style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '16px 18px', marginTop: 18, background: 'rgba(0,0,0,0.015)' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--signal)', fontWeight: 600, marginBottom: 4 }}>
        Last stop · Supply closet
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          Drop your kit back at <strong style={{ color: 'var(--ink)' }}>{SUPPLY_CLOSET}</strong>: the bag and anything
          you pulled from a home, so it&apos;s packed and ready for the next trip.
        </div>
        <a href={mapsHref} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--signal)', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', border: '1px solid var(--rule)', borderRadius: 999, padding: '9px 16px', minHeight: 40, background: 'var(--paper-2, #fff)' }}>
          Directions →
        </a>
      </div>
      <div style={{ marginTop: 12 }}>
        <SupplyClosetCode />
      </div>
    </div>
  );
}

// Values like "No" / "None" carry no instruction — drop them so the inspector
// only sees fields that actually tell them something (no more "Alarm: No").
const ACCESS_NOISE = new Set(['no', 'none', 'n/a', 'na', '-', '--', 'false', '0', 'n']);
const ACCESS_CODE_LABELS = new Set(['Door code', 'Gate code', 'Garage code', 'Alarm code']);

function AccessLines({ a }: { a: AccessBundle }) {
  const rows: Array<[string, string | null]> = [
    ['Getting in', a.method],
    ['Door code', a.smartLock],
    ['Lockbox / key', a.lockboxLocation],
    ['Gate code', a.gateCode],
    ['Garage code', a.garageCode],
    ['Alarm code', a.alarm],
    ['Where to park', a.parking],
  ];
  const present = rows.filter(
    ([, v]) => v && String(v).trim() && !ACCESS_NOISE.has(String(v).trim().toLowerCase()),
  );
  if (present.length === 0) {
    const pill: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--signal)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', border: '1px solid var(--rule)', borderRadius: 999, padding: '9px 16px', minHeight: 40, background: 'var(--paper-2, #fff)' };
    return (
      <div style={{ fontSize: 13, color: 'var(--ink-4)', lineHeight: 1.5 }}>
        No smart lock here. Use your trip code above, then let the office know you&apos;re in.
        <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          <a href={`sms:${OFFICE_TEL}`} style={pill}>Text the office</a>
          <a href={`tel:${OFFICE_TEL}`} style={pill}>Call the office</a>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 7 }}>
        How to get in
      </div>
      {/* Roomier rows: each value is a tap-to-copy chip, and 6px between
          38px+ chips made mis-taps easy with winter gloves at a keypad. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '12px 14px', fontSize: 13, alignItems: 'center' }}>
        {present.map(([k, v]) => {
          const sv = String(v);
          const isCode = ACCESS_CODE_LABELS.has(k);
          // A door code stored as "Schlage: 4417" should copy just "4417" so it
          // pastes cleanly into a keypad.
          const copyValue = isCode && sv.includes(':') ? sv.split(':').pop()!.trim() : undefined;
          return (
            <div key={k} style={{ display: 'contents' }}>
              <span style={{ color: 'var(--ink-4)' }}>{k}</span>
              <CopyCode value={sv} copyValue={copyValue} mono={isCode} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default async function PacketPage({
  params,
  searchParams,
}: {
  params: Promise<{ packetId: string }>;
  searchParams: Promise<{ taken?: string; incomplete?: string; stale?: string; blocked?: string; office?: string; resetblocked?: string }>;
}) {
  const { packetId } = await params;
  const sp = await searchParams;

  // Office preview (?office=1): a Helm-signed-in staffer renders this exact
  // page read-only, as the inspector sees it. Explicit param (not just cookie
  // absence) so a staffer who also carries a test-contractor cookie still gets
  // the preview they asked for. Actions are disabled via a <fieldset disabled>
  // around the whole page; the server actions independently re-check the
  // contractor cookie anyway.
  const wantsPreview = sp.office === '1';
  const cookieContractor = wantsPreview ? null : await resolveContractorFromCookie();
  let preview = false;
  if (!cookieContractor) {
    const session = wantsPreview ? await auth() : null;
    if (!session?.user?.email) redirect('/field');
    preview = true;
  }

  // Load masked first (no addresses) to determine ownership safely.
  let packet = await loadPacketDetail(packetId, { revealIdentity: false });
  if (!packet) redirect(preview ? '/operations/packets' : '/field');

  // Whose eyes: the awarded inspector's when someone holds the packet, else a
  // synthetic vetted-and-eligible inspector (what any claimable browser sees).
  let contractor = cookieContractor;
  if (!contractor && packet.awarded_contractor_id) {
    const { data } = await fieldDb().from('contractors').select('*').eq('id', packet.awarded_contractor_id).maybeSingle();
    contractor = (data as ContractorRow | null) ?? null;
  }
  contractor ??= {
    id: '__office_preview__',
    full_name: 'Inspector preview',
    trade: packet.trade,
    status: 'active',
    w9_on_file: true,
    agreement_signed_at: new Date().toISOString(),
    background_check_status: 'cleared',
  } as unknown as ContractorRow;

  const isMine = packet.awarded_contractor_id === contractor.id;
  const isMaint = packet.trade === 'maintenance';
  const isSetup = packet.kind === 'setup';
  // One consistent label per stop — never the guest-facing listing title.
  // Full address once it's theirs; otherwise the real property name if they're
  // vetted (background-cleared), else an anonymized "Home N" so an un-cleared
  // browser can't read off which specific homes sit empty on which days.
  const vetted = canClaim(contractor);
  const stopLabel = (s: PacketStopDetail, i: number): string =>
    isMine ? s.property.address : vetted ? s.property.name : `Home ${i + 1}`;
  // A contractor only sees another's packet if it's published AND their trade.
  // The office preview skips the gate — it can look at any state (a draft
  // previews as it will appear once published).
  if (!preview && !isMine && (packet.status !== 'published' || packet.trade !== contractor.trade)) redirect('/field');
  // Reveal door/access codes only while the contractor is actively engaged
  // (claimed or in progress) — never after they submit/approve/cancel, so a
  // departed or cancelled inspector can't keep live codes for an owner's home.
  const canSeeAccess = isMine && (packet.status === 'claimed' || packet.status === 'in_progress');
  // Addresses reveal the moment the job is theirs (any awarded status); codes are
  // the tighter gate above. Non-mine (browsing) packets stay masked.
  if (isMine) {
    packet = (await loadPacketDetail(packetId, { revealAccess: canSeeAccess, revealIdentity: true }))!;
  }

  // Which stops have a LIVE programmed smart-lock code, so we can say "your code
  // opens this door" (verified entry) instead of the static-code / call-office
  // fallback. Reads packet_access_codes -- the record that the trip PIN was
  // actually written into that property's Seam lock for this packet.
  let codedProps = new Set<string>();
  if (canSeeAccess) {
    const { data: codes } = await fieldDb()
      .from('packet_access_codes')
      .select('property_id')
      .eq('packet_id', packetId)
      .is('removed_at', null);
    codedProps = new Set(
      ((codes ?? []) as { property_id: string | null }[]).map((c) => c.property_id).filter((p): p is string => !!p),
    );
  }

  const doneCount = packet.stops.filter((s) => s.status === 'complete' || s.status === 'skipped').length;
  const allComplete = packet.stops.length > 0 && doneCount === packet.stops.length;
  const claimable = !isMine && packet.status === 'published' && canClaim(contractor);
  // While actively working a claimed packet, show it as a job to finish, not an
  // open-ended errand: a progress bar + live per-stop status.
  const working = isMine && (packet.status === 'claimed' || packet.status === 'in_progress') && packet.stops.length > 0;
  const pct = packet.stops.length ? Math.round((doneCount / packet.stops.length) * 100) : 0;
  // Every route starts at the supply closet: home bins + flagged-low consumables
  // for inspections, plus the parts each work slip needs for maintenance.
  // Gated per packet: setups skip the closet unless the office opted in.
  const showSupplyStop = working && packet.supply_run;
  const supplyRun = showSupplyStop ? await loadPacketSupplyRun(packetId) : { bins: [], jobs: [] };
  // The supply closet bookends EVERY route: stop 1 to grab the kit, and the
  // last leg to drop it back off. It owns pin 1 on the map (order below every
  // home) and the homes renumber to 2..N+1 behind it.
  // Live route coloring: done stops (tide), the current stop (signal), upcoming
  // (hollow), plus a per-stop "verified at the door" flag from the Seam lock.
  // Only colored while actively working; browsing keeps the plain signal pins.
  const anyStarted = packet.stops.some(
    (s) => s.started_at || s.status === 'in_progress' || s.status === 'complete' || s.status === 'skipped',
  );
  const rawRoute = [
    ...(showSupplyStop
      ? [{ label: `Supply closet · ${SUPPLY_CLOSET}`, lat: SUPPLY_CLOSET_COORDS.lat, lng: SUPPLY_CLOSET_COORDS.lng, order: -1, num: 1, done: anyStarted, verified: false }]
      : []),
    ...packet.stops.map((s, i) => ({
      label: stopLabel(s, i),
      lat: s.property.latitude ?? NaN,
      lng: s.property.longitude ?? NaN,
      order: s.walk_order,
      // The pin carries the stop's LIST number so map and list always agree,
      // even when a coordinate-less stop gets filtered off the map.
      num: i + 1 + (showSupplyStop ? 1 : 0),
      done: s.status === 'complete' || s.status === 'skipped',
      verified: !!s.arrived_verified_at,
    })),
    // The return leg: drop the kit back at the closet. Path-only (pin: false) —
    // it ends where pin 1 already sits, so the dashed line closes the loop
    // without stacking a second marker on the same spot.
    ...(showSupplyStop
      ? [{
          label: `Drop your kit · ${SUPPLY_CLOSET}`,
          lat: SUPPLY_CLOSET_COORDS.lat,
          lng: SUPPLY_CLOSET_COORDS.lng,
          order: Math.max(0, ...packet.stops.map((s) => s.walk_order)) + 1,
          num: undefined as number | undefined,
          done: false,
          verified: false,
          pin: false,
        }]
      : []),
  ].sort((a, b) => a.order - b.order);
  const firstOpenIdx = rawRoute.findIndex((r) => !r.done);
  const routeStops = rawRoute.map((r, idx) => {
    const state: 'done' | 'current' | 'next' = r.done ? 'done' : idx === firstOpenIdx ? 'current' : 'next';
    return { label: r.label, lat: r.lat, lng: r.lng, order: r.order, num: r.num, state: working ? state : undefined, verified: r.verified, pin: 'pin' in r ? r.pin : undefined };
  });

  // Safety cue: a guest mid-stay (or a calendar block) on the visit date. The
  // claim-time revalidation only guards inspection packets while still
  // published; maintenance runs with guests in-house by design, and a booking
  // can land after a claim. Read-only — warn the contractor, never drop a stop.
  const occupiedStops = working ? await staleStopIds(packet.visit_date, packet.stops) : new Set<string>();

  return (
    <FieldShell contractorName={preview ? null : contractor.full_name} showSignOut={!preview}>
      {preview && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', border: '1px solid var(--tide-deep)', background: 'rgba(58,107,138,0.08)', borderRadius: 10, padding: '10px 14px', marginBottom: 20 }}>
          <span style={{ fontSize: 13, color: 'var(--tide-deep)', lineHeight: 1.5 }}>
            <strong>Office preview</strong>: exactly what{' '}
            {packet.awarded_contractor_id ? contractor.full_name : 'an eligible inspector'} sees. Buttons are disabled.
          </span>
          <Link href={`/operations/packets/${packetId}`} style={{ fontSize: 12, color: 'var(--tide-deep)', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
            ← Back to the office view
          </Link>
        </div>
      )}
      {/* In preview every button/input inside goes inert (fieldset semantics);
          links (Maps, Directions, tel:) stay live. display:contents keeps the
          wrapper out of layout. */}
      <fieldset disabled={preview} style={{ display: 'contents', border: 'none', padding: 0, margin: 0, minWidth: 0 }}>
      <div style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--signal)', fontWeight: 600, textTransform: 'uppercase' }}>
        {fmtDate(packet.visit_date)}{fmtVisitTime(packet.visit_time) ? ` · start ${fmtVisitTime(packet.visit_time)}` : ''}
      </div>
      <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300, margin: '6px 0 8px' }}>
        {packetHeadline(packet)}
      </h1>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 24 }}>
        <span className="font-mono" style={{ fontSize: 30 }}>{dollars(packet.posted_price_cents)}</span>
        {isMine && packet.bonus_cents > 0 && (
          <span style={{ fontSize: 14, color: 'var(--signal)', fontWeight: 600 }} title={packet.bonus_reason ?? undefined}>
            + {dollars(packet.bonus_cents)} bonus
          </span>
        )}
        <span style={{ fontSize: 13, color: 'var(--ink-4)' }}>
          {/* Count the LIVE stops, not the stored stop_count — a partial
              revalidation can leave the column ahead of reality. The per-stop
              math is claim-decision context; once it's theirs, drop it. */}
          for {packet.stops.length} {packet.stops.length === 1 ? 'stop' : 'stops'}
          {!isMine && (
            <> · {dollars(Math.round(packet.posted_price_cents / Math.max(1, packet.stops.length)))} each</>
          )}
        </span>
      </div>

      {working && (
        <div style={{ marginBottom: 26 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
            <span style={{ color: 'var(--ink-3)' }}>{doneCount} of {packet.stops.length} done</span>
            <span style={{ color: allComplete ? 'var(--positive)' : 'var(--ink-4)' }}>
              {allComplete ? 'Ready to submit' : `${packet.stops.length - doneCount} to go`}
            </span>
          </div>
          <div style={{ height: 8, borderRadius: 999, background: 'var(--rule)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: 'var(--positive)', transition: 'width .3s ease' }} />
          </div>
        </div>
      )}

      {/* While the trip is live, keep this view current without a manual
          reload — arrivals stamped by the door show up within ~20s. */}
      {working && !preview && <AutoRefresh />}
      {working && packet.entry_code && (
        <div style={{ border: '1px solid var(--tide-deep)', borderRadius: 10, background: 'rgba(58,107,138,0.06)', padding: '14px 18px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
              Your entry code today
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>Works at every stop.</div>
          </div>
          {/* Tap-to-copy like every other code — this is the one the inspector
              actually punches at every keypad, at peak stress. */}
          <span style={{ fontSize: 26, letterSpacing: '0.14em', color: 'var(--tide-deep)' }}>
            <CopyCode value={packet.entry_code} />
          </span>
        </div>
      )}

      {!isMaint && !isSetup && <DayPlan stops={packet.stops} visitDate={packet.visit_date} />}

      {showSupplyStop && <SupplyRunCard run={supplyRun} />}

      {sp.taken && (
        <div style={{ border: '1px solid var(--rule)', background: 'rgba(0,0,0,0.03)', padding: '12px 16px', fontSize: 14, marginBottom: 22 }}>
          This packet was just claimed by another inspector. Here are others near you on the{' '}
          <Link href="/field" style={{ color: 'var(--signal)' }}>home page</Link>.
        </div>
      )}
      {sp.blocked && (
        <div style={{ border: '1px solid var(--signal)', background: 'rgba(200,90,58,0.06)', color: 'var(--signal)', padding: '12px 16px', fontSize: 14, marginBottom: 22 }}>
          Claiming is paused on your account while we sort out a few recent jobs. Please reach out to the Rising Tide office.
        </div>
      )}
      {sp.resetblocked && (
        <div style={{ border: '1px solid var(--signal)', background: 'rgba(200,90,58,0.06)', color: 'var(--signal)', padding: '12px 16px', fontSize: 14, marginBottom: 22 }}>
          That inspection already has work in it, so it can&apos;t be reset. Finish it, or call the office and we&apos;ll sort it.
        </div>
      )}
      {sp.incomplete && (
        <div style={{ border: '1px solid var(--signal)', background: 'rgba(200,90,58,0.06)', color: 'var(--signal)', padding: '12px 16px', fontSize: 14, marginBottom: 22 }}>
          Finish every stop before submitting the packet.
        </div>
      )}
      {sp.stale && (
        <div style={{ border: '1px solid var(--signal)', background: 'rgba(200,90,58,0.06)', color: 'var(--signal)', padding: '12px 16px', fontSize: 14, marginBottom: 22 }}>
          A guest moved into one of these homes since this packet posted, so it was updated. Review the new details and pay before claiming.
        </div>
      )}
      {isMine && packet.status === 'in_progress' && packet.notes && (
        <div style={{ border: '1px solid var(--signal)', background: 'rgba(200,90,58,0.06)', padding: '12px 16px', fontSize: 14, marginBottom: 22 }}>
          <strong style={{ color: 'var(--signal)' }}>Changes requested:</strong>{' '}
          <span style={{ color: 'var(--ink)' }}>{packet.notes}</span> Please re-do the stops and submit again.
        </div>
      )}
      {isMine && (packet.status === 'claimed' || packet.status === 'in_progress') && packet.instructions && (
        <div style={{ borderLeft: '3px solid var(--tide)', background: 'rgba(78,124,158,0.06)', padding: '12px 16px', marginBottom: 22 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--tide-deep)', fontWeight: 600, marginBottom: 4 }}>From the office</div>
          <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{packet.instructions}</div>
        </div>
      )}

      {isMaint && !isMine && (
        <p style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.6, marginBottom: 24, maxWidth: 520 }}>
          Each stop is a specific maintenance job at a home. Addresses, the work details, and entry details unlock
          as soon as you claim.
        </p>
      )}
      {/* The three-pillar scope sells the standard BEFORE claiming. Once the
          packet is theirs (working, submitted, approved) it's ~300px of
          scrolling between the inspector and their stops — drop it. */}
      {!isMaint && !isSetup && !isMine && <InspectionScope />}
      {isSetup && <SetupScope />}
      {!isMine && (
        <p style={{ fontSize: 13, color: 'var(--ink-4)', lineHeight: 1.6, maxWidth: 520, margin: '0 0 24px' }}>
          Every route starts and ends at our supply closet ({SUPPLY_CLOSET}): grab your kit on the way out, drop it
          back when you&apos;re done.
        </p>
      )}

      {isMine ? (
        <PacketRouteMap stops={routeStops} />
      ) : (
        <p style={{ fontSize: 13, color: 'var(--ink-4)', lineHeight: 1.6, margin: '4px 0 20px' }}>
          The route and exact addresses are shared the moment you claim.
        </p>
      )}

      <section>
        {packet.stops.map((s, i) => (
          <div
            key={s.id}
            className="rt-stop-row"
            style={{ borderTop: '1px solid var(--rule)', padding: '16px 0', display: 'flex', gap: 14, alignItems: 'flex-start' }}
          >
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                border: '1px solid var(--rule)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                flexShrink: 0,
                color: s.status === 'complete' ? 'var(--positive)' : 'var(--ink-3)',
              }}
            >
              {s.status === 'complete' ? '✓' : i + 1 + (showSupplyStop ? 1 : 0)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="font-serif" style={{ fontSize: 17 }}>
                {stopLabel(s, i)}
              </div>
              {isMine && s.instructions && (
                <div style={{ marginTop: 8, borderLeft: '3px solid var(--tide)', background: 'rgba(78,124,158,0.06)', padding: '8px 12px' }}>
                  <div style={{ fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--tide-deep)', fontWeight: 600, marginBottom: 3 }}>From the office</div>
                  <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{s.instructions}</div>
                </div>
              )}
              {s.workSlip ? (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 14, color: 'var(--ink)' }}>{s.workSlip.title}</div>
                  {(s.workSlip.action_summary || s.workSlip.description) && (
                    <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 2, lineHeight: 1.5 }}>
                      {s.workSlip.action_summary || s.workSlip.description}
                    </div>
                  )}
                  {/* Location only — priority is office triage detail, not
                      door-side instruction (matches AttachedSlipCard). */}
                  {s.workSlip.location && (
                    <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 3 }}>{s.workSlip.location}</div>
                  )}
                  {s.workSlip.bring_list && (
                    <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 6 }}>
                      <span style={{ color: 'var(--ink-4)' }}>Bring: </span>{s.workSlip.bring_list}
                    </div>
                  )}
                  {s.workSlip.photo_urls && s.workSlip.photo_urls.length > 0 && (
                    <PhotoThumbs urls={s.workSlip.photo_urls} size={56} />
                  )}
                </div>
              ) : isMine ? (
                <div
                  style={{
                    fontSize: 13,
                    marginTop: 2,
                    color:
                      s.status === 'complete'
                        ? 'var(--positive)'
                        : s.status === 'in_progress'
                          ? 'var(--tide-deep)'
                          : 'var(--ink-4)',
                  }}
                >
                  {s.status === 'complete' ? 'Done' : s.status === 'in_progress' ? 'In progress' : 'Not started'}
                  {/* Time at property, driven by the door: live-ticking while
                      they're inside, fixed once they've left. */}
                  {(() => {
                    const start = s.arrived_verified_at ?? s.started_at;
                    if (!start) return null;
                    if (s.status === 'in_progress') {
                      return <span style={{ color: 'var(--ink-4)' }}> · <OnSite startIso={start} endIso={s.departed_at} live /></span>;
                    }
                    if (s.status === 'complete') {
                      return <span style={{ color: 'var(--ink-4)' }}> · <OnSite startIso={start} endIso={s.departed_at ?? s.completed_at} live={false} /></span>;
                    }
                    return null;
                  })()}
                  {s.arrived_verified_at && (
                    <span style={{ color: 'var(--positive)' }}> · ✓ entered</span>
                  )}
                  {/* Keep the timing visible while working — a same-day check-in
                      and a vacant home look identical exactly when it matters. */}
                  {s.status !== 'complete' && (() => {
                    const t = stopTiming(s, packet.visit_date);
                    return (
                      <span style={{ color: t.urgent ? 'var(--signal)' : 'var(--ink-4)', fontWeight: t.urgent ? 600 : 400 }}>
                        {' · '}{t.label}
                      </span>
                    );
                  })()}
                </div>
              ) : (
                (() => {
                  const t = stopTiming(s, packet.visit_date);
                  return (
                    <div style={{ fontSize: 13, marginTop: 2, color: t.urgent ? 'var(--signal)' : 'var(--ink-3)', fontWeight: t.urgent ? 600 : 400 }}>
                      {/* The town is the drive-time signal a browser needs before
                          claiming — even masked stops say where they are. */}
                      {cityShort(s.property.city) ? `${cityShort(s.property.city)} · ` : ''}{t.label}
                    </div>
                  );
                })()
              )}
              {isMine && (() => {
                const href = mapsUrl(s);
                return href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 13, fontWeight: 600, color: 'var(--tide-deep)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', marginTop: 8, border: '1px solid var(--rule)', borderRadius: 999, padding: '9px 16px', minHeight: 40, background: 'var(--paper-2, #fff)' }}
                  >
                    Open in Maps ↗
                  </a>
                ) : null;
              })()}
              {isMine && occupiedStops.has(s.id) && s.status !== 'complete' && (
                <div style={{ marginTop: 10, padding: '10px 12px', borderLeft: '3px solid var(--signal)', background: 'rgba(200,90,58,0.06)', fontSize: 13, color: 'var(--signal)', lineHeight: 1.5 }}>
                  A guest may be in this home today. Check with the office before you enter.
                  {/* The safety tap gets a real pill, not 13px inline text. */}
                  <div style={{ marginTop: 8 }}>
                    <a
                      href={`tel:${OFFICE_TEL}`}
                      style={{ fontSize: 13, fontWeight: 700, color: 'var(--signal)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', border: '1px solid var(--signal)', borderRadius: 999, padding: '9px 16px', minHeight: 40, background: 'var(--paper)' }}
                    >
                      Call the office
                    </a>
                  </div>
                </div>
              )}
              {isMine && (codedProps.has(s.property_id) ? (
                <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(46,125,79,0.06)', borderLeft: '3px solid var(--positive, #2e7d4f)' }}>
                  <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
                    🔒 Smart lock: your code{packet.entry_code ? <> <strong className="font-mono">{packet.entry_code}</strong></> : ''} opens this door.
                  </div>
                </div>
              ) : s.access ? (
                <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(0,0,0,0.02)', border: '1px solid var(--rule)' }}>
                  <AccessLines a={s.access} />
                </div>
              ) : null)}
              {/* Arrival + parking, colleague tone (synthesized from what we
                  tell guests). <details>, not a button: it stays tappable in
                  the read-only office preview. */}
              {isMine && s.access?.arrival && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--tide-deep)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 4px', minHeight: 36 }}>
                    ⓘ Arrival &amp; parking
                  </summary>
                  <div style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.55, borderLeft: '3px solid var(--tide)', background: 'rgba(78,124,158,0.06)', padding: '8px 12px', marginTop: 4, maxWidth: 560, whiteSpace: 'pre-wrap' }}>
                    {s.access.arrival}
                  </div>
                </details>
              )}
              {isMine && s.workSlip && s.status !== 'complete' && (
                <MaintenanceComplete packetId={packet.id} stopId={s.id} />
              )}
              {isMine && s.attachedSlips.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, marginBottom: 4 }}>
                    Also at this stop
                  </div>
                  {s.attachedSlips.map((a) => (
                    <AttachedSlipCard key={a.attachmentId} packetId={packet.id} slip={a} isMine={isMine} />
                  ))}
                </div>
              )}
            </div>
            {isMine && !s.workSlip && (
              <div className="rt-stop-action" style={{ flexShrink: 0 }}>
                {s.status === 'complete' ? (
                  <span style={{ fontSize: 12, color: 'var(--positive)' }}>Done</span>
                ) : (
                  <>
                    <StartStop packetId={packet.id} stopId={s.id} resume={s.status === 'in_progress'} />
                    {s.status === 'in_progress' && (
                      <form action={undoStartStop} style={{ margin: '8px 0 0', textAlign: 'center' }}>
                        <input type="hidden" name="packet_id" value={packet.id} />
                        <input type="hidden" name="stop_id" value={s.id} />
                        <button
                          type="submit"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 8px', fontSize: 12, color: 'var(--ink-4)', textDecoration: 'underline' }}
                        >
                          Started by accident? Reset this stop
                        </button>
                      </form>
                    )}
                  </>
                )}
              </div>
            )}
            {isMine && s.workSlip && s.status === 'complete' && (
              <div style={{ flexShrink: 0 }}>
                <span style={{ fontSize: 12, color: 'var(--positive)' }}>Done</span>
              </div>
            )}
          </div>
        ))}
      </section>

      {showSupplyStop && <KitReturnCard />}

      {/* Sticky bar renders ONLY when it carries a real action or verdict:
          claim, submit (all stops done), the eligibility nudge, or the
          submitted/approved receipt. Mid-job it used to pin a disabled
          "Finish all stops to submit" button to the bottom of every scroll —
          the progress bar up top already tells that story. */}
      {(claimable ||
        (!isMine && packet.status === 'published' && !canClaim(contractor)) ||
        (isMine && (packet.status === 'submitted' || packet.status === 'approved')) ||
        (isMine && packet.status !== 'submitted' && packet.status !== 'approved' && allComplete)) && (
        <div
          className="rt-cta-bar"
          style={{
            borderTop: '1px solid var(--ink)',
            marginTop: 8,
            padding: '18px 0 calc(14px + env(safe-area-inset-bottom, 0px))',
            position: 'sticky',
            bottom: 0,
            zIndex: 20,
            background: 'var(--paper)',
          }}
        >
          {claimable && (
            <form action={claimPacket}>
              <input type="hidden" name="packet_id" value={packet.id} />
              <PendingButton
                label={`Claim this packet · ${dollars(packet.posted_price_cents)}`}
                busyLabel="Claiming…"
                style={{
                  width: '100%',
                  maxWidth: 480,
                  background: 'var(--signal)',
                  color: 'var(--paper)',
                  border: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  padding: '16px 24px',
                  minHeight: 48,
                }}
              />
            </form>
          )}
          {!isMine && packet.status === 'published' && !canClaim(contractor) && (
            onboardingComplete(contractor) ? (
              <p style={{ color: 'var(--signal)', fontSize: 14, margin: 0 }}>
                Your background check hasn&apos;t started yet. You&apos;ll be able to claim as soon as the office kicks it off.
              </p>
            ) : (
              <Link href="/field/onboarding" style={{ color: 'var(--signal)', fontSize: 14 }}>
                Finish your account setup to claim this packet →
              </Link>
            )
          )}
          {isMine && packet.status !== 'submitted' && packet.status !== 'approved' && allComplete && (
            <form action={submitPacket}>
              <input type="hidden" name="packet_id" value={packet.id} />
              <PendingButton
                label="Submit completed packet"
                busyLabel="Submitting…"
                style={{
                  width: '100%',
                  maxWidth: 480,
                  background: 'var(--ink)',
                  color: 'var(--paper)',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  padding: '16px 24px',
                  minHeight: 48,
                }}
              />
            </form>
          )}
          {isMine && (packet.status === 'submitted' || packet.status === 'approved') && (
            <div style={{ fontSize: 14, color: 'var(--positive)' }}>
              {packet.status === 'approved'
                ? `Approved. ${dollars(packet.posted_price_cents + packet.bonus_cents)} is on the way.`
                : 'Submitted for review. Thanks!'}
              {packet.status === 'approved' && packet.bonus_cents > 0 && (
                <div style={{ marginTop: 8, borderLeft: '3px solid var(--signal)', background: 'rgba(200,90,58,0.06)', padding: '10px 14px', color: 'var(--ink)', fontSize: 14, lineHeight: 1.5 }}>
                  <strong style={{ color: 'var(--signal)' }}>+ {dollars(packet.bonus_cents)} bonus</strong>
                  {packet.bonus_reason ? <> for {packet.bonus_reason}</> : null}. Thank you for going the extra mile.
                </div>
              )}
            </div>
          )}
        </div>
      )}
      </fieldset>
    </FieldShell>
  );
}
