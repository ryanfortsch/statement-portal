'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SubmitButton } from '@/components/SubmitButton';
import { buttonClass } from '@/lib/button-class';
import type { BoardRow } from '@/lib/turnover-board';
import { TurnoverRail } from './TurnoverRail';
import { PlanButton } from './PlanButton';
import { MarkCleaned } from './MarkCleaned';
import { startInspection } from '../inspections/actions';
import { markTurnoverComplete, unmarkTurnoverComplete } from './turnover-actions';
import { fieldChipColor, fieldChipLabel, formatDateLong } from './turnover-format';

/**
 * One house on the turnover board, one line: the house, the pair
 * ("Out 10:00 · In 4:00"), the cleaner, the walk, and one verb. Every word on
 * the line was decided on the server (lib/turnover-board.ts) from one clock
 * read, so the line never ticks and never disagrees with the strip above it.
 *
 * The house name is the toggle: a real button with aria-expanded, so the
 * actions beside it are siblings, not controls nested inside a fake button.
 * Opening it shows who leaves and who arrives, then the stages: the six-stage
 * rail on a lock-monitored home, the three steps Helm can see everywhere
 * else (Out, Cleaned, Walked), and the secondary actions.
 *
 * Desktop: one grid line, columns aligned down the board. Phone: two lines,
 * the house and its verb, then the facts (see .rt-tb-* in globals.css).
 */
export function BoardLine({ row, today, myEmail }: { row: BoardRow; today: string; myEmail: string }) {
  const [open, setOpen] = useState(false);
  const t = row.turnover;
  const detailId = `${row.id}-detail`;
  const prep = !row.done && !!t && t.prepSlips.length > 0;
  const battery = !row.done && !!t?.lockBattery?.isLow;
  const fp = t?.fieldPacket ?? null;
  const fieldHref = fp && fp.status !== 'draft' && row.walk?.label.startsWith('Field') ? `/fieldwork/packets/${fp.packetId}` : null;

  return (
    <div id={row.id} className="rt-tb-row" data-done={row.done ? '' : undefined}>
      {row.outAnchor && <span id={row.outAnchor} className="rt-tb-anchor" aria-hidden />}
      <div className="rt-tb-house">
        <button
          type="button"
          className="rt-tb-toggle"
          aria-expanded={open}
          aria-controls={open ? detailId : undefined}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="rt-tb-chev" aria-hidden>
            &rsaquo;
          </span>
          <span className="rt-tb-name">{row.propertyName}</span>
        </button>
        {prep && (
          <span className="rt-tb-flag" title={t!.prepSlips.map((s) => s.actionSummary || s.title).join(' · ')}>
            Prep
          </span>
        )}
        {battery && (
          <span className="rt-tb-flag" data-tone="bad">
            Batteries
          </span>
        )}
      </div>
      <div className="rt-tb-facts">
        <span className="rt-tb-pair">
          {row.pair}
          {row.sameDay && <span className="rt-tb-sd">Same day</span>}
        </span>
        {row.cleaner && (
          <span className="rt-tb-slot rt-tb-cleaner" data-tone={row.cleaner.tone}>
            {row.cleaner.label}
          </span>
        )}
        {row.walk && (
          <span className="rt-tb-slot rt-tb-walk" data-tone={row.walk.tone}>
            {fieldHref ? <Link href={fieldHref}>{row.walk.label}</Link> : row.walk.label}
          </span>
        )}
      </div>
      <div className="rt-tb-verb">
        <Verb row={row} myEmail={myEmail} />
      </div>

      {open && (
        <div id={detailId} className="rt-tb-exp">
          <div className="rt-tb-who">
            {row.out && (
              <div>
                <span className="rt-tb-whokey">Leaving</span>
                {row.out.guest ?? 'Guest'} · {formatDateLong(row.out.date)}
              </div>
            )}
            {row.arrive && (
              <div>
                <span className="rt-tb-whokey">Arriving</span>
                {row.arrive.guest ?? 'Guest'} · {formatDateLong(row.arrive.date)}
                {row.arrive.nights ? ` · ${row.arrive.nights} ${row.arrive.nights === 1 ? 'night' : 'nights'}` : ''}
              </div>
            )}
          </div>

          {row.lockMonitored && t ? (
            <TurnoverRail
              expected={!!t.previousCheckout && t.previousCheckout <= today}
              enteredAt={t.cleaningSession?.enteredAt ?? null}
              cleanedAt={t.cleaningSession?.finishedAt ?? t.cleaning?.completedAt ?? null}
              cleanedEstimated={t.cleaningSession?.finishSource === 'estimate'}
              cleanedSource={t.cleaningSession?.finishSource ?? null}
              enteredViaLock={t.cleaningSession?.entrySource === 'seam_lock'}
              inspected={t.inspectionStatus === 'complete'}
              inspecting={t.inspectionInProgress && t.inspectionStatus !== 'complete' && !t.manuallyCompleted}
              inspectionStartedAt={t.inspectionStartedAt}
              inspectionViaLock={t.inspectionViaLock}
              checkIn={t.checkIn}
              previousCheckout={t.previousCheckout}
              propertyId={t.propertyId}
              sameDay={t.isSameDayTurnover}
              lockMonitored
            />
          ) : (
            <TurnoverSteps row={row} today={today} />
          )}

          <div className="rt-tb-actions">
            {t && !row.done && !t.inspection && row.verb !== 'plan' && !(fp && fp.status !== 'draft') && (
              <PlanButton
                guestyReservationId={t.reservationId}
                propertyId={t.propertyId}
                checkInDate={t.checkIn.slice(0, 10)}
                checkOutDate={t.checkOut.slice(0, 10)}
                planId={t.plan?.id ?? null}
                plannedForDate={t.plan?.planned_for_date ?? null}
                plannedBy={t.plan?.planned_by_email ?? null}
                plannedNotes={t.plan?.notes ?? null}
                assignedToEmail={t.plan?.assigned_to_email ?? null}
                myEmail={myEmail}
              />
            )}
            {battery && t?.lockBattery && (
              <span style={{ color: 'var(--negative)', fontSize: 12, fontWeight: 600 }}>
                Lock battery {t.lockBattery.pct != null ? `${t.lockBattery.pct}%` : 'low'} · bring batteries
              </span>
            )}
            {!row.done &&
              t?.prepSlips.map((s) => (
                <Link key={s.id} href={`/work/${s.id}`} className="rt-tb-chip" data-tone="warn">
                  {truncate(s.actionSummary || s.title, 90)} →
                </Link>
              ))}
            {t && t.openWorkSlipsCount > 0 && (
              <Link href={`/properties/${t.propertyId}/work-slips/print`} className="rt-tb-chip">
                {t.openWorkSlipsCount} {t.openWorkSlipsCount === 1 ? 'slip' : 'slips'} · print →
              </Link>
            )}
            {fp && (
              <Link href={`/fieldwork/packets/${fp.packetId}`} className="rt-tb-chip" style={{ color: fieldChipColor(fp.status), fontWeight: 600 }}>
                {fieldChipLabel(fp)} →
              </Link>
            )}
            {/* The checkout's own row on the schedule, where its time and
                date move; the schedule's row links back here. */}
            {row.scheduleHref && (
              <Link href={row.scheduleHref} className="rt-tb-chip">
                Checkout schedule →
              </Link>
            )}
            {t && !row.done && (
              <form action={markTurnoverComplete} style={{ margin: 0 }}>
                <input type="hidden" name="property_id" value={t.propertyId} />
                <input type="hidden" name="check_in" value={t.checkIn.slice(0, 10)} />
                <input type="hidden" name="reservation_id" value={t.reservationId} />
                <input type="hidden" name="guest_name" value={t.guestName ?? ''} />
                <SubmitButton label="Mark ready" busyLabel="Marking…" spinnerTone="ink" className={buttonClass('secondary', 'sm')} />
              </form>
            )}
            {t?.manuallyCompleted && (
              <form action={unmarkTurnoverComplete} style={{ margin: 0 }}>
                <input type="hidden" name="property_id" value={t.propertyId} />
                <input type="hidden" name="check_in" value={t.checkIn.slice(0, 10)} />
                <SubmitButton label="Undo ready" busyLabel="Undoing…" spinnerTone="ink" className={buttonClass('secondary', 'sm')} />
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The row's one action. */
function Verb({ row, myEmail }: { row: BoardRow; myEmail: string }) {
  const t = row.turnover;
  if (!t || !row.verb) return null;
  switch (row.verb) {
    case 'summary':
      return t.inspection ? (
        <Link href={`/inspections/${t.inspection.id}/summary`} className="rt-tb-verblink">
          Summary
        </Link>
      ) : null;
    case 'resume':
      return t.inspection ? (
        <Link href={`/inspections/${t.inspection.id}`} className="rt-tb-verblink" data-strong="">
          Resume
        </Link>
      ) : null;
    case 'review':
      return t.fieldPacket ? (
        <Link href={`/fieldwork/packets/${t.fieldPacket.packetId}`} className="rt-tb-verblink" data-strong="">
          Review
        </Link>
      ) : null;
    case 'start':
      return (
        <form action={startInspection} style={{ margin: 0 }}>
          <input type="hidden" name="property_id" value={t.propertyId} />
          <SubmitButton label="Start walk" busyLabel="Starting…" className={buttonClass('primary', 'sm')} />
        </form>
      );
    case 'plan':
      return (
        <PlanButton
          variant="verb"
          guestyReservationId={t.reservationId}
          propertyId={t.propertyId}
          checkInDate={t.checkIn.slice(0, 10)}
          checkOutDate={t.checkOut.slice(0, 10)}
          planId={t.plan?.id ?? null}
          plannedForDate={t.plan?.planned_for_date ?? null}
          plannedBy={t.plan?.planned_by_email ?? null}
          plannedNotes={t.plan?.notes ?? null}
          assignedToEmail={t.plan?.assigned_to_email ?? null}
          myEmail={myEmail}
        />
      );
  }
}

/**
 * The three stages Helm can see on a home without a smart lock: the guest
 * left, the clean was confirmed (the cleaner texts, or you mark it), the
 * house was walked. A checkout with nobody arriving after it has no walk.
 * Each step prints the row's own words for it, so opening a row never
 * introduces a new name for a state.
 */
function TurnoverSteps({ row, today }: { row: BoardRow; today: string }) {
  const t = row.turnover;
  const out = row.out;
  const checkedOut = !!out && out.date <= today;
  const cleaned = !!row.cleanedAt;
  const skipped = row.cleaner?.label === 'No cleaning needed';
  const walked = !!t && (t.inspectionStatus === 'complete' || t.manuallyCompleted);
  const steps: Array<{ key: string; label: string; detail: string; state: 'done' | 'now' | 'later' }> = [];
  if (out) {
    steps.push({ key: 'out', label: 'Out', detail: out.when, state: checkedOut ? 'done' : 'later' });
    steps.push({
      key: 'cleaned',
      label: 'Cleaned',
      detail: row.cleaner?.label ?? '',
      state: cleaned || skipped ? 'done' : checkedOut ? 'now' : 'later',
    });
  }
  if (t) {
    steps.push({ key: 'walked', label: 'Walked', detail: row.walk?.label ?? '', state: walked ? 'done' : (cleaned || !out) ? 'now' : 'later' });
  }
  return (
    <div className="rt-tb-stepswrap">
      <ol className="rt-tb-steps">
        {steps.map((s) => (
          <li key={s.key} data-state={s.state}>
            <span className="rt-tb-dot" aria-hidden />
            <span className="rt-tb-steplabel">{s.label}</span>
            {s.detail && <span className="rt-tb-stepdetail">{s.detail}</span>}
          </li>
        ))}
      </ol>
      {out && checkedOut && !cleaned && !skipped && (
        <div style={{ marginTop: 10 }}>
          <MarkCleaned propertyId={row.propertyId} checkoutDate={out.date} />
        </div>
      )}
    </div>
  );
}

/** Keep prep-slip chip labels short enough to scan at a glance. */
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
