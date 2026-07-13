import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { fieldDb } from '@/lib/field-db';
import { loadPacketDetail, loadPacketReview, getContractorReliability, loadAttachableSlips, type ReliabilityTier } from '@/lib/field-packets';
import { StopAttachments, PacketInstructions } from './StopAttachments';
import { BonusFields } from './BonusFields';
import { PacketRouteMap } from '@/app/field/PacketRouteMap';
import { OnSite } from '@/app/field/packet/[packetId]/OnSite';
import { AutoRefresh } from '@/components/AutoRefresh';
import { haversineMiles } from '@/lib/proximity';
import { dollars, effectiveBaseCents, isPayoutFinal, totalPayoutCents, type PacketStopDetail } from '@/lib/field-types';
import { FieldAvatar } from '@/components/FieldAvatar';
import { publishPacket, unpublishPacket, cancelPacket, setPacketPrice, setPacketBonus, approvePacket, finalizePacketPayout, markPacketPaid, releasePacket, requestChanges, removeStop, assignPacket, setPacketVisitDate, setPacketCompleteBy, raisePacketEstimate, addPacketStop, syncPacketWindows } from '../actions';
import { StopList } from './StopList';
import { canClaim, fmtVisitTime, type ContractorRow } from '@/lib/field-types';
import { isLiveStatus, isAttachableStatus, isAssignableStatus, isWorkingStatus } from '@/lib/field-packet-status';
import { loadPaymentSummaries } from '@/lib/field-pay';
import { suggestFinalCents, isRushVisit } from '@/lib/field-pricing';
import { FinalPayoutField } from './FinalPayoutField';
import { RevealPay } from '../../contractors/RevealPay';
import { PendingButton } from '@/app/field/packet/[packetId]/PendingButton';

export const dynamic = 'force-dynamic';

function fmtDate(d: string): string {
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  } catch {
    return d;
  }
}
function windowLabel(s: PacketStopDetail): string {
  if (s.window_basis === 'checkout_day') return `after ${s.prior_checkout ?? 'morning'} checkout`;
  if (s.window_basis === 'pre_checkin') return `before ${s.next_checkin ?? ''} check-in`;
  return 'vacant all day';
}

const TIER_LABEL: Record<ReliabilityTier, string> = { top: 'top', steady: 'steady', new: 'new', watch: 'watch' };

// ── Live trip timing (Uber-style tracker) ─────────────────────────────
// Arrival = the Seam lock recording their trip code (arrived_verified_at), with
// the manual Start tap as fallback. Departure = the next door opening or submit.
function stopStart(s: PacketStopDetail): string | null {
  return s.arrived_verified_at ?? s.started_at;
}
function stopEnd(s: PacketStopDetail): string | null {
  return s.departed_at ?? s.completed_at;
}
/** Minutes on site for a CLOSED visit; null while still open or never started. */
function stopMins(s: PacketStopDetail): number | null {
  const a = stopStart(s);
  const b = stopEnd(s);
  if (!a || !b) return null;
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
}
/** Wall-clock arrival like "1:12 PM", pinned to Eastern so the server's UTC
 *  clock never shifts what the office reads. */
function fmtClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  } catch {
    return '';
  }
}

function ageDays(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}
function ageLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = ageDays(iso);
  return d === 0 ? 'published today' : d === 1 ? 'published yesterday' : `published ${d} days ago`;
}
function deadlineLabel(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return `claim by ${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  } catch {
    return null;
  }
}

export default async function PacketDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const packet = await loadPacketDetail(id, { revealAccess: true });
  if (!packet) notFound();

  const review =
    packet.status === 'submitted' || packet.status === 'approved' ? await loadPacketReview(id) : [];

  const { data: evData } = await fieldDb()
    .from('packet_events')
    .select('event_type, actor_email, created_at')
    .eq('packet_id', id)
    .order('created_at', { ascending: false })
    .limit(8);
  const events = (evData ?? []) as { event_type: string; actor_email: string | null; created_at: string }[];

  // How the awarded inspector wants to be paid — surfaced beside Mark paid so
  // the operator doesn't have to dig through the roster to send the money.
  const paySummary = packet.awarded_contractor_id
    ? (await loadPaymentSummaries()).get(packet.awarded_contractor_id) ?? null
    : null;

  const editable = packet.status === 'draft';
  const isLive = isLiveStatus(packet.status);

  // Attaching work slips + instructions is allowed any time the packet is still
  // live (incl. after a contractor claims it); locked once submitted/closed.
  const attachEditable = isAttachableStatus(packet.status);
  const attachableByStop = attachEditable
    ? await Promise.all(packet.stops.map((s) => loadAttachableSlips(s.property_id)))
    : packet.stops.map(() => []);

  // Properties you can drop onto this trip as another stop (an inspection or a
  // task). Only while the trip can still take one; exclude homes already on it.
  const canAddStop = ['draft', 'published', 'claimed', 'in_progress'].includes(packet.status);
  const onTrip = new Set(packet.stops.map((s) => s.property_id));
  const addableProps = canAddStop
    ? (((await fieldDb().from('properties').select('id, name, address').order('name')).data ?? []) as { id: string; name: string | null; address: string | null }[]).filter((p) => !onTrip.has(p.id))
    : [];

  // The claimable pool for this packet (active, onboarded, cleared, same trade),
  // ranked the way the SMS blast ranks it — reliability first, then distance —
  // and tagged with each inspector's tier + miles to the cluster. Drives both
  // the coverage strip ("will this get claimed?") and the assign dropdown.
  type CRow = Pick<ContractorRow, 'id' | 'full_name' | 'status' | 'w9_on_file' | 'agreement_signed_at' | 'background_check_status'> & {
    home_lat: number | null; home_lng: number | null; service_radius_miles: number | null; phone: string | null;
  };
  type PoolMember = { id: string; full_name: string; tier: ReliabilityTier; score: number | null; miles: number | null; inRadius: boolean; hasPhone: boolean };
  let assignable: PoolMember[] = [];
  if (isAssignableStatus(packet.status)) {
    const [{ data: cData }, reliability] = await Promise.all([
      fieldDb()
        .from('contractors')
        .select('id, full_name, status, w9_on_file, agreement_signed_at, background_check_status, home_lat, home_lng, service_radius_miles, phone')
        .eq('trade', packet.trade)
        .eq('status', 'active'),
      getContractorReliability(),
    ]);
    assignable = ((cData ?? []) as CRow[])
      .filter((c) => canClaim(c) && c.id !== packet.awarded_contractor_id)
      .map((c) => {
        const rel = reliability.get(c.id);
        const miles =
          c.home_lat != null && c.home_lng != null && packet.centroid_lat != null && packet.centroid_lng != null
            ? haversineMiles({ lat: c.home_lat, lng: c.home_lng }, { lat: packet.centroid_lat, lng: packet.centroid_lng })
            : null;
        const inRadius = miles == null ? true : miles <= (c.service_radius_miles ?? 40);
        return { id: c.id, full_name: c.full_name, tier: rel?.tier ?? 'new', score: rel?.score ?? null, miles, inRadius, hasPhone: !!c.phone };
      })
      .sort((a, b) => (b.score ?? 70) - (a.score ?? 70) || (a.miles ?? 9999) - (b.miles ?? 9999));
  }

  // Coverage summary for a published, not-yet-claimed packet: who would actually
  // get pinged (in radius + has a phone), their tier mix, and the nearest one.
  const eligible = assignable.filter((p) => p.inRadius && p.hasPhone);
  const tierCounts = { top: 0, steady: 0, new: 0, watch: 0 } as Record<ReliabilityTier, number>;
  for (const e of eligible) tierCounts[e.tier]++;
  const nearestMi = eligible.reduce<number | null>((m, e) => (e.miles == null ? m : m == null ? e.miles : Math.min(m, e.miles)), null);
  const showCoverage = packet.status === 'published' && !packet.awarded_contractor_id;
  // Live progress, so the office can watch a claimed visit move stop-by-stop.
  const doneCount = packet.stops.filter((s) => s.status === 'complete' || s.status === 'skipped').length;
  const tracking = isWorkingStatus(packet.status) && packet.stops.length > 0;

  // Finalize-payout inputs (submitted / approved-unpaid): the same pricing
  // formula re-run on ACTUAL minutes on site, as a decision aid. Estimate =
  // posted_price_cents; suggestion swaps size-based on-site time for the real
  // door-to-door timestamps, drive + rush unchanged. Office-only.
  const finalizing = packet.status === 'submitted' || (packet.status === 'approved' && !packet.paid_at);
  const stopMinsActual = packet.stops.map((s) => stopMins(s));
  const minsTotal = stopMinsActual.reduce<number>((a, m) => a + (m ?? 0), 0);
  const stopsTimed = stopMinsActual.filter((m) => m != null).length;
  const suggestedCents = suggestFinalCents({
    onSiteMinutesActual: stopMinsActual,
    fallbackOnSiteCents: packet.stops.map((s) => s.base_price_cents),
    spreadMiles: packet.max_pairwise_miles ?? 0,
    center: packet.centroid_lat != null && packet.centroid_lng != null ? { lat: packet.centroid_lat, lng: packet.centroid_lng } : null,
    isRush: isRushVisit(packet.visit_date),
  });
  const trackPct = packet.stops.length ? Math.round((doneCount / packet.stops.length) * 100) : 0;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="work" />
      <section className="max-w-[900px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <Link href="/operations/packets" style={{ fontSize: 12, color: 'var(--ink-4)', textDecoration: 'none' }}>← All packets</Link>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginTop: 12, borderBottom: '1px solid var(--ink)', paddingBottom: 16, flexWrap: 'wrap' }}>
          <div>
            <div className="font-serif" style={{ fontSize: 26, fontWeight: 400 }}>{packet.title}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span>{fmtDate(packet.visit_date)}{fmtVisitTime(packet.visit_time) ? ` · ${fmtVisitTime(packet.visit_time)}` : ''} · {packet.stop_count} stops</span>
              {packet.complete_by && (
                <>
                  <span>·</span>
                  <span style={{ color: 'var(--signal)', fontWeight: 600 }}>done by {fmtVisitTime(packet.complete_by)}</span>
                </>
              )}
              {packet.contractor && (
                <>
                  <span>·</span>
                  <FieldAvatar name={packet.contractor.full_name} url={packet.contractor.photo_url} size={20} />
                  <span>{packet.contractor.full_name}</span>
                </>
              )}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--signal)' }}>{packet.status}</div>
            <div className="font-mono" style={{ fontSize: 24, marginTop: 4 }}>{dollars(effectiveBaseCents(packet))}</div>
            <div style={{ fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', marginTop: 2 }}>
              {isPayoutFinal(packet) ? 'Final' : 'Estimated'}
            </div>
            {packet.bonus_cents > 0 && (
              <div style={{ fontSize: 12, color: 'var(--signal)', fontWeight: 600, marginTop: 2 }} title={packet.bonus_reason ?? undefined}>
                + {dollars(packet.bonus_cents)} bonus
              </div>
            )}
            {isLive && packet.entry_code && (
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
                entry <span className="font-mono" style={{ color: 'var(--ink-3)' }}>{packet.entry_code}</span>
              </div>
            )}
          </div>
        </div>

        {showCoverage && (
          <div style={{ marginTop: 18, border: `1px solid ${eligible.length === 0 ? 'var(--signal)' : 'var(--rule)'}`, borderRadius: 10, padding: '12px 16px', background: eligible.length === 0 ? 'rgba(200,90,58,0.06)' : 'var(--paper-2, #fff)' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 6 }}>Coverage</div>
            {eligible.length === 0 ? (
              <div style={{ fontSize: 13.5, color: 'var(--signal)', lineHeight: 1.5 }}>
                No inspectors are in range for this one{nearestMi == null && assignable.length > 0 ? ' with a location on file' : ''}. Assign someone below, widen a contractor&apos;s service area, or move the date.
              </div>
            ) : (
              <div style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.6, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <span><strong>{eligible.length}</strong> {eligible.length === 1 ? 'inspector' : 'inspectors'} in range</span>
                <span style={{ color: 'var(--ink-4)' }}>
                  ({[
                    tierCounts.top ? `${tierCounts.top} top` : null,
                    tierCounts.steady ? `${tierCounts.steady} steady` : null,
                    tierCounts.new ? `${tierCounts.new} new` : null,
                    tierCounts.watch ? `${tierCounts.watch} watch` : null,
                  ].filter(Boolean).join(' · ')})
                </span>
                {nearestMi != null && <span style={{ color: 'var(--ink-3)' }}>· nearest {nearestMi < 1 ? '<1' : Math.round(nearestMi)} mi</span>}
              </div>
            )}
            <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {ageLabel(packet.published_at) && <span>{ageLabel(packet.published_at)}</span>}
              {deadlineLabel(packet.claim_deadline) && <><span>·</span><span>{deadlineLabel(packet.claim_deadline)}</span></>}
            </div>
          </div>
        )}

        {tracking && (() => {
          // The same delivery-style route the inspector sees, from the office
          // side: done stops tide, current stop signal, upcoming hollow, with
          // per-stop verified-entry marks. Numbering matches the stop list.
          const sorted = packet.stops;
          const firstOpenIdx = sorted.findIndex((s) => s.status !== 'complete' && s.status !== 'skipped');
          const routeStops = sorted.map((s, i) => ({
            label: s.property.name,
            lat: s.property.latitude ?? NaN,
            lng: s.property.longitude ?? NaN,
            order: s.walk_order,
            num: i + 1,
            state: (s.status === 'complete' || s.status === 'skipped'
              ? 'done'
              : i === firstOpenIdx
                ? 'current'
                : 'next') as 'done' | 'current' | 'next',
            verified: !!s.arrived_verified_at,
          }));
          const closedMins = sorted.reduce((sum, s) => sum + (stopMins(s) ?? 0), 0);
          const current = firstOpenIdx >= 0 ? sorted[firstOpenIdx] : null;
          const currentStart = current && current.status === 'in_progress' ? stopStart(current) : null;
          return (
            <div style={{ marginTop: 18 }}>
              {/* Keep the office view breathing while a trip is live. */}
              <AutoRefresh />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6, gap: 12, flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--ink-3)' }}>
                  {packet.contractor ? `${packet.contractor.full_name} · ` : ''}{doneCount} of {packet.stops.length} stops done
                  {closedMins > 0 && <span style={{ color: 'var(--ink-4)' }}> · {closedMins} min on site so far</span>}
                </span>
                <span style={{ color: packet.status === 'in_progress' ? 'var(--tide-deep)' : 'var(--ink-4)' }}>
                  {currentStart ? (
                    <>at {current!.property.name} · <OnSite startIso={currentStart} endIso={null} live /></>
                  ) : packet.status === 'in_progress' ? (
                    'between stops'
                  ) : (
                    'claimed · not started'
                  )}
                </span>
              </div>
              <div style={{ height: 8, borderRadius: 999, background: 'var(--rule)', overflow: 'hidden', marginBottom: 12 }}>
                <div style={{ height: '100%', width: `${trackPct}%`, background: 'var(--positive)', transition: 'width .3s ease' }} />
              </div>
              <PacketRouteMap stops={routeStops} />
            </div>
          );
        })()}

        {review.length > 0 && (
          <div style={{ marginTop: 20, border: '1px solid var(--rule)', borderRadius: 10, padding: '14px 18px', background: 'var(--paper-2, #fff)' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 10 }}>
              Inspection summary
            </div>
            {review.map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: i ? '1px solid var(--rule)' : 'none', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 160, flex: 1 }}>
                  <div className="font-serif" style={{ fontSize: 15 }}>{r.propertyName}</div>
                  {r.kind === 'maintenance' ? (
                    <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                      <span style={{ color: 'var(--ink)' }}>{r.title}</span>
                      {r.note ? <> — {r.note}</> : <span style={{ color: 'var(--signal)' }}> — no note</span>}
                    </div>
                  ) : (
                    r.issues.length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--signal)', marginTop: 2 }}>{r.issues.join(', ')}</div>
                    )
                  )}
                  {r.kind === 'maintenance' && r.photoUrls && r.photoUrls.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {r.photoUrls.map((u, j) => (
                        <a key={j} href={u} target="_blank" rel="noopener noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={u} alt="" style={{ width: 56, height: 56, objectFit: 'cover', border: '1px solid var(--rule)', borderRadius: 6 }} />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                  {r.kind === 'maintenance' ? (
                    <span>{r.photos} {r.photos === 1 ? 'photo' : 'photos'}</span>
                  ) : (
                    <>
                      <span style={{ color: 'var(--positive)' }}>{r.pass} pass</span>
                      {r.issue > 0 && <span style={{ color: 'var(--signal)' }}> · {r.issue} issue</span>}
                      {r.na > 0 && <span> · {r.na} n/a</span>}
                      {' · '}
                      {r.photos} {r.photos === 1 ? 'photo' : 'photos'}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* See exactly what the inspector sees: the contractor page rendered
            read-only through the same code path (?office=1 = staff preview).
            Claimed → the awarded inspector's live view; else an eligible
            browser's view. */}
        <div style={{ marginTop: 14 }}>
          <Link
            href={`/field/packet/${packet.id}?office=1`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 12, color: 'var(--tide-deep)', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--rule)', borderRadius: 999, padding: '7px 14px', background: 'var(--paper-2, #fff)' }}
          >
            👁 Preview as inspector ↗
          </Link>
        </div>

        {/* Lifecycle controls: ONE loud action per state; everything else is a
            quiet utility link so the page doesn't shout five buttons at once. */}
        <div style={{ marginTop: 18 }}>
          {(editable || packet.status === 'submitted' || (packet.status === 'approved' && !packet.paid_at)) && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              {editable && (
                <>
                  <form action={setPacketPrice} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="hidden" name="packet_id" value={packet.id} />
                    <span style={{ color: 'var(--ink-4)' }}>$</span>
                    <input type="number" name="price_dollars" min={0} step={1} defaultValue={Math.round(packet.posted_price_cents / 100)} style={priceInput} />
                    <PendingButton label="Update price" busyLabel="Updating…" style={btnGhost} spinnerTone="ink" />
                  </form>
                  <form action={publishPacket}>
                    <input type="hidden" name="packet_id" value={packet.id} />
                    <PendingButton label="Publish to contractors" busyLabel="Publishing + texting inspectors…" style={btnDark} />
                  </form>
                </>
              )}
              {packet.status === 'submitted' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
                  {/* Approve is the one loud action. The bonus and the send-back
                      path are each one quiet click so they don't compete with it.
                      The bonus inputs still post with Approve when filled. */}
                  <form action={approvePacket} style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
                    <input type="hidden" name="packet_id" value={packet.id} />
                    {/* Set the final pay from actual time, then approve — one
                        action. Left blank, the estimate stands. */}
                    <FinalPayoutField
                      estimateCents={packet.posted_price_cents}
                      suggestedCents={suggestedCents}
                      minsTotal={minsTotal}
                      stopsTimed={stopsTimed}
                      stopsTotal={packet.stops.length}
                    />
                    <PendingButton label="Approve packet" busyLabel="Approving — sending reports…" style={btnDark} />
                    <details>
                      <summary style={quietSummary}>+ Add an above-and-beyond bonus ▾</summary>
                      <div style={{ marginTop: 10 }}><BonusFields /></div>
                    </details>
                  </form>
                  <details>
                    <summary style={quietSummary}>Send back for changes instead ▾</summary>
                    <form action={requestChanges} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                      <input type="hidden" name="packet_id" value={packet.id} />
                      <input name="note" placeholder="What to fix (optional)" style={{ ...priceInput, width: 200 }} />
                      <PendingButton label="Request changes" busyLabel="Sending…" style={btnGhost} />
                    </form>
                  </details>
                </div>
              )}
              {packet.status === 'approved' && !packet.paid_at && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* Adjust the final pay any time before it's paid (decide-later,
                      like the bonus). Quiet once it's been set; open while it's
                      still just the estimate so she's nudged to confirm it. */}
                  <details open={!isPayoutFinal(packet)}>
                    <summary style={quietSummary}>
                      {isPayoutFinal(packet)
                        ? `Final pay: ${dollars(effectiveBaseCents(packet))} — adjust ▾`
                        : `Payout is still the ${dollars(packet.posted_price_cents)} estimate — set the final ▾`}
                    </summary>
                    <form action={finalizePacketPayout} style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start', marginTop: 10 }}>
                      <input type="hidden" name="packet_id" value={packet.id} />
                      <FinalPayoutField
                        estimateCents={packet.posted_price_cents}
                        suggestedCents={suggestedCents}
                        minsTotal={minsTotal}
                        stopsTimed={stopsTimed}
                        stopsTotal={packet.stops.length}
                        currentFinalCents={packet.final_payout_cents}
                      />
                      <PendingButton label="Set final pay" busyLabel="Saving…" style={btnGhost} spinnerTone="ink" />
                    </form>
                  </details>
                  {/* The actual payment happens outside Helm — say exactly where
                      to send it, then record it here. */}
                  <div style={{ fontSize: 13, color: 'var(--ink-3)', display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    {paySummary ? (
                      <>
                        <span>
                          Pay {packet.contractor?.full_name ?? 'the inspector'} via{' '}
                          <strong style={{ color: 'var(--ink)' }}>{paySummary.method}</strong>
                          {paySummary.hint ? <span className="font-mono" style={{ color: 'var(--ink)' }}> · {paySummary.hint}</span> : null}
                        </span>
                        {paySummary.hasDetails && paySummary.method === 'Direct deposit (ACH)' && packet.awarded_contractor_id && (
                          <RevealPay contractorId={packet.awarded_contractor_id} />
                        )}
                        <span style={{ color: 'var(--ink-4)' }}>then record it:</span>
                      </>
                    ) : (
                      <span style={{ color: 'var(--signal)' }}>
                        No payout method on file — <Link href="/operations/contractors" style={{ color: 'var(--signal)' }}>check the roster</Link>, then record it:
                      </span>
                    )}
                  </div>
                  <form action={markPacketPaid} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="hidden" name="packet_id" value={packet.id} />
                    <input name="reference" placeholder="ref # (optional)" style={{ ...priceInput, width: 130 }} />
                    <PendingButton label={`Mark paid · ${dollars(totalPayoutCents(packet))}`} busyLabel="Recording + receipt…" style={btnDark} />
                  </form>
                  {/* Decide-later bonus: quiet by default so Mark paid stays the
                      focus; opens on its own when a bonus is already set. */}
                  <details open={packet.bonus_cents > 0}>
                    <summary style={quietSummary}>
                      {packet.bonus_cents > 0 ? `Bonus: ${dollars(packet.bonus_cents)} — edit ▾` : '+ Add a bonus ▾'}
                    </summary>
                    <form action={setPacketBonus} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                      <input type="hidden" name="packet_id" value={packet.id} />
                      <BonusFields
                        defaultDollars={packet.bonus_cents > 0 ? Math.round(packet.bonus_cents / 100) : undefined}
                        defaultReason={packet.bonus_reason}
                      />
                      <button type="submit" style={btnGhost}>{packet.bonus_cents > 0 ? 'Update bonus' : 'Add bonus'}</button>
                    </form>
                  </details>
                </div>
              )}
            </div>
          )}

          {packet.status === 'approved' && packet.paid_at && (
            <div style={{ fontSize: 12, color: 'var(--positive)' }}>
              Paid {dollars(totalPayoutCents(packet))}
              {packet.bonus_cents > 0 ? ` (incl. ${dollars(packet.bonus_cents)} bonus)` : ''}
              {' '}on {new Date(packet.paid_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              {packet.contractor ? ` to ${packet.contractor.full_name}` : ''}
              {packet.paid_method && (
                <span style={{ color: 'var(--ink-4)' }}> · via {packet.paid_method}{packet.paid_reference ? ` · ${packet.paid_reference}` : ''}</span>
              )}
            </div>
          )}

          {/* Quiet utilities — rarely used, so they whisper. */}
          {isLive && (
            <div style={{ display: 'flex', gap: 18, alignItems: 'baseline', flexWrap: 'wrap', marginTop: 14 }}>
              {(isAssignableStatus(packet.status)) && assignable.length > 0 && (
                <details style={{ position: 'relative' }}>
                  <summary style={quietSummary}>{packet.status === 'claimed' ? 'Reassign' : 'Assign directly'} ▾</summary>
                  <div style={menuCard}>
                    <div style={{ fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, padding: '2px 0 6px' }}>
                      Hand this trip to
                    </div>
                    {assignable.map((c, i) => (
                      <form key={c.id} action={assignPacket} style={{ margin: 0, borderTop: i ? '1px solid var(--rule)' : 'none' }}>
                        <input type="hidden" name="packet_id" value={packet.id} />
                        <input type="hidden" name="contractor_id" value={c.id} />
                        <PendingButton
                          busyLabel="Assigning…"
                          spinnerTone="ink"
                          style={menuRow}
                          label={
                            // Inner wrapper keeps the name / tier space-between layout —
                            // the shared button centers its own children.
                            <span style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 14 }}>
                              <span style={{ fontSize: 13.5, color: 'var(--ink)' }}>{c.full_name}</span>
                              <span style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>
                                {TIER_LABEL[c.tier]}{c.miles != null ? ` · ${c.miles < 1 ? '<1' : Math.round(c.miles)} mi` : ''}
                              </span>
                            </span>
                          }
                        />
                      </form>
                    ))}
                  </div>
                </details>
              )}
              {(editable || packet.status === 'published') && (
                <details style={{ position: 'relative' }}>
                  <summary style={quietSummary}>Move date / time ▾</summary>
                  <div style={menuCard}>
                    <form action={setPacketVisitDate} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <input type="hidden" name="packet_id" value={packet.id} />
                      <input type="date" name="visit_date" defaultValue={packet.visit_date} style={{ ...priceInput, width: 150 }} />
                      <input type="time" name="visit_time" defaultValue={packet.visit_time ?? ''} title="Optional start time; leave blank for anytime that day" style={{ ...priceInput, width: 110 }} />
                      <PendingButton label="Set" busyLabel="Setting…" style={btnGhost} spinnerTone="ink" />
                    </form>
                  </div>
                </details>
              )}
              {attachEditable && (
                <details style={{ position: 'relative' }}>
                  <summary style={quietSummary}>Complete by ▾</summary>
                  <div style={menuCard}>
                    <form action={setPacketCompleteBy} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <input type="hidden" name="packet_id" value={packet.id} />
                      <input type="time" name="complete_by" defaultValue={packet.complete_by?.slice(0, 5) ?? ''} title="Deadline shown to the inspector; flags them late on the board if missed" style={{ ...priceInput, width: 110 }} />
                      <PendingButton label="Set" busyLabel="Setting…" style={btnGhost} spinnerTone="ink" />
                    </form>
                    {packet.complete_by && (
                      <form action={setPacketCompleteBy} style={{ margin: '6px 0 0' }}>
                        <input type="hidden" name="packet_id" value={packet.id} />
                        <input type="hidden" name="complete_by" value="" />
                        <PendingButton label="Clear deadline" busyLabel="Clearing…" style={{ ...btnGhost, color: 'var(--ink-4)' }} spinnerTone="ink" />
                      </form>
                    )}
                  </div>
                </details>
              )}
              {(packet.status === 'claimed' || packet.status === 'in_progress') && (
                <details style={{ position: 'relative' }}>
                  <summary style={quietSummary}>Adjust estimate ▾</summary>
                  <div style={menuCard}>
                    <form action={raisePacketEstimate} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <input type="hidden" name="packet_id" value={packet.id} />
                      <span style={{ fontSize: 14, color: 'var(--ink-4)' }}>$</span>
                      <input type="number" name="price_dollars" min={Math.round(packet.posted_price_cents / 100) + 1} step={1} defaultValue={Math.round(packet.posted_price_cents / 100)} style={{ ...priceInput, width: 90 }} />
                      <input name="reason" placeholder="reason (optional)" maxLength={500} style={{ ...priceInput, width: 150 }} />
                      <PendingButton label="Raise pay" busyLabel="Saving…" style={btnGhost} spinnerTone="ink" />
                    </form>
                    <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 8, maxWidth: 230, lineHeight: 1.45 }}>
                      Raise only — {dollars(packet.posted_price_cents)} is what {packet.contractor?.full_name ?? 'the contractor'} agreed to, and we&apos;ll email them the new amount. To lower it, release the claim first.
                    </div>
                  </div>
                </details>
              )}
              {canAddStop && addableProps.length > 0 && (
                <details style={{ position: 'relative' }}>
                  <summary style={quietSummary}>Add a stop ▾</summary>
                  <div style={menuCard}>
                    <form action={addPacketStop} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 250 }}>
                      <input type="hidden" name="packet_id" value={packet.id} />
                      <select name="property_id" required defaultValue="" style={{ ...priceInput, width: '100%' }}>
                        <option value="" disabled>Choose a property…</option>
                        {addableProps.map((p) => (
                          <option key={p.id} value={p.id}>{p.name || p.address}</option>
                        ))}
                      </select>
                      <input name="instructions" placeholder="What to do (blank = full inspection)" maxLength={500} style={{ ...priceInput, width: '100%' }} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 14, color: 'var(--ink-4)' }}>$</span>
                        <input type="number" name="price_dollars" min={1} step={1} placeholder="pay" required style={{ ...priceInput, width: 80 }} />
                        <PendingButton label="Add stop" busyLabel="Adding…" style={btnGhost} spinnerTone="ink" />
                      </div>
                      {(packet.status === 'claimed' || packet.status === 'in_progress') && (
                        <div style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.45 }}>
                          Adds to {packet.contractor?.full_name ?? 'the contractor'}&apos;s route and pay; we&apos;ll email them the change.
                        </div>
                      )}
                    </form>
                  </div>
                </details>
              )}
              {canAddStop && (
                <form action={syncPacketWindows} style={{ margin: 0 }} title="Re-check each stop's window (vacant / after checkout / before check-in) against current bookings">
                  <input type="hidden" name="packet_id" value={packet.id} />
                  <PendingButton label="Sync windows" busyLabel="Syncing…" style={quietCtl} spinnerTone="ink" />
                </form>
              )}
              {packet.status === 'published' && (
                <form action={unpublishPacket} style={{ margin: 0 }}>
                  <input type="hidden" name="packet_id" value={packet.id} />
                  <PendingButton label="Unpublish" busyLabel="Unpublishing…" style={quietCtl} spinnerTone="ink" />
                </form>
              )}
              {packet.status === 'claimed' && (
                <form action={releasePacket} style={{ margin: 0 }} title="Release back to the open marketplace and re-notify inspectors">
                  <input type="hidden" name="packet_id" value={packet.id} />
                  <PendingButton label="Release claim" busyLabel="Releasing…" style={quietCtl} spinnerTone="ink" />
                </form>
              )}
              {packet.status !== 'submitted' && (
                <form action={cancelPacket} style={{ margin: 0 }}>
                  <input type="hidden" name="packet_id" value={packet.id} />
                  <PendingButton label="Cancel packet" busyLabel="Cancelling…" style={{ ...quietCtl, color: 'var(--signal)' }} spinnerTone="ink" />
                </form>
              )}
            </div>
          )}
        </div>

        {/* Stops — StopList owns the order (drag ⋮⋮ to reorder, optimistic);
            each row's content stays server-rendered and is passed in by id. */}
        <div style={{ marginTop: 30, borderTop: '1px solid var(--rule)', paddingTop: 18 }}>
          <PacketInstructions packetId={packet.id} instructions={packet.instructions} editable={attachEditable} />
          <StopList
            packetId={packet.id}
            canReorder={canAddStop}
            items={packet.stops.map((s, i) => ({
              id: s.id,
              node: (
            <>
              <div style={{ flex: 1 }}>
                <div className="font-serif" style={{ fontSize: 16 }}>{s.property.name}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 2 }}>
                  {s.property.address} · {windowLabel(s)}
                </div>
                {/* The visit ledger: when they got in (door-verified when the
                    lock saw their code) and how long they were inside. */}
                {(() => {
                  const start = stopStart(s);
                  if (!start) return null;
                  const mins = stopMins(s);
                  const live = s.status === 'in_progress' && !s.departed_at;
                  return (
                    <div style={{ fontSize: 12, marginTop: 3, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline' }}>
                      <span style={{ color: 'var(--ink-3)' }}>arrived {fmtClock(start)}</span>
                      {s.arrived_verified_at && <span style={{ color: 'var(--positive)' }}>✓ door verified</span>}
                      {live ? (
                        <span style={{ color: 'var(--tide-deep)', fontWeight: 600 }}><OnSite startIso={start} endIso={null} live /></span>
                      ) : mins != null ? (
                        <span style={{ color: 'var(--ink-4)' }}>· {mins} min on site</span>
                      ) : null}
                    </div>
                  );
                })()}
                <StopAttachments
                  packetId={packet.id}
                  stopId={s.id}
                  stopWorkSlipId={s.work_slip_id}
                  attached={s.attachedSlips}
                  attachable={attachableByStop[i]}
                  instructions={s.instructions}
                  editable={attachEditable}
                />
              </div>
              <div style={{ textAlign: 'right', fontSize: 12 }}>
                {s.inspection_id ? (
                  <Link href={`/inspections/${s.inspection_id}/summary`} style={{ color: 'var(--tide-deep)', textDecoration: 'none' }}>
                    {s.status === 'complete' ? 'View inspection →' : 'In progress →'}
                  </Link>
                ) : (
                  <span style={{ color: 'var(--ink-4)' }}>{s.status}</span>
                )}
                {editable && packet.stop_count > 1 && (
                  <form action={removeStop} style={{ marginTop: 4 }}>
                    <input type="hidden" name="packet_id" value={packet.id} />
                    <input type="hidden" name="stop_id" value={s.id} />
                    <PendingButton label="remove" busyLabel="removing…" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 11, textDecoration: 'underline' }} spinnerTone="ink" />
                  </form>
                )}
              </div>
            </>
              ),
            }))}
          />
        </div>

        {events.length > 0 && (
          <details style={{ marginTop: 28 }}>
            <summary style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 8, cursor: 'pointer', userSelect: 'none' }}>Activity</summary>
            <div style={{ marginTop: 8 }}>
              {events.map((e, i) => (
                <div key={i} style={{ fontSize: 12, color: 'var(--ink-3)', padding: '3px 0' }}>
                  {e.event_type.replace(/_/g, ' ')}
                  {e.actor_email ? ` · ${e.actor_email}` : ''}
                  {' · '}
                  {new Date(e.created_at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </div>
              ))}
            </div>
          </details>
        )}
      </section>
      <HelmFooter module="Field" right={packet.title} />
    </div>
  );
}

const priceInput: React.CSSProperties = {
  font: 'inherit',
  fontSize: 14,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  padding: '6px 8px',
  width: 90,
};
const btnDark: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: 'none',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  padding: '10px 18px',
};
const btnGhost: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  border: '1px solid var(--rule)',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  padding: '9px 16px',
};

// The whisper tier: rarely-used levers render as small underlined text, not
// another bordered button competing with the primary action.
const quietCtl: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--ink-4)',
  fontSize: 12,
  textDecoration: 'underline',
  textUnderlineOffset: 3,
  padding: 0,
};
// display:flex on summary drops the native disclosure triangle cross-browser.
const quietSummary: React.CSSProperties = { ...quietCtl, display: 'flex', listStyle: 'none', userSelect: 'none' };
const menuCard: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  left: 0,
  zIndex: 30,
  minWidth: 280,
  background: 'var(--paper-2, #fff)',
  border: '1px solid var(--rule)',
  borderRadius: 10,
  boxShadow: '0 10px 28px rgba(11,37,69,0.14)',
  padding: '10px 16px',
};
const menuRow: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 14,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  textAlign: 'left',
  padding: '9px 0',
};
