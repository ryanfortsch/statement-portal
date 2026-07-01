import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { resolveContractorFromCookie } from '@/lib/field-auth';
import { loadPacketDetail, loadPacketSupplyRun, SUPPLY_CLOSET, SUPPLY_CLOSET_COORDS, type SupplyRun } from '@/lib/field-packets';
import { canClaim, onboardingComplete, dollars, packetHeadline, type AccessBundle, type PacketStopDetail, type AttachedSlip } from '@/lib/field-types';
import { claimPacket, startStopInspection, submitPacket } from '../../actions';
import { PendingButton } from './PendingButton';
import { MaintenanceComplete } from './MaintenanceComplete';
import { FieldShell } from '../../FieldShell';
import { PacketRouteMap } from '../../PacketRouteMap';
import { CopyCode } from '../../CopyCode';
import { PhotoThumbs } from '@/components/PhotoUploader';

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

// One fixed inspection window for every stop: after the morning checkout +
// cleaning, before the afternoon check-in. Consistent, not a per-stop guess.
const INSPECTION_WINDOW = 'Inspection window · 12:00–2:45 PM';

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
      {(slip.action_summary || slip.description) && (
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 2, lineHeight: 1.5 }}>{slip.action_summary || slip.description}</div>
      )}
      <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 3 }}>
        {slip.location ? `${slip.location} · ` : ''}priority: {slip.priority}
      </div>
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
        <MaintenanceComplete packetId={packetId} attachmentId={slip.attachmentId} label="Mark this done" placeholder="What did you do?" />
      )}
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
  if (homes.length === 0 && run.jobs.length === 0) return null;
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${SUPPLY_CLOSET_COORDS.lat},${SUPPLY_CLOSET_COORDS.lng}`;
  return (
    <div style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '16px 18px', marginBottom: 24, background: 'rgba(0,0,0,0.015)' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--signal)', fontWeight: 600, marginBottom: 4 }}>
        Stop 1 · Supply closet
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          Grab your bag at <strong style={{ color: 'var(--ink)' }}>{SUPPLY_CLOSET}</strong> — one bag, packed for this whole trip.
        </div>
        <a href={mapsHref} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--signal)', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
          Directions →
        </a>
      </div>

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
    return (
      <div style={{ fontSize: 13, color: 'var(--ink-4)' }}>
        No entry details on file. <a href={`tel:${OFFICE_TEL}`} style={{ color: 'var(--signal)', fontWeight: 600 }}>Call the office</a> when you arrive and we&apos;ll get you in.
      </div>
    );
  }
  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 7 }}>
        How to get in
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', fontSize: 13 }}>
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
  searchParams: Promise<{ taken?: string; incomplete?: string; stale?: string; note?: string; blocked?: string }>;
}) {
  const { packetId } = await params;
  const sp = await searchParams;
  const contractor = await resolveContractorFromCookie();
  if (!contractor) redirect('/field');

  // Load masked first (no addresses) to determine ownership safely.
  let packet = await loadPacketDetail(packetId, { revealIdentity: false });
  if (!packet) redirect('/field');

  const isMine = packet.awarded_contractor_id === contractor.id;
  const isMaint = packet.trade === 'maintenance';
  // One consistent label per stop — never the guest-facing listing title.
  // Full address once it's theirs; otherwise the real property name if they're
  // vetted (background-cleared), else an anonymized "Home N" so an un-cleared
  // browser can't read off which specific homes sit empty on which days.
  const vetted = canClaim(contractor);
  const stopLabel = (s: PacketStopDetail, i: number): string =>
    isMine ? s.property.address : vetted ? s.property.name : `Home ${i + 1}`;
  // A contractor only sees another's packet if it's published AND their trade.
  if (!isMine && (packet.status !== 'published' || packet.trade !== contractor.trade)) redirect('/field');
  // Reveal door/access codes only while the contractor is actively engaged
  // (claimed or in progress) — never after they submit/approve/cancel, so a
  // departed or cancelled inspector can't keep live codes for an owner's home.
  const canSeeAccess = isMine && (packet.status === 'claimed' || packet.status === 'in_progress');
  // Addresses reveal the moment the job is theirs (any awarded status); codes are
  // the tighter gate above. Non-mine (browsing) packets stay masked.
  if (isMine) {
    packet = (await loadPacketDetail(packetId, { revealAccess: canSeeAccess, revealIdentity: true }))!;
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
  const supplyRun = working ? await loadPacketSupplyRun(packetId) : { bins: [], jobs: [] };
  // The supply closet is a real first leg of the route whenever there's a bag to
  // grab. It owns pin 1 on the map (order below every home) and the homes
  // renumber to 2..N+1 behind it.
  const showSupplyStop = working && (supplyRun.bins.length > 0 || supplyRun.jobs.length > 0);
  // Live route coloring: done stops (tide), the current stop (signal), upcoming
  // (hollow), plus a per-stop "verified at the door" flag from the Seam lock.
  // Only colored while actively working; browsing keeps the plain signal pins.
  const anyStarted = packet.stops.some(
    (s) => s.started_at || s.status === 'in_progress' || s.status === 'complete' || s.status === 'skipped',
  );
  const rawRoute = [
    ...(showSupplyStop
      ? [{ label: `Supply closet · ${SUPPLY_CLOSET}`, lat: SUPPLY_CLOSET_COORDS.lat, lng: SUPPLY_CLOSET_COORDS.lng, order: -1, done: anyStarted, verified: false }]
      : []),
    ...packet.stops.map((s, i) => ({
      label: stopLabel(s, i),
      lat: s.property.latitude ?? NaN,
      lng: s.property.longitude ?? NaN,
      order: s.walk_order,
      done: s.status === 'complete' || s.status === 'skipped',
      verified: !!s.arrived_verified_at,
    })),
  ].sort((a, b) => a.order - b.order);
  let currentAssigned = false;
  const routeStops = rawRoute.map((r) => {
    const state: 'done' | 'current' | 'next' = r.done
      ? 'done'
      : !currentAssigned
        ? ((currentAssigned = true), 'current')
        : 'next';
    return { label: r.label, lat: r.lat, lng: r.lng, order: r.order, state: working ? state : undefined, verified: r.verified };
  });

  return (
    <FieldShell contractorName={contractor.full_name}>
      <div style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--signal)', fontWeight: 600, textTransform: 'uppercase' }}>
        {fmtDate(packet.visit_date)}
      </div>
      <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300, margin: '6px 0 8px' }}>
        {packetHeadline(packet)}
      </h1>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 24 }}>
        <span className="font-mono" style={{ fontSize: 30 }}>{dollars(packet.posted_price_cents)}</span>
        <span style={{ fontSize: 13, color: 'var(--ink-4)' }}>
          for {packet.stop_count} {packet.stop_count === 1 ? 'stop' : 'stops'} ·{' '}
          {dollars(Math.round(packet.posted_price_cents / Math.max(1, packet.stop_count)))} each
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

      {working && packet.entry_code && (
        <div style={{ border: '1px solid var(--tide-deep)', borderRadius: 10, background: 'rgba(58,107,138,0.06)', padding: '14px 18px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
              Your entry code today
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>Works at every stop. It stops working when you submit.</div>
          </div>
          <span className="font-mono" style={{ fontSize: 30, letterSpacing: '0.18em', color: 'var(--tide-deep)' }}>
            {packet.entry_code}
          </span>
        </div>
      )}

      {working && <SupplyRunCard run={supplyRun} />}

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
      {sp.incomplete && (
        <div style={{ border: '1px solid var(--signal)', background: 'rgba(200,90,58,0.06)', color: 'var(--signal)', padding: '12px 16px', fontSize: 14, marginBottom: 22 }}>
          Finish every stop before submitting the packet.
        </div>
      )}
      {sp.note && (
        <div style={{ border: '1px solid var(--signal)', background: 'rgba(200,90,58,0.06)', color: 'var(--signal)', padding: '12px 16px', fontSize: 14, marginBottom: 22 }}>
          Add a short note on what you did before marking the job done.
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
      {!isMaint && <InspectionScope />}

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
                  <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 3 }}>
                    {s.workSlip.location ? `${s.workSlip.location} · ` : ''}priority: {s.workSlip.priority}
                  </div>
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
                </div>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 2 }}>{INSPECTION_WINDOW}</div>
              )}
              {isMine && (() => {
                const href = mapsUrl(s);
                return href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 12, color: 'var(--tide-deep)', textDecoration: 'none', display: 'inline-block', marginTop: 4 }}
                  >
                    Open in Maps ↗
                  </a>
                ) : null;
              })()}
              {isMine && s.access && (
                <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(0,0,0,0.02)', border: '1px solid var(--rule)' }}>
                  <AccessLines a={s.access} />
                </div>
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
              <div style={{ flexShrink: 0 }}>
                {s.status === 'complete' ? (
                  <span style={{ fontSize: 12, color: 'var(--positive)' }}>Done</span>
                ) : (
                  <form action={startStopInspection} style={{ margin: 0 }}>
                    <input type="hidden" name="packet_id" value={packet.id} />
                    <input type="hidden" name="stop_id" value={s.id} />
                    <PendingButton
                      label={s.status === 'in_progress' ? 'Resume' : 'Start'}
                      busyLabel="Opening…"
                      style={{
                        background: 'var(--ink)',
                        color: 'var(--paper)',
                        border: 'none',
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        padding: '9px 16px',
                      }}
                    />
                  </form>
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

      <div style={{ borderTop: '1px solid var(--ink)', marginTop: 8, paddingTop: 24 }}>
        {claimable && (
          <form action={claimPacket}>
            <input type="hidden" name="packet_id" value={packet.id} />
            <PendingButton
              label={`Claim this packet · ${dollars(packet.posted_price_cents)}`}
              busyLabel="Claiming…"
              style={{
                background: 'var(--signal)',
                color: 'var(--paper)',
                border: 'none',
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                padding: '16px 34px',
              }}
            />
            <p style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 10 }}>
              First inspector to claim gets it. You&apos;ll get the addresses and entry details right away.
            </p>
          </form>
        )}
        {!isMine && packet.status === 'published' && !canClaim(contractor) && (
          onboardingComplete(contractor) ? (
            <p style={{ color: 'var(--signal)', fontSize: 14, margin: 0 }}>
              Your background check is in review. You&apos;ll be able to claim as soon as it clears.
            </p>
          ) : (
            <Link href="/field/onboarding" style={{ color: 'var(--signal)', fontSize: 14 }}>
              Finish your account setup to claim this packet →
            </Link>
          )
        )}
        {isMine && packet.status !== 'submitted' && packet.status !== 'approved' && (
          <form action={submitPacket}>
            <input type="hidden" name="packet_id" value={packet.id} />
            <PendingButton
              disabled={!allComplete}
              label={allComplete ? 'Submit completed packet' : 'Finish all stops to submit'}
              busyLabel="Submitting…"
              style={{
                background: allComplete ? 'var(--ink)' : 'transparent',
                color: allComplete ? 'var(--paper)' : 'var(--ink-4)',
                border: allComplete ? 'none' : '1px solid var(--rule)',
                cursor: allComplete ? 'pointer' : 'not-allowed',
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                padding: '16px 34px',
              }}
            />
          </form>
        )}
        {isMine && (packet.status === 'submitted' || packet.status === 'approved') && (
          <div style={{ fontSize: 14, color: 'var(--positive)' }}>
            Submitted for review. Thanks{packet.status === 'approved' ? ' — approved!' : ''}.
          </div>
        )}
      </div>
    </FieldShell>
  );
}
