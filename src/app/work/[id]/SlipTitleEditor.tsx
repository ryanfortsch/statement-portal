'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateWorkSlipTitle } from '../actions';

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
 * saves, Escape cancels. Optimistic with rollback, matching the
 * other slip editors.
 */
export function SlipTitleEditor({ slipId, initialTitle }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [draft, setDraft] = useState(initialTitle);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    setEditing(false);
    setErr(null);
  }

  function save() {
    const next = draft.trim();
    if (!next || next === title) {
      cancel();
      return;
    }
    setErr(null);
    setEditing(false);
    const prev = title;
    setTitle(next);
    startTransition(async () => {
      const res = await updateWorkSlipTitle({ id: slipId, title: next });
      if (!res.ok) {
        setTitle(prev);
        setErr(res.error);
        return;
      }
      router.refresh();
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
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
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
              disabled={!draft.trim()}
              style={{
                background: 'var(--ink)',
                color: 'var(--paper)',
                border: '1px solid var(--ink)',
                padding: '5px 14px',
                fontSize: 10,
                letterSpacing: '.16em',
                textTransform: 'uppercase',
                fontWeight: 600,
                cursor: draft.trim() ? 'pointer' : 'default',
                opacity: draft.trim() ? 1 : 0.5,
              }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={cancel}
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
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--negative)', border: '1px solid var(--negative)', background: 'rgba(138, 58, 46, 0.06)', padding: '6px 10px', maxWidth: 720 }}>
          {err}
        </div>
      )}
    </div>
  );
}
