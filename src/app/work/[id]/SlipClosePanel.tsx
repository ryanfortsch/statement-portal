'use client';

import { useEffect, useRef, useState } from 'react';
import { updateWorkSlipStatus, updateWorkSlipResolution } from '../actions';
import type { WorkSlipStatus } from '@/lib/work-types';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { SnoozeButton } from './SnoozeButton';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { Button } from '@/components/Button';

type Props = {
  workSlipId: string;
  propertyId: string;
  initialStatus: WorkSlipStatus;
  initialResolutionNotes: string | null;
  initialSnoozedUntil: string | null;
  linkedReportCount?: number;
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
  linkedReportCount = 1,
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
  // After a failed save the timer stands down until the next keystroke or
  // blur, so a server that keeps refusing is asked again on the operator's
  // move, not every second.
  const [autosaveHeld, setAutosaveHeld] = useState(false);

  useUnsavedWorkGuard(notesDirty || saving !== null);

  // The notes save on their own, open or closed: a pause in typing or
  // leaving the box writes them, so "called the plumber, coming Thursday"
  // is never held hostage to Mark Done. A close still saves whatever is in
  // the box in the same round trip. The ref keeps the effect on the latest
  // save() without re-arming the timer on every render.
  const saveRef = useRef<(mode: SaveMode) => Promise<void>>(async () => {});
  useEffect(() => {
    if (!notesDirty || saving !== null || autosaveHeld) return;
    const timer = setTimeout(() => {
      void saveRef.current('notes');
    }, NOTES_AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [notes, notesDirty, saving, autosaveHeld]);

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
        setAutosaveHeld(true);
        return;
      }
      if (mode !== 'notes') setStatus(mode);
      // Reopening changes only the status. Any draft notes remain unsaved.
      if (mode !== 'open') setSavedNotes(submittedNotes);
      if (mode === 'notes') setNotesSaved(true);
      softRefresh();
    } catch {
      setUncertain(true);
      setAutosaveHeld(true);
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
          setAutosaveHeld(false);
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
            <Button onClick={() => save('open')} disabled={saving !== null} pending={saving === 'open'} pendingLabel="Saving">
              Reopen
            </Button>
            <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              {status === 'dismissed'
                ? 'Dismissed: closed without work. Reopen puts it back in the queue.'
                : 'Reopen puts it back in the queue.'}
            </span>
          </>
        ) : (
          <>
            <Button variant="primary" onClick={() => save('done')} disabled={saving !== null} pending={saving === 'done'} pendingLabel="Saving">
              {linkedReportCount > 1 ? `Complete issue · ${linkedReportCount} reports` : 'Mark Done'}
            </Button>
            <Button
              onClick={() => save('dismissed')}
              disabled={saving !== null || linkedReportCount > 1}
              pending={saving === 'dismissed'}
              pendingLabel="Saving"
              title="Close without work: false alarm, duplicate, won't do"
            >
              Dismiss
            </Button>
            <fieldset disabled={saving !== null} style={{ marginLeft: 'auto', padding: 0, border: 0, minWidth: 0 }}>
              <SnoozeButton slipId={workSlipId} initialSnoozedUntil={initialSnoozedUntil} />
            </fieldset>
          </>
        )}
      </div>
      {linkedReportCount > 1 && !isClosed && <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>To dismiss only one report, separate the linked reports above first.</p>}
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
