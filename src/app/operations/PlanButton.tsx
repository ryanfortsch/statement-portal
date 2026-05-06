'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setInspectionPlan, deleteInspectionPlan } from './plan-actions';

type Props = {
  guestyReservationId: string;
  propertyId: string;
  checkInDate: string;
  checkOutDate: string;
  // Existing plan (if any)
  planId: string | null;
  plannedForDate: string | null;
  plannedBy: string | null;
};

export function PlanButton({
  guestyReservationId,
  propertyId,
  checkInDate,
  checkOutDate,
  planId,
  plannedForDate,
  plannedBy,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Sensible default: day before check-in
  const defaultDate =
    plannedForDate ?? defaultPlannedFor(checkInDate);
  const [picked, setPicked] = useState<string>(defaultDate);
  const [notes, setNotes] = useState('');
  const [, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    setSubmitting(true);
    const res = await setInspectionPlan({
      guestyReservationId,
      propertyId,
      checkinDate: checkInDate,
      checkoutDate: checkOutDate,
      plannedForDate: picked,
      notes,
    });
    setSubmitting(false);
    if (!res.ok) {
      setErr(res.error);
    } else {
      setOpen(false);
      startTransition(() => router.refresh());
    }
  }

  function clearPlan() {
    if (!planId) return;
    setErr(null);
    setSubmitting(true);
    startTransition(async () => {
      const res = await deleteInspectionPlan(planId);
      setSubmitting(false);
      if (!res.ok) {
        setErr(res.error);
      } else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  // Trigger button (different style depending on plan presence)
  if (!open) {
    if (plannedForDate) {
      return (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={plannedBy ? `Planned by ${plannedBy.split('@')[0]}` : 'Edit plan'}
          style={{
            background: 'transparent',
            border: '1px solid var(--tide-deep)',
            color: 'var(--tide-deep)',
            padding: '6px 10px',
            fontSize: 10,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          Plan: {formatShort(plannedForDate)}
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          background: 'transparent',
          border: '1px solid var(--rule)',
          color: 'var(--ink-3)',
          padding: '6px 10px',
          fontSize: 10,
          letterSpacing: '.16em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        + Plan
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
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        style={{
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
              {planId ? 'Edit inspection plan' : 'Plan an inspection'}
            </h3>
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)' }}>
              Check-in {formatShort(checkInDate)} &middot; Checkout {formatShort(checkOutDate)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
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

        <div className="eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>Notes (optional)</div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="e.g., Allie morning slot — guest arrives 4 PM"
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
          <div
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
          {planId ? (
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
              onClick={() => setOpen(false)}
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
      </div>
    </div>
  );
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function defaultPlannedFor(checkInDate: string): string {
  // Default to one day before check-in (operator can move forward/back).
  const d = new Date(`${checkInDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  const proposed = d.toISOString().split('T')[0];
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
