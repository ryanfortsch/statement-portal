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
 * ("Out 10:00 · In 4:00"), the cleaner verdict, and one verb. Every word on
 * the line was decided on the server (lib/turnover-board.ts) from one clock
 * read, so the line never ticks and never disagrees with the strip above it.
 *
 * The house name is the toggle: a real button with aria-expanded, so the
 * actions beside it are siblings, not controls nested inside a fake button.
 * Opening it shows who leaves and who arrives, then the stages: the six-stage
 * rail on a lock-monitored home, the three steps Helm can see everywhere
 * else (Out, Cleaned, Walked), and the secondary actions.
 *
 * The walk is set on the week grid above the board (VisitGrid, claimWalk),
 * which already draws who is going and when. So the line prints a walk only
 * when it carries a state the strip counts (Walking, Needs walk) or says why
 * a done row is done, and it offers no Plan verb. The planner modal (notes,
 * another walker) opens from the opened row only (2026-11-07 audit, finding 1).
 *
 * Desktop: one grid line, columns aligned down the board. Phone: two lines,
 * the house and its verb, then the facts (see .rt-tb-* in globals.css).
 */
export function BoardLine({ row, today, myEmail, dispatcher = false }: { row: BoardRow; today: string; myEmail: string; dispatcher?: boolean }) {
  const [open, setOpen] = useState(false);
  const t = row.turnover;
  const detailId = `${row.id}-detail`;
  const prep = !row.done && !!t && t.prepSlips.length > 0;
  const battery = !row.done && !!t?.lockBattery?.isLow;
  const fp = t?.fieldPacket ?? null;
  // The walk on the line: only a state the strip counts, or a done row's reason.
  const walkOnLine = row.walk && (row.walk.key || row.done) ? row.walk : null;
  // The planner opens from the opened row while the walk is still to plan:
  // not walked, not started, not covered by a live Field packet.
  const planner = !!t && !row.done && !t.inspection && !(fp && fp.status !== 'draft');

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
          <span className="rt-tb-flag" data-tone="bad" title={`Lock battery ${t!.lockBattery!.pct != null ? `${t!.lockBattery!.pct}%` : 'low'} · bring batteries`}>
            Batteries
          </span>
        )}
      </div>
      <div className="rt-tb-facts">
        <span className="rt-tb-pair">
          {row.pair}
          {row.sameDay && <span className="rt-tb-sd">Same day</span>}
        </span>
        {(row.cleaner || walkOnLine) && (
          <span className="rt-tb-status">
            {row.cleaner && (
              <span className="rt-tb-slot rt-tb-cleaner" data-tone={row.cleaner.tone}>
                {row.cleaner.label}
              </span>
            )}
            {walkOnLine && (
              <span className="rt-tb-slot rt-tb-walk" data-tone={walkOnLine.tone}>
                {walkOnLine.label}
              </span>
            )}
          </span>
        )}
      </div>
      <div className="rt-tb-verb">
        <Verb row={row} />
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
            <TurnoverSteps row={row} today={today} plannerShown={planner && !!t?.plan?.id} />
          )}

          <div className="rt-tb-actions">
            {t && planner && (
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
                dispatcher={dispatcher}
              />
            )}
            {/* The Prep and Batteries flags on the line already say it (the
                battery level and the prep slips ride their titles); the
                print sheet below carries every open slip. */}
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
                Schedule →
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
function Verb({ row }: { row: BoardRow }) {
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
      // Planning lives on the week grid above; the planner modal is in the
      // opened row. The line offers no second way to plan.
      return null;
  }
}

/**
 * The three stages Helm can see on a home without a smart lock: the guest
 * left, the clean was confirmed (the cleaner texts, or you mark it), the
 * house was walked. A checkout with nobody arriving after it has no walk.
 * Each step prints the row's own words for it, so opening a row never
 * introduces a new name for a state.
 */
function TurnoverSteps({ row, today, plannerShown }: { row: BoardRow; today: string; plannerShown: boolean }) {
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
    // A planned walk's day and person print once, on the planner below.
    steps.push({ key: 'walked', label: 'Walked', detail: plannerShown ? '' : (row.walk?.label ?? ''), state: walked ? 'done' : (cleaned || !out) ? 'now' : 'later' });
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
