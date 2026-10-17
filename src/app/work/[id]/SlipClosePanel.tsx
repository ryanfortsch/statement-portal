'use client';

import { useEffect, useRef, useState } from 'react';
import { updateWorkSlipStatus, updateWorkSlipResolution } from '../actions';
import type { WorkSlipStatus } from '@/lib/work-types';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { SnoozeButton } from './SnoozeButton';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';

type Props = {
  workSlipId: string;
  propertyId: string;
  initialStatus: WorkSlipStatus;
  initialResolutionNotes: string | null;
  initialSnoozedUntil: string | null;
};

const CLOSED: WorkSlipStatus[] = ['done', 'dismissed'];
type SaveMode = 'done' | 'dismissed' | 'open' | 'notes';

/** A pause in typing this long writes the notes. */
const NOTES_AUTOSAVE_MS = 1200;

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
  const [saving, setSaving] = useState<SaveMode | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false);

  const isClosed = CLOSED.includes(status);
  const notesDirty = notes.trim() !== savedNotes.trim();
  // True once an autosave has landed and nothing has been typed since.
  const [notesSaved, setNotesSaved] = useState(false);

  useUnsavedWorkGuard(notesDirty || saving !== null);

  // The notes save on their own, open or closed: a pause in typing or
  // leaving the box writes them, so "called the plumber, coming Thursday"
  // is never held hostage to Mark Done. A close still saves whatever is in
  // the box in the same round trip. The ref keeps the effect on the latest
  // save() without re-arming the timer on every render.
  const saveRef = useRef<(mode: SaveMode) => Promise<void>>(async () => {});
  useEffect(() => {
    if (!notesDirty || saving !== null) return;
    const timer = setTimeout(() => {
      void saveRef.current('notes');
    }, NOTES_AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [notes, notesDirty, saving]);

  // Close (done or dismissed) saves whatever is in the notes box in the
  // same round trip; the server stamps completed_at / closed_at.
  async function save(mode: SaveMode) {
    if (inFlight.current) return;
    inFlight.current = true;
    const submittedNotes = notes;
    setErr(null);
    setUncertain(false);
    setSaving(mode);
    try {
      const res = mode === 'open'
        ? await updateWorkSlipStatus({ id: workSlipId, status: 'open', propertyId })
        : await updateWorkSlipResolution({
            id: workSlipId,
            resolution_notes: submittedNotes,
            ...(mode === 'notes' ? {} : { status: mode, propertyId }),
          });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      if (mode !== 'notes') setStatus(mode);
      // Reopening changes only the status. Any draft notes remain unsaved.
      if (mode !== 'open') setSavedNotes(submittedNotes);
      if (mode === 'notes') setNotesSaved(true);
      softRefresh();
    } catch {
      setUncertain(true);
      setErr('Could not confirm the change. Your notes are still here. Check the work slip before trying again.');
    } finally {
      inFlight.current = false;
      setSaving(null);
    }
  }
  // Keep the autosave timer on the latest save() without re-arming it on
  // every render (a ref written during render is what the lint rule forbids).
  useEffect(() => {
    saveRef.current = save;
  });

  return (
    <div>
      <textarea
        value={notes}
        // A notes autosave must not lock the box mid-sentence; a close does.
        disabled={saving !== null && saving !== 'notes'}
        aria-label="Notes"
        onChange={(e) => {
          setNotes(e.target.value);
          setNotesSaved(false);
        }}
        onBlur={() => {
          if (notesDirty && saving === null) void save('notes');
        }}
        rows={2}
        placeholder="What did you do? Cost? Vendor? Anything worth knowing for next time… Saves as you type."
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
            <button
              type="button"
              onClick={() => save('open')}
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
              onClick={() => save('done')}
              disabled={saving !== null}
              style={solidButton(saving === 'done')}
            >
              {saving === 'done' ? 'Saving…' : 'Mark Done'}
            </button>
            <button
              type="button"
              onClick={() => save('dismissed')}
              disabled={saving !== null}
              title="Close without work: false alarm, duplicate, won't do"
              style={ghostButton(saving === 'dismissed')}
            >
              {saving === 'dismissed' ? 'Saving…' : 'Dismiss'}
            </button>
            <fieldset disabled={saving !== null} style={{ marginLeft: 'auto', padding: 0, border: 0, minWidth: 0 }}>
              <SnoozeButton slipId={workSlipId} initialSnoozedUntil={initialSnoozedUntil} />
            </fieldset>
          </>
        )}
      </div>
      {(saving === 'notes' || (notesSaved && !notesDirty)) && (
        <div role="status" style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-4)' }}>
          {saving === 'notes' ? 'Saving notes…' : 'Notes saved.'}
        </div>
      )}

      {err && (
        <div
          role="alert"
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
          {uncertain && (
            <> <a href={`/work/${encodeURIComponent(workSlipId)}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>Check saved work slip in a new tab</a></>
          )}
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
