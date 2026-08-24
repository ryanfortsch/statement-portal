'use client';

import { useState } from 'react';
import { updateWorkSlipStatus, updateWorkSlipResolution } from '../actions';
import type { WorkSlipStatus } from '@/lib/work-types';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { SnoozeButton } from './SnoozeButton';

type Props = {
  workSlipId: string;
  propertyId: string;
  initialStatus: WorkSlipStatus;
  initialResolutionNotes: string | null;
  initialSnoozedUntil: string | null;
};

const CLOSED: WorkSlipStatus[] = ['done', 'dismissed'];

/**
 * The slip's close-out flow. Slips really only move open → done (or
 * dismissed); in_progress/scheduled are machine states written by the
 * field and vendor rails, so this panel offers the operator's actual
 * verbs — Mark done, Dismiss, Snooze, Reopen — instead of a button per
 * status. A slip parked in a machine state still closes from here.
 */
export function SlipClosePanel({
  workSlipId,
  propertyId,
  initialStatus,
  initialResolutionNotes,
  initialSnoozedUntil,
}: Props) {
  const softRefresh = useSoftRefresh();
  const [status, setStatus] = useState<WorkSlipStatus>(initialStatus);
  const [notes, setNotes] = useState<string>(initialResolutionNotes ?? '');
  const [savedNotes, setSavedNotes] = useState<string>(initialResolutionNotes ?? '');
  const [saving, setSaving] = useState<'done' | 'dismissed' | 'open' | 'notes' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const isClosed = CLOSED.includes(status);
  const notesDirty = notes.trim() !== savedNotes.trim();

  // Close (done or dismissed) saves whatever is in the notes box in the
  // same round trip; the server stamps completed_at / closed_at.
  async function close(next: 'done' | 'dismissed') {
    setErr(null);
    setSaving(next);
    const res = await updateWorkSlipResolution({
      id: workSlipId,
      resolution_notes: notes,
      status: next,
      propertyId,
    });
    setSaving(null);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setStatus(next);
    setSavedNotes(notes);
    softRefresh();
  }

  async function reopen() {
    setErr(null);
    setSaving('open');
    const res = await updateWorkSlipStatus({ id: workSlipId, status: 'open', propertyId });
    setSaving(null);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setStatus('open');
    softRefresh();
  }

  async function saveNotesOnly() {
    setErr(null);
    setSaving('notes');
    const res = await updateWorkSlipResolution({ id: workSlipId, resolution_notes: notes });
    setSaving(null);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setSavedNotes(notes);
    softRefresh();
  }

  return (
    <div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="What did you do? Cost? Vendor? Anything worth knowing for next time… (optional)"
        style={{
          width: '100%',
          background: 'transparent',
          border: '1px solid var(--rule)',
          padding: '10px 12px',
          fontSize: 14,
          color: 'var(--ink)',
          outline: 'none',
          fontFamily: 'inherit',
          resize: 'vertical',
        }}
      />

      <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: 12 }}>
        {isClosed ? (
          <>
            {notesDirty && (
              <button
                type="button"
                onClick={saveNotesOnly}
                disabled={saving !== null}
                style={solidButton(saving === 'notes')}
              >
                {saving === 'notes' ? 'Saving…' : 'Save Notes'}
              </button>
            )}
            <button
              type="button"
              onClick={reopen}
              disabled={saving !== null}
              style={ghostButton(saving === 'open')}
            >
              {saving === 'open' ? 'Saving…' : 'Reopen'}
            </button>
            <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              {status === 'dismissed'
                ? 'Dismissed: closed without work. Reopen puts it back in the queue.'
                : 'Reopen puts it back in the queue.'}
            </span>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => close('done')}
              disabled={saving !== null}
              style={solidButton(saving === 'done')}
            >
              {saving === 'done' ? 'Saving…' : 'Mark Done'}
            </button>
            <button
              type="button"
              onClick={() => close('dismissed')}
              disabled={saving !== null}
              title="Close without work: false alarm, duplicate, won't do"
              style={ghostButton(saving === 'dismissed')}
            >
              {saving === 'dismissed' ? 'Saving…' : 'Dismiss'}
            </button>
            <div style={{ marginLeft: 'auto' }}>
              <SnoozeButton slipId={workSlipId} initialSnoozedUntil={initialSnoozedUntil} />
            </div>
          </>
        )}
      </div>

      {err && (
        <div
          style={{
            marginTop: 14,
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

function solidButton(busy: boolean): React.CSSProperties {
  return {
    background: 'var(--ink)',
    color: 'var(--paper)',
    border: '1.5px solid var(--ink)',
    padding: '10px 22px',
    fontSize: 11,
    letterSpacing: '.18em',
    textTransform: 'uppercase',
    fontWeight: 600,
    cursor: busy ? 'wait' : 'pointer',
    minHeight: 42,
  };
}

function ghostButton(busy: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    color: 'var(--ink-3)',
    border: '1px solid var(--rule)',
    padding: '10px 18px',
    fontSize: 11,
    letterSpacing: '.18em',
    textTransform: 'uppercase',
    fontWeight: 500,
    cursor: busy ? 'wait' : 'pointer',
    minHeight: 42,
  };
}
