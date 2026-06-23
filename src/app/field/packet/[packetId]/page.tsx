import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { resolveContractorFromCookie } from '@/lib/field-auth';
import { loadPacketDetail } from '@/lib/field-packets';
import { canClaim, dollars, packetHeadline, type AccessBundle, type PacketStopDetail } from '@/lib/field-types';
import { claimPacket, startStopInspection, submitPacket } from '../../actions';
import { MaintenanceComplete } from './MaintenanceComplete';
import { FieldShell } from '../../FieldShell';
import { PacketRouteMap } from '../../PacketRouteMap';
import { CopyCode } from '../../CopyCode';

function mapsUrl(s: PacketStopDetail): string {
  if (s.property.latitude != null && s.property.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${s.property.latitude},${s.property.longitude}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.property.address || s.property.name)}`;
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

function windowLabel(s: PacketStopDetail, visitDate: string): string {
  // The window is driven by the cleaning: the inspector goes in AFTER the
  // cleaner. Cleaning happens the day a guest checks out (~11am checkout,
  // cleaners wrap roughly 12–3pm). If the home was cleaned on an earlier day
  // it's been sitting vacant, so anytime works and earlier is better (more
  // runway to fix anything before the next guest).
  const checkinToday = !!s.next_checkin && s.next_checkin === visitDate;
  if (s.window_basis === 'checkout_day') {
    return checkinToday
      ? 'Same-day turnover · go in after the cleaner, before the 4pm check-in'
      : "In after today's cleaning · cleaners usually wrap by ~3pm";
  }
  if (s.window_basis === 'pre_checkin' || checkinToday) {
    return 'Guest checks in at 4pm · inspect in the morning, well before then';
  }
  return 'Already cleaned · anytime, mornings are best';
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
    return <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>No entry details on file — text the office when you arrive.</div>;
  }
  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 7 }}>
        How to get in
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', fontSize: 13 }}>
        {present.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <span style={{ color: 'var(--ink-4)' }}>{k}</span>
            <CopyCode value={String(v)} mono={ACCESS_CODE_LABELS.has(k)} />
          </div>
        ))}
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

  let packet = await loadPacketDetail(packetId);
  if (!packet) redirect('/field');

  const isMine = packet.awarded_contractor_id === contractor.id;
  const isMaint = packet.trade === 'maintenance';
  // A contractor only sees another's packet if it's published AND their trade.
  if (!isMine && (packet.status !== 'published' || packet.trade !== contractor.trade)) redirect('/field');
  // Reveal door/access codes only while the contractor is actively engaged
  // (claimed or in progress) — never after they submit/approve/cancel, so a
  // departed or cancelled inspector can't keep live codes for an owner's home.
  const canSeeAccess = isMine && (packet.status === 'claimed' || packet.status === 'in_progress');
  if (canSeeAccess) {
    packet = (await loadPacketDetail(packetId, { revealAccess: true }))!;
  }

  const doneCount = packet.stops.filter((s) => s.status === 'complete' || s.status === 'skipped').length;
  const allComplete = packet.stops.length > 0 && doneCount === packet.stops.length;
  const claimable = !isMine && packet.status === 'published' && canClaim(contractor);
  // While actively working a claimed packet, show it as a job to finish, not an
  // open-ended errand: a progress bar + live per-stop status.
  const working = isMine && (packet.status === 'claimed' || packet.status === 'in_progress') && packet.stops.length > 0;
  const pct = packet.stops.length ? Math.round((doneCount / packet.stops.length) * 100) : 0;

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

      {isMaint && !isMine && (
        <p style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.6, marginBottom: 24, maxWidth: 520 }}>
          Each stop is a specific maintenance job at a home. Addresses, the work details, and entry details unlock
          as soon as you claim.
        </p>
      )}
      {!isMaint && <InspectionScope />}

      <PacketRouteMap
        stops={packet.stops.map((s) => ({
          label: isMine ? s.property.address : s.property.title || s.property.name,
          lat: s.property.latitude ?? NaN,
          lng: s.property.longitude ?? NaN,
          order: s.walk_order,
        }))}
      />

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
              {s.status === 'complete' ? '✓' : i + 1}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="font-serif" style={{ fontSize: 17 }}>
                {isMine ? s.property.address : s.property.title || s.property.name}
              </div>
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
                <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 2 }}>{windowLabel(s, packet.visit_date)}</div>
              )}
              {isMine && (
                <a
                  href={mapsUrl(s)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 12, color: 'var(--tide-deep)', textDecoration: 'none', display: 'inline-block', marginTop: 4 }}
                >
                  Open in Maps ↗
                </a>
              )}
              {isMine && s.access && (
                <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(0,0,0,0.02)', border: '1px solid var(--rule)' }}>
                  <AccessLines a={s.access} />
                </div>
              )}
              {isMine && s.workSlip && s.status !== 'complete' && (
                <MaintenanceComplete packetId={packet.id} stopId={s.id} />
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
                    <button
                      type="submit"
                      style={{
                        background: 'var(--ink)',
                        color: 'var(--paper)',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        padding: '9px 16px',
                      }}
                    >
                      {s.status === 'in_progress' ? 'Resume' : 'Start'}
                    </button>
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
            <button
              type="submit"
              style={{
                background: 'var(--signal)',
                color: 'var(--paper)',
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                padding: '16px 34px',
              }}
            >
              Claim this packet · {dollars(packet.posted_price_cents)}
            </button>
            <p style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 10 }}>
              First inspector to claim gets it. You&apos;ll get the addresses and entry details right away.
            </p>
          </form>
        )}
        {!isMine && packet.status === 'published' && !canClaim(contractor) && (
          <Link href="/field/onboarding" style={{ color: 'var(--signal)', fontSize: 14 }}>
            Finish your account setup to claim this packet →
          </Link>
        )}
        {isMine && packet.status !== 'submitted' && packet.status !== 'approved' && (
          <form action={submitPacket}>
            <input type="hidden" name="packet_id" value={packet.id} />
            <button
              type="submit"
              disabled={!allComplete}
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
            >
              {allComplete ? 'Submit completed packet' : 'Finish all stops to submit'}
            </button>
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
