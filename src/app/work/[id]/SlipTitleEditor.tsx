'use client';

import { useRef, useState, useTransition } from 'react';
import { updateWorkSlipTitle } from '../actions';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';

type Props = {
  slipId: string;
  initialTitle: string;
};

const TITLE_STYLE: React.CSSProperties = {
  fontSize: 38,
  lineHeight: 1.05,
  fontWeight: 300,
  letterSpacing: '-0.02em',
  color: 'var(--ink)',
  maxWidth: 720,
};

/**
 * The slip detail hero: "Work Slip" eyebrow + title, with an Edit
 * affordance that swaps the h1 for an input styled like it. Enter
 * saves, Escape cancels. Keep the draft open until the save is confirmed.
 */
export function SlipTitleEditor({ slipId, initialTitle }: Props) {
  const softRefresh = useSoftRefresh();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [draft, setDraft] = useState(initialTitle);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const saving = useRef(false);

  useUnsavedWorkGuard(pending || (editing && (draft !== title || !!err)));

  function beginEdit() {
    setDraft(title);
    setErr(null);
    setEditing(true);
    // Focus after the input mounts; select-all so typing replaces.
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }

  function cancel() {
    if (pending || saving.current) return;
    setEditing(false);
    setErr(null);
  }

  function save() {
    if (pending || saving.current) return;
    const next = draft.trim();
    if (!next) return;
    if (next === title && !err) {
      cancel();
      return;
    }
    setErr(null);
    saving.current = true;
    startTransition(async () => {
      try {
        const res = await updateWorkSlipTitle({ id: slipId, title: next });
        if (!res.ok) {
          setErr(res.error);
          return;
        }
        setTitle(next);
        setDraft(next);
        setEditing(false);
        softRefresh();
      } catch {
        setErr('Could not confirm the save. Your title is still here. Try saving again.');
      } finally {
        saving.current = false;
      }
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
        <div className="eyebrow">Work Slip</div>
        {!editing && (
          <button
            type="button"
            onClick={beginEdit}
            disabled={pending}
            style={{
              background: 'none',
              border: '1px solid var(--rule)',
              padding: '4px 10px',
              fontSize: 10,
              letterSpacing: '.16em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
              cursor: pending ? 'wait' : 'pointer',
            }}
          >
            {pending ? 'Saving…' : 'Edit Title'}
          </button>
        )}
      </div>

      {editing ? (
        <div>
          <input
            ref={inputRef}
            type="text"
            value={draft}
            disabled={pending}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                save();
              }
              if (e.key === 'Escape') cancel();
            }}
            aria-label="Work slip title"
            className="font-serif"
            style={{
              ...TITLE_STYLE,
              display: 'block',
              width: '100%',
              background: 'transparent',
              border: 'none',
              borderBottom: '1px dashed var(--ink-3)',
              padding: 0,
              outline: 'none',
            }}
          />
          <div className="flex items-center gap-2" style={{ marginTop: 10 }}>
            <button
              type="button"
              onClick={save}
              disabled={pending || !draft.trim()}
              style={{
                background: 'var(--ink)',
                color: 'var(--paper)',
                border: '1px solid var(--ink)',
                padding: '5px 14px',
                fontSize: 10,
                letterSpacing: '.16em',
                textTransform: 'uppercase',
                fontWeight: 600,
                cursor: pending ? 'wait' : draft.trim() ? 'pointer' : 'default',
                opacity: !pending && draft.trim() ? 1 : 0.5,
              }}
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={pending}
              style={{
                background: 'none',
                border: '1px solid var(--rule)',
                padding: '5px 14px',
                fontSize: 10,
                letterSpacing: '.16em',
                textTransform: 'uppercase',
                color: 'var(--ink-3)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <h1 className="font-serif" style={TITLE_STYLE}>
          {title}
        </h1>
      )}

      {err && (
        <div role="alert" style={{ marginTop: 10, fontSize: 12, color: 'var(--negative)', border: '1px solid var(--negative)', background: 'rgba(138, 58, 46, 0.06)', padding: '6px 10px', maxWidth: 720 }}>
          {err}
        </div>
      )}
    </div>
  );
}
