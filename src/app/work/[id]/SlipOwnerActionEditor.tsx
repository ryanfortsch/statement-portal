'use client';

import { useRef, useState, useTransition } from 'react';
import type { WorkSlipOwnerActionType, WorkSlipOwnerStatus } from '@/lib/work-types';
import { updateWorkSlipOwnerAction, updateWorkSlipOwnerStatus } from '../actions';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';

type OwnerChange =
  | { kind: 'flag'; value: boolean }
  | { kind: 'type'; value: WorkSlipOwnerActionType | null }
  | { kind: 'answer'; value: WorkSlipOwnerStatus }
  | { kind: 'notes'; value: string };

type Props = {
  slipId: string;
  propertyId: string;
  initialType: WorkSlipOwnerActionType | null;
  initialNotes: string | null;
  ownerStatus: WorkSlipOwnerStatus | null;
  ownerLastContactedAt: string | null;
  /** Quiet-row mode: the slip isn't flagged yet, render one "+ Owner input"
   *  line that arms the flag. The full editor renders in its own section. */
  collapsed?: boolean;
};

const TYPE_OPTIONS: { value: WorkSlipOwnerActionType; label: string; hint: string }[] = [
  { value: 'approve', label: 'Approval', hint: 'needs the owner’s sign-off' },
  { value: 'purchase', label: 'Purchase', hint: 'buy / replace decision' },
  { value: 'schedule', label: 'Scheduling', hint: 'pick a date or window' },
  { value: 'decide', label: 'Decision', hint: 'needs the owner’s call' },
  { value: 'reimburse', label: 'Reimbursement', hint: 'money back to Rising Tide' },
];

const ANSWER_OPTIONS: { value: WorkSlipOwnerStatus; label: string }[] = [
  { value: 'approved', label: 'Approved' },
  { value: 'declined', label: 'Declined' },
  { value: 'questions', label: 'Has questions' },
];

/**
 * The writer side of the owner-action rail. Flagging here (or filing a slip
 * under the Owner category) is what lights up the board's Owner Action
 * filter, the OWNER badges, the /properties rollup, the daily brief, and
 * the Draft-owner-email bundler. The answer chips log the owner's reply so
 * the brief stops nagging once a slip is approved.
 */
export function SlipOwnerActionEditor({
  slipId,
  propertyId,
  initialType,
  initialNotes,
  ownerStatus,
  ownerLastContactedAt,
  collapsed = false,
}: Props) {
  const softRefresh = useSoftRefresh();
  const [type, setType] = useState<WorkSlipOwnerActionType | null>(initialType);
  const [notes, setNotes] = useState(initialNotes ?? '');
  const [draft, setDraft] = useState(initialNotes ?? '');
  const [editingNotes, setEditingNotes] = useState(false);
  const [status, setStatus] = useState<WorkSlipOwnerStatus>(ownerStatus ?? 'not_sent');
  const [drafting, setDrafting] = useState(false);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<OwnerChange | null>(null);
  const saving = useRef(false);
  const draftingRef = useRef(false);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const notesDirty = draft !== notes;
  useUnsavedWorkGuard(notesDirty || pending || drafting || attempt !== null);

  function saveChange(change: OwnerChange) {
    if (saving.current || draftingRef.current) return;
    if (change.kind === 'flag' && !change.value && notesDirty) {
      setErr('Save or discard your notes before removing owner input.');
      return;
    }
    saving.current = true;
    setErr(null);
    setAttempt(change);
    startTransition(async () => {
      try {
        const res = change.kind === 'answer'
          ? await updateWorkSlipOwnerStatus({ id: slipId, owner_status: change.value })
          : await updateWorkSlipOwnerAction({
              id: slipId,
              propertyId,
              owner_action_required: change.kind === 'flag' ? change.value : true,
              ...(change.kind === 'type' ? { owner_action_type: change.value } : {}),
              ...(change.kind === 'notes' ? { owner_action_notes: change.value } : {}),
            });
        if (!res.ok) { setErr(res.error); return; }
        if (change.kind === 'type') setType(change.value);
        if (change.kind === 'answer') setStatus(change.value);
        if (change.kind === 'notes') {
          setNotes(change.value);
          setDraft(change.value);
          setEditingNotes(false);
        }
        if (change.kind === 'flag' && !change.value) {
          setType(null);
          setStatus('not_sent');
          setNotes('');
          setDraft('');
          setEditingNotes(false);
        }
        setAttempt(null);
        softRefresh();
      } catch {
        setErr('Could not confirm the owner-input change. Your selection is kept for retry.');
      } finally {
        saving.current = false;
      }
    });
  }

  function chooseType(next: WorkSlipOwnerActionType) {
    saveChange({ kind: 'type', value: next === type ? null : next });
  }

  function chooseAnswer(next: WorkSlipOwnerStatus) {
    // Toggling the active answer steps back to the pre-answer state:
    // 'sent' if an email ever went out, otherwise 'not_sent'.
    const base: WorkSlipOwnerStatus = ownerLastContactedAt ? 'sent' : 'not_sent';
    saveChange({ kind: 'answer', value: next === status ? base : next });
  }

  function saveNotes() {
    const next = draft.trim();
    if (saving.current || draftingRef.current) return;
    if (next === notes.trim() && attempt?.kind !== 'notes') {
      setDraft(notes);
      setEditingNotes(false);
      return;
    }
    saveChange({ kind: 'notes', value: next });
  }

  function cancelNotes() {
    if (saving.current || draftingRef.current) return;
    setDraft(notes);
    setEditingNotes(false);
    if (attempt?.kind === 'notes') { setAttempt(null); setErr(null); }
  }

  async function draftOwnerEmail() {
    if (draftingRef.current || saving.current || notesDirty || attempt) return;
    draftingRef.current = true;
    setDrafting(true);
    setErr(null);
    try {
      const res = await fetch('/api/work/draft-owner-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: propertyId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.error || `Failed (${res.status})`);
        return;
      }
      if (data?.draft_url) {
        window.open(data.draft_url, '_blank', 'noopener,noreferrer');
      }
      softRefresh();
    } catch {
      setErr('Could not confirm the email draft. Check Gmail Drafts before trying again.');
    } finally {
      draftingRef.current = false;
      setDrafting(false);
    }
  }

  const feedback = err && (
    <div role="alert">
      <ErrorStrip message={err} />
      {attempt && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="button" disabled={pending || drafting} onClick={() => attempt.kind === 'notes' ? saveNotes() : saveChange(attempt)} style={ghostBtnStyle}>Retry save</button>
          <button type="button" disabled={pending || drafting} onClick={() => { setAttempt(null); setErr(null); }} style={ghostBtnStyle}>Dismiss error</button>
        </div>
      )}
    </div>
  );

  if (collapsed) {
    return (
      <div>
        <button type="button" onClick={() => saveChange({ kind: 'flag', value: true })} disabled={pending} style={quietLinkStyle(pending)}>
          {pending ? 'Saving…' : '+ Owner input'}
          <span style={{ marginLeft: 8, letterSpacing: 0, textTransform: 'none', color: 'var(--ink-4)', fontWeight: 400 }}>
            flag this for the owner&rsquo;s decision
          </span>
        </button>
        {feedback}
      </div>
    );
  }

  return (
    <fieldset disabled={pending || drafting} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* THE ASK — what kind of input the owner owes us. Optional; the
          email reads fine without it, but a type adds the "Needs your
          approval" style line under the item. */}
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>The ask</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TYPE_OPTIONS.map((o) => {
            const active = type === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => chooseType(o.value)}
                disabled={pending}
                aria-pressed={active}
                title={o.hint}
                style={chipStyle(active, pending)}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 8, marginBottom: 0 }}>
          {type
            ? TYPE_OPTIONS.find((o) => o.value === type)?.hint
            : 'Optional — labels the item in the owner email.'}
        </p>
      </div>

      {/* CONTEXT — free text that rides along in the email as "Notes:". */}
      <div>
        {editingNotes ? (
          <div>
            <textarea
              ref={notesRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveNotes(); }
                if (e.key === 'Escape') cancelNotes();
              }}
              rows={2}
              placeholder="Context for the owner - e.g. quote came in at $480, plumber can do Thursday"
              aria-label="Context for the owner"
              style={{ width: '100%', font: 'inherit', fontSize: 14, color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 6, padding: '8px 10px', outline: 'none', resize: 'vertical', lineHeight: 1.5 }}
            />
            <div className="flex items-center gap-2" style={{ marginTop: 8 }}>
              <button type="button" onClick={saveNotes} style={solidBtnStyle}>{pending && attempt?.kind === 'notes' ? 'Saving…' : 'Save'}</button>
              <button type="button" onClick={cancelNotes} style={ghostBtnStyle}>Cancel</button>
              <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>⌘+Enter to save</span>
            </div>
          </div>
        ) : notes ? (
          <div>
            <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
              <div className="eyebrow">Context for the email</div>
              <button
                type="button"
                onClick={() => { setDraft(notes); setEditingNotes(true); setTimeout(() => notesRef.current?.focus(), 0); }}
                disabled={pending}
                style={ghostBtnStyle}
              >
                Edit
              </button>
            </div>
            <p style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.5, margin: 0, whiteSpace: 'pre-wrap' }}>{notes}</p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => { setDraft(''); setEditingNotes(true); setTimeout(() => notesRef.current?.focus(), 0); }}
            disabled={pending}
            style={quietLinkStyle(pending)}
          >
            + Context
            <span style={{ marginLeft: 8, letterSpacing: 0, textTransform: 'none', color: 'var(--ink-4)', fontWeight: 400 }}>
              rides along in the owner email
            </span>
          </button>
        )}
      </div>

      {/* THE LOOP — draft the ask, then log what came back. */}
      <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 14 }}>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={draftOwnerEmail}
            disabled={drafting || pending || notesDirty || attempt !== null}
            style={solidBtnStyle}
          >
            {drafting ? 'Drafting…' : 'Draft owner email'}
          </button>
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            {status === 'sent' && ownerLastContactedAt
              ? `Asked ${formatDate(ownerLastContactedAt)} — awaiting reply. Drafting again re-bundles.`
              : 'Bundles every flagged item at this property into one Gmail draft.'}
          </span>
        </div>
        {(notesDirty || attempt) && <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 8 }}>Save or discard your unfinished changes before drafting the owner email.</p>}

        <div style={{ marginTop: 14 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Owner&rsquo;s answer</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ANSWER_OPTIONS.map((o) => {
              const active = status === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => chooseAnswer(o.value)}
                  disabled={pending}
                  aria-pressed={active}
                  style={chipStyle(active, pending)}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 8, marginBottom: 0 }}>
            {status === 'approved'
              ? 'Approved — drops off the daily brief.'
              : status === 'declined'
                ? 'Declined — dismiss the slip if the work is off.'
                : status === 'questions'
                  ? 'Owner has questions — reply, then update this.'
                  : 'Log the reply from your inbox or a call.'}
          </p>
        </div>
      </div>

      <div>
        <button type="button" onClick={() => { if (!notesDirty) saveChange({ kind: 'flag', value: false }); }} disabled={pending || notesDirty} style={quietLinkStyle(pending || notesDirty)}>
          {pending ? 'Saving…' : 'Doesn’t need owner input'}
          <span style={{ marginLeft: 8, letterSpacing: 0, textTransform: 'none', color: 'var(--ink-4)', fontWeight: 400 }}>
            un-flag and clear the ask
          </span>
        </button>
      </div>

      {feedback}
    </fieldset>
  );
}

function chipStyle(active: boolean, pending: boolean): React.CSSProperties {
  return {
    background: active ? 'var(--ink)' : 'none',
    color: active ? 'var(--paper)' : 'var(--ink)',
    border: `1px solid ${active ? 'var(--ink)' : 'var(--rule)'}`,
    padding: '5px 12px',
    fontSize: 10,
    letterSpacing: '.16em',
    textTransform: 'uppercase',
    fontWeight: 700,
    cursor: pending ? 'default' : 'pointer',
    opacity: pending ? 0.6 : 1,
  };
}

const solidBtnStyle: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: '1px solid var(--ink)',
  padding: '5px 14px',
  fontSize: 10,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  fontWeight: 600,
  cursor: 'pointer',
};

const ghostBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--rule)',
  padding: '4px 10px',
  fontSize: 10,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  cursor: 'pointer',
};

function quietLinkStyle(pending: boolean): React.CSSProperties {
  return {
    background: 'none',
    border: 'none',
    padding: 0,
    fontSize: 11,
    letterSpacing: '.16em',
    textTransform: 'uppercase',
    fontWeight: 600,
    color: 'var(--ink-3)',
    cursor: pending ? 'wait' : 'pointer',
    textAlign: 'left',
  };
}

function ErrorStrip({ message }: { message: string }) {
  return (
    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--negative)', border: '1px solid var(--negative)', background: 'rgba(138, 58, 46, 0.06)', padding: '6px 10px' }}>{message}</div>
  );
}

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return value;
  }
}
