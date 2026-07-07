'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { channelAccent } from '@/lib/channel-style';
import { SubmitButton } from '@/components/SubmitButton';
import type { Turnover } from '@/lib/operations';
import { TurnoverRail } from './TurnoverRail';
import { PlanButton } from './PlanButton';
import { startInspection } from '../inspections/actions';
import { markTurnoverComplete, unmarkTurnoverComplete } from './turnover-actions';
import {
  fieldChipLabel,
  fieldChipColor,
  formatDateShort,
  guestDisplay,
  INSPECTING_TEXT_HUE,
  lifecycleOf,
  STAGE_HUES,
  type StageCls,
} from './turnover-format';

/**
 * One dense, ~38px turnover line: date · property+guest · a 6-pip micro-rail ·
 * a live readout · the primary action. Click anywhere on the line to expand
 * it in place into the full labeled TurnoverRail + the secondary affordances
 * (plan, slips, field, battery, mark-done). Reuses the rail's exact state
 * vocabulary at small size; only genuinely-active rows pulse/tick. Responsive:
 * the line wraps cleanly on phones (the old grid-with-180px-indent rail was
 * the mobile breakage).
 */
export function CompactTurnoverRow({
  t,
  myEmail,
  hideDate = false,
}: {
  t: Turnover;
  myEmail: string;
  /** Under a datebook day divider the check-in date is already printed by
   *  the divider, so the row drops its leading serif date and keeps only
   *  the mono "→ checkout · nights" trailer. */
  hideDate?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const haloRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const isDone = t.inspectionStatus === 'complete' || t.manuallyCompleted;
  const todayStr = new Date(now).toISOString().slice(0, 10);
  const lc = lifecycleOf(t, now, todayStr);

  // Slow breathe on the active pip's halo. Re-arm ONLY when the active stage
  // (or its overdue hue) changes — with no dep array, the 1s `now` tick was
  // cancelling and restarting the 2s animation every render, which read as a
  // 1Hz blink stuck near peak opacity instead of a calm breathe.
  useEffect(() => {
    const el = haloRef.current;
    if (!el) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const a = el.animate([{ opacity: 0.5 }, { opacity: 0.06 }, { opacity: 0.5 }], {
      duration: 2000,
      iterations: Infinity,
      easing: 'ease-in-out',
    });
    return () => a.cancel();
  }, [lc.active, lc.overdue]);

  // Readout: cleaning-in-progress counts up off real entry; otherwise count
  // down to check-in; done rows show a calm mark.
  let readout = '';
  let roColor = 'var(--ink-4)';
  if (isDone) {
    readout = '✓ done';
    roColor = 'var(--positive)';
  } else if (lc.active === 'cleaning' && lc.enteredAt) {
    readout = `cleaning ${elapsed(lc.enteredAt, now)}`;
    roColor = STAGE_HUES[2]; // cleaning stage identity — matches pip + header dot
  } else if (lc.active === 'clean') {
    // Lockless home, due, not yet cleaned: no lock signal is coming, so the
    // honest readout is "needs clean" (red once past the check-in target),
    // never a false "awaiting cleaner" or a fake elapsed counter. Must sit
    // ahead of the countdown fallback below.
    readout = 'needs clean';
    roColor = lc.overdue ? 'var(--negative)' : 'var(--signal)';
  } else if (lc.inspecting) {
    // An inspection is genuinely underway (app start, or a master-code unlock):
    // count up off its real start, not a bare countdown.
    readout = lc.inspectionStartedAt ? `inspecting ${elapsed(lc.inspectionStartedAt, now)}` : 'inspecting';
    roColor = INSPECTING_TEXT_HUE; // shared with the header stage-strip dot
  } else if (lc.active === 'inspected') {
    // Cleaned and due, but no inspection has started: the actionable state is
    // "needs inspection", not a bare countdown to check-in.
    readout = 'needs inspection';
    roColor = lc.overdue ? 'var(--negative)' : 'var(--signal)';
  } else {
    const cd = countdown(t.checkIn, now);
    readout = cd.text;
    roColor = lc.overdue || cd.urgency === 'now' ? 'var(--negative)' : cd.urgency === 'soon' ? 'var(--signal)' : 'var(--ink-4)';
  }

  const batteryLow = t.lockBattery?.isLow;

  return (
    <div
      id={`turnover-${t.propertyId}-${t.reservationId}`}
      className="rt-tn-row"
      style={{ opacity: isDone ? 0.5 : 1, scrollMarginTop: 96 }}
      onClick={() => setOpen((o) => !o)}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onKeyDown={(e) => {
        // Keydown bubbles from the inner Start / Resume / Undo / Mark-done
        // controls (the stopPropagation on those wrappers only covers click),
        // and preventDefault below would swallow their native activation.
        // Only toggle when the row ITSELF is the focused target.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setOpen((o) => !o);
        }
      }}
    >
      <div className="rt-tn-main">
        <div className="rt-tn-date">
          {!hideDate && (
            <span className="font-serif" style={{ fontSize: 13.5, color: isDone ? 'var(--ink-3)' : 'var(--ink)' }}>
              {formatDateShort(t.checkIn)}
            </span>
          )}
          {!isDone && (
            // Class-targeted (not positional) so the mobile "shed the
            // checkout trailer" rule still hits it when hideDate removes
            // the serif date span and this becomes the first child.
            <span className="rt-tn-co" style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 10, color: 'var(--ink-4)' }}>
              {hideDate ? '' : ' '}
              → {formatDateShort(t.checkOut)}
              {t.nights ? ` · ${t.nights}n` : ''}
            </span>
          )}
        </div>
        <div
          className="rt-tn-prop"
          title={`${t.propertyName} · ${guestDisplay(t.guestName)}${t.isSameDayTurnover ? ' · same-day turn' : ''}`}
        >
          {t.isSameDayTurnover && !isDone && <span className="rt-tn-sd" title="Same-day turnover" />}
          <span className="font-serif" style={{ fontSize: 13.5, color: isDone ? 'var(--ink-3)' : 'var(--ink)' }}>
            {t.propertyName}
          </span>
          {(() => {
            // Hold placeholders ('Reservation HMYZR2RYJD') render as an
            // italic, dim 'Hold' — status, not a person — same as the
            // occupancy calendar below.
            const g = guestDisplay(t.guestName);
            const isHold = g === 'Hold';
            return (
              <span style={{ fontSize: 11, color: 'var(--ink-4)', fontStyle: isHold ? 'italic' : 'normal' }}>
                {' '}· {g}
              </span>
            );
          })()}
          {t.channel && (
            <span
              aria-hidden
              style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: channelAccent(t.channel), marginLeft: 5, verticalAlign: 1 }}
            />
          )}
          {batteryLow && !isDone && (
            <span title="Low smart-lock battery — pack spares" style={{ color: 'var(--negative)', fontSize: 11, marginLeft: 7 }}>
              ⚠ battery
            </span>
          )}
          {t.prepSlips.length > 0 && !isDone && (
            <span
              title={t.prepSlips.map((s) => s.actionSummary || s.title).join(' · ')}
              style={{ color: 'var(--signal)', fontSize: 11, marginLeft: 7, fontWeight: 600 }}
            >
              ✧ guest prep
            </span>
          )}
        </div>
      </div>

      <div className="rt-tn-state">
        <MicroRail pips={lc.pips} overdue={lc.overdue} haloRef={haloRef} />
        <span className="rt-tn-readout" style={{ color: roColor }}>
          {readout}
        </span>
      </div>

      <div className="rt-tn-act" onClick={(e) => e.stopPropagation()}>
        <PrimaryAction t={t} isDone={isDone} />
      </div>

      {open && (
        <div className="rt-tn-exp" onClick={(e) => e.stopPropagation()}>
          <TurnoverRail
            expected={lc.checkedOut}
            enteredAt={t.cleaningSession?.enteredAt ?? null}
            cleanedAt={t.cleaningSession?.finishedAt ?? t.cleaning?.completedAt ?? null}
            cleanedEstimated={lc.cleanedEstimated}
            cleanedSource={t.cleaningSession?.finishSource ?? null}
            enteredViaLock={t.cleaningSession?.entrySource === 'seam_lock'}
            inspected={t.inspectionStatus === 'complete'}
            inspecting={lc.inspecting}
            inspectionStartedAt={t.inspectionStartedAt}
            inspectionViaLock={t.inspectionViaLock}
            checkIn={t.checkIn}
            previousCheckout={t.previousCheckout}
            propertyId={t.propertyId}
            sameDay={t.isSameDayTurnover}
            lockMonitored={t.lockMonitored}
          />
          {!isDone && (
            <div className="rt-tn-affordances">
              {!t.inspection && (
                <PlanButton
                  guestyReservationId={t.reservationId}
                  propertyId={t.propertyId}
                  checkInDate={t.checkIn.slice(0, 10)}
                  checkOutDate={t.checkOut.slice(0, 10)}
                  planId={t.plan?.id ?? null}
                  plannedForDate={t.plan?.planned_for_date ?? null}
                  plannedBy={t.plan?.planned_by_email ?? null}
                  assignedToEmail={t.plan?.assigned_to_email ?? null}
                  myEmail={myEmail}
                />
              )}
              {t.lockBattery?.isLow && (
                // Same severity color as the collapsed '⚠ battery' flag — the
                // identical fact shouldn't downgrade from rust to gold on click.
                <span style={{ color: 'var(--negative)', fontSize: 11, fontWeight: 600 }}>
                  Lock battery {t.lockBattery.pct != null ? `${t.lockBattery.pct}%` : 'low'} · bring batteries
                </span>
              )}
              {t.prepSlips.map((s) => (
                <Link
                  key={s.id}
                  href={`/work/${s.id}`}
                  // whiteSpace normal (unlike chipLink's nowrap): the summary
                  // runs ~70 chars and an unshrinkable nowrap chip would
                  // reintroduce the horizontal page scroll the compact-row
                  // redesign eliminated on phones.
                  style={{ ...chipLink, whiteSpace: 'normal', color: 'var(--signal)', fontWeight: 600 }}
                >
                  {truncate(s.actionSummary || s.title, 90)} →
                </Link>
              ))}
              {t.openWorkSlipsCount > 0 && (
                <Link href={`/properties/${t.propertyId}/work-slips/print`} style={chipLink}>
                  {t.openWorkSlipsCount} {t.openWorkSlipsCount === 1 ? 'slip' : 'slips'} · print →
                </Link>
              )}
              {t.fieldPacket && (
                <Link href={`/operations/packets/${t.fieldPacket.packetId}`} style={{ ...chipLink, color: fieldChipColor(t.fieldPacket.status), fontWeight: 600 }}>
                  {fieldChipLabel(t.fieldPacket)} →
                </Link>
              )}
              <form action={markTurnoverComplete} style={{ margin: 0 }}>
                <input type="hidden" name="property_id" value={t.propertyId} />
                <input type="hidden" name="check_in" value={t.checkIn.slice(0, 10)} />
                <input type="hidden" name="reservation_id" value={t.reservationId} />
                <input type="hidden" name="guest_name" value={t.guestName ?? ''} />
                <SubmitButton
                  label="✓ Mark done"
                  busyLabel="Marking…"
                  spinnerTone="ink"
                  style={{ ...chipLink, background: 'none', border: 'none', borderBottom: '1px dashed var(--ink-4)', cursor: 'pointer', padding: 0 }}
                />
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MicroRail({ pips, overdue, haloRef }: { pips: StageCls[]; overdue: boolean; haloRef: React.RefObject<HTMLSpanElement | null> }) {
  return (
    <div className="rt-tn-rail" aria-hidden>
      <div className="rt-tn-rline" />
      {pips.map((s, i) => {
        // Each pip carries its stage's identity hue (blue / orange / yellow /
        // green); state shows by treatment: done = solid fill, active = ring +
        // pulsing halo (red if overdue), future = neutral hollow ring.
        const H = STAGE_HUES[i];
        const active = s === 'active';
        const hotPip = overdue ? 'var(--negative)' : H;
        // 'na' = a stage this (lockless) home can't observe. A small solid
        // muted dot, distinct from the hollow 'future' ring and the colored
        // 'good', so a cleaned lockless row reads as a coherent done line with
        // two quiet passthrough middles, not a regressed / skipped gap.
        const na = s === 'na';
        const sz = na ? 5 : s === 'future' ? 6 : active ? 11 : s === 'passed' ? 7 : 9;
        const fill = na ? '#c9bda1' : s === 'good' || s === 'passed' ? H : 'var(--paper)';
        const border = na
          ? 'none'
          : active ? `2.5px solid ${hotPip}` : s === 'est' ? `2px dashed ${H}` : s === 'future' ? '1.5px solid #ddd2bd' : `2px solid ${H}`;
        return (
          <span key={i} style={{ position: 'relative', zIndex: 1, width: sz, height: sz, borderRadius: '50%', background: fill, border, boxSizing: 'border-box' }}>
            {active && (
              <span
                ref={haloRef}
                style={{ position: 'absolute', inset: -5, borderRadius: '50%', border: `1.5px solid ${hotPip}`, opacity: 0.5 }}
              />
            )}
          </span>
        );
      })}
    </div>
  );
}

function PrimaryAction({ t, isDone }: { t: Turnover; isDone: boolean }) {
  if (isDone) {
    if (t.inspectionStatus === 'complete' && t.inspection) {
      return (
        <Link href={`/inspections/${t.inspection.id}/summary`} style={{ fontSize: 11, color: 'var(--ink-3)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
          Summary →
        </Link>
      );
    }
    if (t.manuallyCompleted) {
      return (
        <form action={unmarkTurnoverComplete} style={{ margin: 0 }}>
          <input type="hidden" name="property_id" value={t.propertyId} />
          <input type="hidden" name="check_in" value={t.checkIn.slice(0, 10)} />
          <SubmitButton
            label="Undo →"
            busyLabel="Undoing…"
            spinnerTone="ink"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, color: 'var(--ink-3)', borderBottom: '1px dashed var(--ink-4)', whiteSpace: 'nowrap' }}
          />
        </form>
      );
    }
    return null;
  }
  if (t.inspection) {
    return (
      <Link href={`/inspections/${t.inspection.id}`} style={{ fontSize: 12, color: 'var(--ink)', textDecoration: 'none', whiteSpace: 'nowrap', fontWeight: 500 }}>
        Resume →
      </Link>
    );
  }
  // A LIVE Field packet (published to a contractor and beyond) covers this
  // turnover, so the staff Start CTA yields to the Field byline — otherwise
  // a staff walk and a paid contractor walk both happen. A DRAFT packet is
  // NOT yet published to anyone, so it must not block staff: a draft was
  // silently hiding Start and forcing turnovers to be marked done by hand.
  // The expanded Field chip still shows the draft exists.
  if (t.fieldPacket && t.fieldPacket.status !== 'draft') {
    return <FieldCredit fp={t.fieldPacket} />;
  }
  return (
    <form action={startInspection} style={{ margin: 0 }}>
      <input type="hidden" name="property_id" value={t.propertyId} />
      <SubmitButton label="Start" busyLabel="Starting…" className="rt-tn-start" />
    </form>
  );
}

/**
 * The Field byline — who has this walk, as editorial attribution rather than
 * chrome. A two-line right-aligned credit in the action column: an uppercase
 * micro-kicker (FIELD, or ON SITE once the contractor starts) over the
 * payload in Fraunces italic. Typographically the opposite pole from the
 * solid navy START button, so delegation reads as a state, not an action.
 * The whole stack links to the packet.
 *
 *   published            claimed / in_progress      submitted
 *   FIELD                FIELD | ON SITE            FIELD
 *   Open for claim       Delaney Jordan             Review →
 *   (gold: unassigned)   (tide-deep: delegated)     (ink: operator to-do)
 */
function FieldCredit({ fp }: { fp: NonNullable<Turnover['fieldPacket']> }) {
  if (fp.status === 'approved') return null; // done path renders elsewhere
  const claimed = fp.status === 'claimed' || fp.status === 'in_progress';
  const payload = claimed
    ? (fp.contractorName ?? 'Claimed')
    : fp.status === 'published'
      ? 'Open for claim'
      : 'Review →';
  const color = claimed ? 'var(--tide-deep)' : fp.status === 'published' ? 'var(--signal)' : 'var(--ink)';
  const walkDay = fp.visitDate ? ` · walks ${formatDateShort(fp.visitDate)}` : '';
  const title = claimed
    ? `Field packet · ${fp.contractorName ?? 'claimed'}${walkDay}`
    : fp.status === 'published'
      ? `Field packet · open for claim${walkDay}`
      : `Field packet · submitted for review`;
  return (
    <Link href={`/operations/packets/${fp.packetId}`} className="rt-tn-field" title={title}>
      {/* "On site" only when the contractor is actually AT this house — the
          packet going in_progress means they're somewhere on the route, and
          printing "On site" on every covered row (even walks days out) misled. */}
      <span className="rt-tn-field-k" style={fp.stopActive ? { color: 'var(--signal)' } : undefined}>
        {fp.stopActive ? 'On site' : 'Field'}
      </span>
      <span className="rt-tn-field-p" style={{ color, fontWeight: fp.status === 'submitted' ? 500 : 400 }}>
        {payload}
      </span>
    </Link>
  );
}


const chipLink: React.CSSProperties = { fontSize: 11, color: 'var(--tide-deep)', textDecoration: 'none', whiteSpace: 'nowrap' };

/** Keep prep-slip chip labels short enough to scan at a glance. */
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function elapsed(sinceIso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(sinceIso)) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function countdown(checkIn: string, now: number): { text: string; urgency: 'far' | 'soon' | 'now' } {
  const target = Date.parse(`${checkIn.slice(0, 10)}T16:00:00`);
  const ms = target - now;
  if (ms <= 0) return { text: 'in now', urgency: 'now' };
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  if (h >= 36) return { text: `in ${Math.round(h / 24)}d`, urgency: 'far' };
  const m = totalMin % 60;
  return { text: `in ${h}h ${m}m`, urgency: h < 6 ? 'now' : h < 12 ? 'soon' : 'far' };
}
