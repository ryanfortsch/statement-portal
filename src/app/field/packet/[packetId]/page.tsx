import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { resolveContractorFromCookie } from '@/lib/field-auth';
import { loadPacketDetail } from '@/lib/field-packets';
import { canClaim, dollars, packetHeadline, type AccessBundle, type PacketStopDetail } from '@/lib/field-types';
import { claimPacket, startStopInspection, submitPacket } from '../../actions';
import { FieldShell } from '../../FieldShell';
import { PacketRouteMap } from '../../PacketRouteMap';

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

function windowLabel(s: PacketStopDetail): string {
  if (s.window_basis === 'checkout_day') return 'Inspect after the morning checkout';
  if (s.window_basis === 'pre_checkin') return `Inspect before the ${s.next_checkin ?? 'afternoon'} check-in`;
  return 'Vacant all day';
}

function AccessLines({ a }: { a: AccessBundle }) {
  const rows: Array<[string, string | null]> = [
    ['Entry', a.method],
    ['Smart lock', a.smartLock],
    ['Lockbox / key', a.lockboxLocation],
    ['Gate code', a.gateCode],
    ['Garage code', a.garageCode],
    ['Alarm', a.alarm],
    ['Parking', a.parking],
  ];
  const present = rows.filter(([, v]) => v && String(v).trim());
  if (present.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>No access details on file — text the office on arrival.</div>;
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 13 }}>
      {present.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <span style={{ color: 'var(--ink-4)' }}>{k}</span>
          <span className="font-mono" style={{ color: 'var(--ink)' }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

export default async function PacketPage({
  params,
  searchParams,
}: {
  params: Promise<{ packetId: string }>;
  searchParams: Promise<{ taken?: string; incomplete?: string; stale?: string }>;
}) {
  const { packetId } = await params;
  const sp = await searchParams;
  const contractor = await resolveContractorFromCookie();
  if (!contractor) redirect('/field');

  let packet = await loadPacketDetail(packetId);
  if (!packet) redirect('/field');

  const isMine = packet.awarded_contractor_id === contractor.id;
  if (!isMine && packet.status !== 'published') redirect('/field');
  // Reveal door/access codes only while the contractor is actively engaged
  // (claimed or in progress) — never after they submit/approve/cancel, so a
  // departed or cancelled inspector can't keep live codes for an owner's home.
  const canSeeAccess = isMine && (packet.status === 'claimed' || packet.status === 'in_progress');
  if (canSeeAccess) {
    packet = (await loadPacketDetail(packetId, { revealAccess: true }))!;
  }

  const allComplete =
    packet.stops.length > 0 && packet.stops.every((s) => s.status === 'complete' || s.status === 'skipped');
  const claimable = !isMine && packet.status === 'published' && canClaim(contractor);

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

      {sp.taken && (
        <div style={{ border: '1px solid var(--rule)', background: 'rgba(0,0,0,0.03)', padding: '12px 16px', fontSize: 14, marginBottom: 22 }}>
          This packet was just claimed by another inspector. Here are others near you on the{' '}
          <Link href="/field" style={{ color: 'var(--signal)' }}>home page</Link>.
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

      {!isMine && (
        <p style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.6, marginBottom: 24, maxWidth: 520 }}>
          Each stop is a quick guest-readiness walk (the Helm Core 12 — about a dozen checks, ~20 minutes
          per home). Addresses and entry details unlock as soon as you claim.
        </p>
      )}

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
              <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 2 }}>{windowLabel(s)}</div>
              {isMine && s.access && (
                <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(0,0,0,0.02)', border: '1px solid var(--rule)' }}>
                  <AccessLines a={s.access} />
                </div>
              )}
            </div>
            {isMine && (
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
