'use client';

import { useRef, useState, useTransition } from 'react';
import type { WorkSlipOwnerActionType, WorkSlipOwnerStatus } from '@/lib/work-types';
import { updateWorkSlipOwnerAction, updateWorkSlipOwnerStatus } from '../actions';
import { useSoftRefresh } from '@/lib/use-soft-refresh';

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
  const notesRef = useRef<HTMLTextAreaElement>(null);

  function arm() {
    setErr(null);
    startTransition(async () => {
      const res = await updateWorkSlipOwnerAction({
        id: slipId,
        owner_action_required: true,
        propertyId,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      softRefresh();
    });
  }

  function disarm() {
    setErr(null);
    startTransition(async () => {
      const res = await updateWorkSlipOwnerAction({
        id: slipId,
        owner_action_required: false,
        propertyId,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      softRefresh();
    });
  }

  function chooseType(next: WorkSlipOwnerActionType) {
    const target = next === type ? null : next;
    const prev = type;
    setErr(null);
    setType(target);
    startTransition(async () => {
      const res = await updateWorkSlipOwnerAction({
        id: slipId,
        owner_action_required: true,
        owner_action_type: target,
        propertyId,
      });
      if (!res.ok) {
        setType(prev);
        setErr(res.error);
      }
    });
  }

  function chooseAnswer(next: WorkSlipOwnerStatus) {
    // Toggling the active answer steps back to the pre-answer state:
    // 'sent' if an email ever went out, otherwise 'not_sent'.
    const base: WorkSlipOwnerStatus = ownerLastContactedAt ? 'sent' : 'not_sent';
    const target = next === status ? base : next;
    const prev = status;
    setErr(null);
    setStatus(target);
    startTransition(async () => {
      const res = await updateWorkSlipOwnerStatus({ id: slipId, owner_status: target });
      if (!res.ok) {
        setStatus(prev);
        setErr(res.error);
      }
    });
  }

  function saveNotes() {
    const next = draft.trim();
    setEditingNotes(false);
    if (next === notes.trim()) return;
    const prev = notes;
    setErr(null);
    setNotes(next);
    startTransition(async () => {
      const res = await updateWorkSlipOwnerAction({
        id: slipId,
        owner_action_required: true,
        owner_action_notes: next,
        propertyId,
      });
      if (!res.ok) {
        setNotes(prev);
        setErr(res.error);
      }
    });
  }

  async function draftOwnerEmail() {
    if (drafting) return;
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
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDrafting(false);
    }
  }

  if (collapsed) {
    return (
      <div>
        <button type="button" onClick={arm} disabled={pending} style={quietLinkStyle(pending)}>
          {pending ? 'Saving…' : '+ Owner input'}
          <span style={{ marginLeft: 8, letterSpacing: 0, textTransform: 'none', color: 'var(--ink-4)', fontWeight: 400 }}>
            flag this for the owner&rsquo;s decision
          </span>
        </button>
        {err && <ErrorStrip message={err} />}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
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
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNotes();
                if (e.key === 'Escape') setEditingNotes(false);
              }}
              rows={2}
              placeholder="Context for the owner - e.g. quote came in at $480, plumber can do Thursday"
              aria-label="Context for the owner"
              style={{ width: '100%', font: 'inherit', fontSize: 14, color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 6, padding: '8px 10px', outline: 'none', resize: 'vertical', lineHeight: 1.5 }}
            />
            <div className="flex items-center gap-2" style={{ marginTop: 8 }}>
              <button type="button" onClick={saveNotes} style={solidBtnStyle}>Save</button>
              <button type="button" onClick={() => setEditingNotes(false)} style={ghostBtnStyle}>Cancel</button>
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
            disabled={drafting}
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
        <button type="button" onClick={disarm} disabled={pending} style={quietLinkStyle(pending)}>
          {pending ? 'Saving…' : 'Doesn’t need owner input'}
          <span style={{ marginLeft: 8, letterSpacing: 0, textTransform: 'none', color: 'var(--ink-4)', fontWeight: 400 }}>
            un-flag and clear the ask
          </span>
        </button>
      </div>

      {err && <ErrorStrip message={err} />}
    </div>
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
