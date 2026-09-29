'use client';

import { useRef, useState } from 'react';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { setInspectionPlan, deleteInspectionPlan } from './plan-actions';
import { TeamPicker } from '@/components/TeamPicker';
import { displayNameForEmail, getTeamMember } from '@/lib/team';
import { useSoftRefresh } from '@/lib/use-soft-refresh';

type Props = {
  guestyReservationId: string;
  propertyId: string;
  checkInDate: string;
  checkOutDate: string;
  // Existing plan (if any)
  planId: string | null;
  plannedForDate: string | null;
  plannedBy: string | null;
  plannedNotes?: string | null;
  assignedToEmail: string | null;
  myEmail: string;
  /** 'chip' (default): the dashed "Planned Jul 10 · Ryan" line used in the
   *  expanded affordances. 'byline': the collapsed action-column credit —
   *  just the assignee's full name in the same serif-italic register as a
   *  Field contractor's name, so every delegated-or-planned walk reads as
   *  a person at a glance. Both open the same editor modal. */
  variant?: 'chip' | 'byline';
};

export function PlanButton({
  guestyReservationId,
  propertyId,
  checkInDate,
  checkOutDate,
  planId,
  plannedForDate,
  plannedBy,
  plannedNotes = null,
  assignedToEmail,
  myEmail,
  variant = 'chip',
}: Props) {
  const softRefresh = useSoftRefresh();
  const [open, setOpen] = useState(false);
  const incoming = { id: planId, date: plannedForDate ?? defaultPlannedFor(checkInDate), notes: plannedNotes ?? '', assignee: assignedToEmail };
  const source = JSON.stringify(incoming);
  const [saved, setSaved] = useState({ source, ...incoming });
  // Retain our confirmed save until new server props arrive. Draft fields
  // are separate, so a refresh cannot overwrite typing in the open editor.
  if (saved.source !== source) setSaved({ source, ...incoming });
  const [picked, setPicked] = useState(saved.date);
  const [notes, setNotes] = useState(saved.notes);
  const [assignee, setAssignee] = useState<string | null>(saved.assignee);
  const lock = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = picked !== saved.date || notes !== saved.notes || assignee !== saved.assignee;
  useUnsavedWorkGuard(submitting || (open && (dirty || uncertain)));

  function openEditor() {
    if (lock.current) return;
    setPicked(saved.date); setNotes(saved.notes); setAssignee(saved.assignee);
    setErr(null); setUncertain(false); setOpen(true);
  }
  function requestClose() {
    if (lock.current) return;
    if ((dirty || uncertain) && !window.confirm('Discard your unsaved inspection plan changes?')) return;
    setOpen(false); setErr(null); setUncertain(false);
  }

  async function save() {
    if (lock.current) return;
    lock.current = true;
    setErr(null); setUncertain(false); setSubmitting(true);
    const snapshot = { date: picked, notes, assignee };
    try {
      const res = await setInspectionPlan({
        guestyReservationId, propertyId, checkinDate: checkInDate, checkoutDate: checkOutDate,
        plannedForDate: snapshot.date, notes: snapshot.notes, assignedToEmail: snapshot.assignee,
      });
      if (!res.ok) { setErr(res.error); return; }
      setSaved({ source, id: res.id, ...snapshot });
      setOpen(false);
      softRefresh();
    } catch {
      setUncertain(true);
      setErr('Could not confirm the inspection plan save. Your date, inspector, and notes are kept. Check the plan before retrying.');
    } finally {
      lock.current = false; setSubmitting(false);
    }
  }

  async function clearPlan() {
    if (!saved.id || lock.current) return;
    if (dirty && !window.confirm('Remove this plan and discard your unsaved changes?')) return;
    lock.current = true;
    setErr(null); setUncertain(false); setSubmitting(true);
    try {
      const res = await deleteInspectionPlan(saved.id);
      if (!res.ok) { setErr(res.error); return; }
      setSaved({ source, id: null, date: defaultPlannedFor(checkInDate), notes: '', assignee: null });
      setOpen(false);
      softRefresh();
    } catch {
      setUncertain(true);
      setErr('Could not confirm plan removal. Your choices are kept. Check whether the plan still exists before retrying.');
    } finally {
      lock.current = false; setSubmitting(false);
    }
  }

  // Trigger — a quiet, right-aligned control that lives in the turnover
  // row's status column alongside the cleaning / slips / field / mark-done
  // chips, so the plan state sits in the same place on every row. Two
  // states: a colored "Planned …" line when scheduled, a faint "+ Plan
  // inspection" prompt when not. Both open the same editor modal below.
  if (!open) {
    if (saved.id) {
      const inspectorLabel = saved.assignee ? displayNameForEmail(saved.assignee) : null;
      const tooltip = [
        plannedBy ? `Planned by ${plannedBy.split('@')[0]}` : null,
        inspectorLabel ? `Inspector: ${inspectorLabel}` : null,
        'Click to edit',
      ].filter(Boolean).join(' · ');
      if (variant === 'byline') {
        // Collapsed-row credit: the person's FULL name (matching how a Field
        // contractor reads), or "Planned Jul 10" when nobody's assigned yet.
        const fullName = saved.assignee
          ? getTeamMember(saved.assignee)?.name ?? displayNameForEmail(saved.assignee)
          : null;
        return (
          <button
            type="button"
            onClick={openEditor}
            className="rt-tn-field"
            title={`Planned ${formatShort(saved.date)} · ${fullName ?? 'unassigned'} · click to edit`}
          >
            <span className="rt-tn-field-p" style={{ color: 'var(--tide-deep)' }}>
              {fullName ?? `Planned ${formatShort(saved.date)}`}
            </span>
          </button>
        );
      }
      return (
        <button
          type="button"
          onClick={openEditor}
          title={tooltip}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontSize: 11,
            color: 'var(--tide-deep)',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            borderBottom: '1px dashed var(--tide-deep)',
            lineHeight: 1.6,
          }}
        >
          Planned {formatShort(saved.date)}
          {inspectorLabel ? ` · ${inspectorLabel}` : ''}
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={openEditor}
        title="Schedule this inspection for a day and assign someone"
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          fontSize: 11,
          color: 'var(--ink-3)',
          whiteSpace: 'nowrap',
          borderBottom: '1px dashed var(--ink-4)',
          lineHeight: 1.6,
        }}
      >
        + Plan inspection
      </button>
    );
  }

  // Inline modal
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(30, 46, 52, 0.55)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <fieldset disabled={submitting}
        style={{
          margin: 0,
          minWidth: 0,
          width: '100%',
          maxWidth: 420,
          background: 'var(--paper)',
          border: '1px solid var(--ink)',
          padding: 20,
        }}
      >
        <div className="flex items-start justify-between" style={{ marginBottom: 14 }}>
          <div>
            <h3
              className="font-serif"
              style={{
                fontSize: 20,
                fontWeight: 400,
                letterSpacing: '-0.01em',
                color: 'var(--ink)',
                margin: 0,
              }}
            >
              {saved.id ? 'Edit inspection plan' : 'Plan an inspection'}
            </h3>
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)' }}>
              Check-in {formatShort(checkInDate)} &middot; Checkout {formatShort(checkOutDate)}
            </div>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              fontSize: 22,
              color: 'var(--ink-3)',
              cursor: 'pointer',
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>

        <div className="eyebrow" style={{ marginBottom: 6 }}>Walk on</div>
        <input
          type="date"
          aria-label="Inspection date"
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          min={todayStr()}
          max={checkInDate}
          style={{
            width: '100%',
            background: 'transparent',
            border: '1px solid var(--rule)',
            padding: '10px 12px',
            fontSize: 14,
            color: 'var(--ink)',
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />

        <div className="eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Inspector</div>
        <TeamPicker
          value={assignee}
          onChange={setAssignee}
          myEmail={myEmail}
          placeholder="Anyone on the team"
        />

        <div className="eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Notes (optional)</div>
        <textarea
          aria-label="Inspection notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="e.g., morning slot — guest arrives 4 PM"
          style={{
            width: '100%',
            background: 'transparent',
            border: '1px solid var(--rule)',
            padding: '10px 12px',
            fontSize: 13,
            color: 'var(--ink)',
            outline: 'none',
            fontFamily: 'inherit',
            resize: 'vertical',
          }}
        />

        {err && (
          <div role="alert"
            style={{
              marginTop: 12,
              padding: '8px 12px',
              borderLeft: '3px solid var(--negative)',
              background: 'var(--paper-2)',
              fontSize: 12,
              color: 'var(--negative)',
            }}
          >
            {err}
          </div>
        )}

        <div className="flex items-center justify-between" style={{ marginTop: 18, gap: 10 }}>
          {saved.id ? (
            <button
              type="button"
              onClick={clearPlan}
              disabled={submitting}
              style={{
                background: 'transparent',
                border: '1px solid var(--negative)',
                color: 'var(--negative)',
                padding: '10px 14px',
                fontSize: 11,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                cursor: submitting ? 'wait' : 'pointer',
              }}
            >
              Remove plan
            </button>
          ) : (
            <span />
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={requestClose}
              style={{
                background: 'transparent',
                border: '1px solid var(--rule)',
                color: 'var(--ink-3)',
                padding: '10px 16px',
                fontSize: 11,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={submitting}
              style={{
                background: submitting ? 'var(--ink-4)' : 'var(--ink)',
                color: 'var(--paper)',
                border: 'none',
                padding: '10px 18px',
                fontSize: 11,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                fontWeight: 600,
                cursor: submitting ? 'wait' : 'pointer',
              }}
            >
              {submitting ? 'Saving…' : 'Save Plan'}
            </button>
          </div>
        </div>
      </fieldset>
    </div>
  );
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function defaultPlannedFor(checkInDate: string): string {
  // Default to the check-in day itself: the inspection happens the
  // morning the guest arrives, before they get there. (Previously
  // defaulted to the day before, which read as the inspection being
  // due a day early.) Operator can still move it forward/back.
  const proposed = checkInDate.slice(0, 10);
  const today = todayStr();
  return proposed >= today ? proposed : today;
}

function formatShort(value: string | null): string {
  if (!value) return '—';
  try {
    const d = new Date(`${value.slice(0, 10)}T00:00:00`);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return value;
  }
}
