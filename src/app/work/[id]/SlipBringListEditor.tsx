'use client';

import { useRef, useState, useTransition } from 'react';
import { updateWorkSlipBringList } from '../actions';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';

type Props = {
  slipId: string;
  initialBringList: string | null;
};

/**
 * Office authoring of a slip's "what to bring" — the materials a contractor
 * needs to complete the job. Rolled into the packet's 85 Eastern supply-run
 * pick list. Only 1-in-30 slips has one, so when empty this renders as a
 * single quiet "+ Supply run" line; the content stays prominent whenever
 * something is actually listed.
 */
export function SlipBringListEditor({ slipId, initialBringList }: Props) {
  const softRefresh = useSoftRefresh();
  const [value, setValue] = useState(initialBringList ?? '');
  const [draft, setDraft] = useState(initialBringList ?? '');
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const saving = useRef(false);

  useUnsavedWorkGuard(pending || (editing && (draft !== value || !!err)));

  function beginEdit() {
    setDraft(value);
    setErr(null);
    setEditing(true);
    setTimeout(() => ref.current?.focus(), 0);
  }
  function cancel() {
    if (pending || saving.current) return;
    setEditing(false);
    setErr(null);
  }
  function save() {
    if (pending || saving.current) return;
    const next = draft.trim();
    if (next === value.trim() && !err) {
      cancel();
      return;
    }
    setErr(null);
    saving.current = true;
    startTransition(async () => {
      try {
        const res = await updateWorkSlipBringList({ id: slipId, bringList: next });
        if (!res.ok) {
          setErr(res.error);
          return;
        }
        setValue(next);
        setDraft(next);
        setEditing(false);
        softRefresh();
      } catch {
        setErr('Could not confirm the save. Your supply list is still here. Try saving again.');
      } finally {
        saving.current = false;
      }
    });
  }

  // Collapsed: nothing listed, not editing — one quiet line.
  if (!value && !editing) {
    return (
      <div>
        <button
          type="button"
          onClick={beginEdit}
          disabled={pending}
          style={quietLinkStyle(pending)}
        >
          {pending ? 'Saving…' : '+ Supply run'}
          <span style={{ marginLeft: 8, letterSpacing: 0, textTransform: 'none', color: 'var(--ink-4)', fontWeight: 400 }}>
            what the inspector should bring
          </span>
        </button>
        {err && <ErrorStrip message={err} />}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
        <div className="eyebrow" style={{ color: 'var(--signal)' }}>Supply run · what to bring</div>
        {!editing && (
          <button
            type="button"
            onClick={beginEdit}
            disabled={pending}
            style={{ background: 'none', border: '1px solid var(--rule)', padding: '4px 10px', fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink-3)', cursor: pending ? 'wait' : 'pointer' }}
          >
            {pending ? 'Saving…' : 'Edit'}
          </button>
        )}
      </div>

      {editing ? (
        <div>
          <textarea
            ref={ref}
            value={draft}
            disabled={pending}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                save();
              }
              if (e.key === 'Escape') cancel();
            }}
            rows={2}
            placeholder="Materials the inspector should grab to finish this - e.g. P-trap washer, plunger, 2 light bulbs"
            aria-label="What to bring"
            style={{ width: '100%', font: 'inherit', fontSize: 14, color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 6, padding: '8px 10px', outline: 'none', resize: 'vertical', lineHeight: 1.5 }}
          />
          <div className="flex items-center gap-2" style={{ marginTop: 8 }}>
            <button type="button" onClick={save} disabled={pending} style={{ background: 'var(--ink)', color: 'var(--paper)', border: '1px solid var(--ink)', padding: '5px 14px', fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 600, cursor: pending ? 'wait' : 'pointer' }}>{pending ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={cancel} disabled={pending} style={{ background: 'none', border: '1px solid var(--rule)', padding: '5px 14px', fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink-3)', cursor: 'pointer' }}>Cancel</button>
            <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>⌘+Enter to save</span>
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.5, margin: 0, whiteSpace: 'pre-wrap' }}>{value}</p>
      )}

      {err && <ErrorStrip message={err} />}
    </div>
  );
}

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
    <div role="alert" style={{ marginTop: 8, fontSize: 12, color: 'var(--negative)', border: '1px solid var(--negative)', background: 'rgba(138, 58, 46, 0.06)', padding: '6px 10px' }}>{message}</div>
  );
}
