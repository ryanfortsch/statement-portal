'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  setLaunchStepStatus,
  setLaunchStepNotes,
} from './actions';
import type { LaunchStep, LaunchStepRow, LaunchStepStatus } from '@/lib/launch-checklist';

type Props = {
  propertyId: string;
  step: LaunchStep;
  row: LaunchStepRow | null;
};

const STATUS_OPTIONS: Array<{ value: LaunchStepStatus; label: string }> = [
  { value: 'todo', label: 'To-do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'n_a', label: 'N/A' },
];

/**
 * One row in the launch checklist. The page renders these inside phase
 * sections. Status changes go through a server action and the page
 * re-renders via router.refresh(). PR 1 keeps the action menu generic
 * (status + notes) — deep-link buttons for individual steps (Generate
 * listing copy, jump to Quo, etc.) ship in PR 3.
 */
export function LaunchStepCard({ propertyId, step, row }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState<string>(row?.notes ?? '');
  const [notesPending, setNotesPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status: LaunchStepStatus = row?.status ?? 'todo';
  const isResolved = status === 'done' || status === 'skipped' || status === 'n_a';

  function changeStatus(next: LaunchStepStatus) {
    setError(null);
    startTransition(async () => {
      const res = await setLaunchStepStatus(propertyId, step.key, next);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  async function saveNotes() {
    setNotesPending(true);
    setError(null);
    const res = await setLaunchStepNotes(propertyId, step.key, notesDraft);
    setNotesPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '32px 1fr auto',
        gap: 14,
        padding: '16px 0',
        borderBottom: '1px solid var(--rule)',
        opacity: pending ? 0.55 : 1,
        transition: 'opacity 120ms ease',
      }}
    >
      {/* Status dot */}
      <div style={{ paddingTop: 4 }}>
        <StatusDot status={status} />
      </div>

      {/* Title + meta */}
      <div>
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: isResolved ? 'var(--ink-3)' : 'var(--ink)',
            textDecoration: status === 'skipped' || status === 'n_a' ? 'line-through' : 'none',
            lineHeight: 1.4,
          }}
        >
          {step.title}
          {step.required && !isResolved && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 9,
                letterSpacing: '.16em',
                textTransform: 'uppercase',
                color: 'var(--signal, #c85a3a)',
                fontWeight: 600,
              }}
            >
              Required
            </span>
          )}
          {step.gate && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 9,
                letterSpacing: '.16em',
                textTransform: 'uppercase',
                color: 'var(--ink-3)',
                fontWeight: 600,
              }}
            >
              Activation gate
            </span>
          )}
        </div>
        {step.description && (
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55 }}>
            {step.description}
          </div>
        )}
        {step.why && (
          <div
            style={{
              marginTop: 4,
              fontSize: 11,
              color: 'var(--ink-4, #8a9aa1)',
              fontStyle: 'italic',
              lineHeight: 1.55,
            }}
          >
            {step.why}
          </div>
        )}
        {step.example && (
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3)' }}>
            e.g. <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{step.example}</span>
          </div>
        )}
        {row?.completed_at && status === 'done' && (
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-3)' }}>
            ✓ {formatRelative(row.completed_at)}
            {row.completed_by ? ` · ${row.completed_by}` : ''}
          </div>
        )}
        {error && (
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--negative, #c85a3a)' }}>{error}</div>
        )}

        {/* Notes toggle + editor */}
        <div style={{ marginTop: 6 }}>
          <button
            type="button"
            onClick={() => setNotesOpen((v) => !v)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              fontSize: 11,
              letterSpacing: '.14em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
              cursor: 'pointer',
            }}
          >
            {notesOpen ? '− Notes' : row?.notes ? '+ Notes' : '+ Add note'}
          </button>
          {row?.notes && !notesOpen && (
            <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--ink-3)' }}>
              {row.notes.length > 80 ? row.notes.slice(0, 80) + '…' : row.notes}
            </span>
          )}
          {notesOpen && (
            <div style={{ marginTop: 8 }}>
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                rows={3}
                placeholder="Notes for this step…"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  border: '1px solid var(--rule)',
                  background: 'var(--paper)',
                  fontSize: 13,
                  color: 'var(--ink)',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                }}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => {
                    setNotesDraft(row?.notes ?? '');
                    setNotesOpen(false);
                  }}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--rule)',
                    color: 'var(--ink-3)',
                    padding: '6px 12px',
                    fontSize: 11,
                    letterSpacing: '.14em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    saveNotes().then(() => setNotesOpen(false));
                  }}
                  disabled={notesPending}
                  style={{
                    background: notesPending ? 'var(--ink-4)' : 'var(--ink)',
                    color: 'var(--paper)',
                    border: 'none',
                    padding: '6px 12px',
                    fontSize: 11,
                    letterSpacing: '.14em',
                    textTransform: 'uppercase',
                    fontWeight: 500,
                    cursor: notesPending ? 'wait' : 'pointer',
                  }}
                >
                  {notesPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status changer */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        <select
          value={status}
          onChange={(e) => changeStatus(e.target.value as LaunchStepStatus)}
          disabled={pending || step.auto}
          style={{
            appearance: 'none',
            padding: '6px 10px',
            border: '1px solid var(--rule)',
            background: 'var(--paper)',
            fontSize: 12,
            color: 'var(--ink)',
            fontFamily: 'inherit',
            cursor: step.auto ? 'not-allowed' : 'pointer',
            minWidth: 120,
          }}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {step.auto && (
          <div style={{ fontSize: 10, color: 'var(--ink-4, #8a9aa1)', letterSpacing: '.06em' }}>auto</div>
        )}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: LaunchStepStatus }) {
  const styles: Record<LaunchStepStatus, { bg: string; border: string; mark?: string }> = {
    todo: { bg: 'transparent', border: 'var(--rule)' },
    in_progress: { bg: 'var(--paper)', border: 'var(--ink)' },
    done: { bg: 'var(--ink)', border: 'var(--ink)', mark: '✓' },
    skipped: { bg: 'transparent', border: 'var(--rule)', mark: '−' },
    n_a: { bg: 'transparent', border: 'var(--rule)', mark: '∕' },
  };
  const s = styles[status];
  return (
    <span
      aria-label={status}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 18,
        borderRadius: '50%',
        background: s.bg,
        border: `1.5px solid ${s.border}`,
        color: status === 'done' ? 'var(--paper)' : 'var(--ink-3)',
        fontSize: 11,
        lineHeight: 1,
      }}
    >
      {s.mark ?? ''}
    </span>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const day = 86400000;
  if (diffMs < day) return 'today';
  if (diffMs < 2 * day) return 'yesterday';
  const days = Math.floor(diffMs / day);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
