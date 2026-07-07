'use client';

import { useState, useTransition } from 'react';
import { updateWorkSlipStatus, updateWorkSlipResolution } from '../actions';
import type { WorkSlipStatus } from '@/lib/work-types';
import { useSoftRefresh } from '@/lib/use-soft-refresh';

const STATUS_OPTIONS: { value: WorkSlipStatus; label: string; color: string }[] = [
  { value: 'open',         label: 'Open',         color: 'var(--ink-3)' },
  { value: 'in_progress',  label: 'In progress',  color: 'var(--signal)' },
  { value: 'scheduled',    label: 'Scheduled',    color: 'var(--tide-deep)' },
  { value: 'blocked',      label: 'Blocked',      color: 'var(--negative)' },
  { value: 'done',         label: 'Done',         color: 'var(--positive)' },
  // Closed-without-work: triage false positive, duplicate, won't-do.
  // Drops out of every active queue but keeps the row (and its
  // from_review_id link) so auto-creation can't resurrect it.
  { value: 'dismissed',    label: 'Dismissed',    color: 'var(--ink-4)' },
];

export function StatusChanger({
  workSlipId,
  initialStatus,
  initialResolutionNotes,
}: {
  workSlipId: string;
  initialStatus: WorkSlipStatus;
  initialResolutionNotes: string | null;
}) {
  const softRefresh = useSoftRefresh();
  const [status, setStatus] = useState<WorkSlipStatus>(initialStatus);
  const [resolutionNotes, setResolutionNotes] = useState<string>(initialResolutionNotes ?? '');
  const [, startTransition] = useTransition();
  const [pendingStatus, setPendingStatus] = useState<WorkSlipStatus | null>(null);
  const [savingNotes, setSavingNotes] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function quickStatus(next: WorkSlipStatus) {
    if (next === status) return;
    setErr(null);
    setPendingStatus(next);
    const prev = status;
    setStatus(next);
    startTransition(async () => {
      const res = await updateWorkSlipStatus({ id: workSlipId, status: next });
      setPendingStatus(null);
      if (!res.ok) {
        setStatus(prev);
        setErr(res.error);
      } else {
        softRefresh();
      }
    });
  }

  async function saveResolutionNotes() {
    setErr(null);
    setSavingNotes(true);
    // If the slip isn't already closed and the user is writing resolution
    // notes, assume they're wrapping it up; flip to done at the same time.
    // A dismissed slip stays dismissed — notes there are the "why".
    const nextStatus: WorkSlipStatus | undefined =
      status === 'done' || status === 'dismissed' ? undefined : 'done';
    const res = await updateWorkSlipResolution({
      id: workSlipId,
      resolution_notes: resolutionNotes,
      status: nextStatus,
    });
    setSavingNotes(false);
    if (!res.ok) {
      setErr(res.error);
    } else {
      if (nextStatus) setStatus(nextStatus);
      softRefresh();
    }
  }

  return (
    <div>
      {/* STATUS PILLS */}
      <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 18 }}>
        {STATUS_OPTIONS.map((opt) => {
          const active = opt.value === status;
          const isPending = pendingStatus === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => quickStatus(opt.value)}
              disabled={isPending}
              style={{
                background: active ? opt.color : 'transparent',
                color: active ? 'var(--paper)' : opt.color,
                border: `1.5px solid ${opt.color}`,
                padding: '8px 14px',
                fontSize: 11,
                letterSpacing: '.16em',
                textTransform: 'uppercase',
                fontWeight: 600,
                cursor: isPending ? 'wait' : 'pointer',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {isPending ? 'Saving…' : opt.label}
            </button>
          );
        })}
      </div>

      {/* RESOLUTION NOTES */}
      <div style={{ marginTop: 10 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Resolution Notes</div>
        <textarea
          value={resolutionNotes}
          onChange={(e) => setResolutionNotes(e.target.value)}
          rows={4}
          placeholder="What did you do? Cost? Time? Vendor? Anything worth knowing for next time…"
          style={{
            width: '100%',
            background: 'transparent',
            border: '1px solid var(--rule)',
            padding: '12px 14px',
            fontSize: 14,
            color: 'var(--ink)',
            outline: 'none',
            fontFamily: 'inherit',
            resize: 'vertical',
            minHeight: 100,
          }}
        />
        <div className="flex items-center justify-between" style={{ marginTop: 10, gap: 12, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 11, color: 'var(--ink-4)', margin: 0 }}>
            {status === 'done' || status === 'dismissed'
              ? 'Saving updates resolution notes only.'
              : 'Saving will mark the slip Done at the same time.'}
          </p>
          <button
            type="button"
            onClick={saveResolutionNotes}
            disabled={savingNotes}
            style={{
              background: 'var(--ink)',
              color: 'var(--paper)',
              border: 'none',
              padding: '12px 22px',
              fontSize: 11,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              fontWeight: 600,
              cursor: savingNotes ? 'wait' : 'pointer',
              minHeight: 44,
            }}
          >
            {savingNotes
              ? 'Saving…'
              : status === 'done' || status === 'dismissed'
                ? 'Save Notes'
                : 'Save & Mark Done'}
          </button>
        </div>
      </div>

      {err && (
        <div
          style={{
            marginTop: 16,
            padding: '10px 14px',
            borderLeft: '3px solid var(--negative)',
            background: 'var(--paper-2)',
            fontSize: 12,
            color: 'var(--negative)',
          }}
        >
          {err}
        </div>
      )}
    </div>
  );
}
