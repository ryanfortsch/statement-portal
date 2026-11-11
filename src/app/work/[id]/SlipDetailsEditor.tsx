'use client';

import { useState, useTransition } from 'react';
import { updateWorkSlipDetails } from '../actions';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { Button } from '@/components/Button';

/**
 * The slip's Details, read and edited in place: the action summary and the
 * description. A slip with neither still shows the section, so a missing
 * description can be written rather than only read. The draft stays open
 * until the save is confirmed.
 */
export function SlipDetailsEditor({
  slipId,
  initialDescription,
  initialActionSummary,
}: {
  slipId: string;
  initialDescription: string | null;
  initialActionSummary: string | null;
}) {
  const softRefresh = useSoftRefresh();
  const [saved, setSaved] = useState({ description: initialDescription ?? '', summary: initialActionSummary ?? '' });
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(saved.description);
  const [summary, setSummary] = useState(saved.summary);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const dirty = description !== saved.description || summary !== saved.summary;
  useUnsavedWorkGuard(pending || (editing && dirty));

  function begin() {
    setDescription(saved.description);
    setSummary(saved.summary);
    setErr(null);
    setEditing(true);
  }

  function cancel() {
    if (pending) return;
    setEditing(false);
    setErr(null);
  }

  function save() {
    if (pending) return;
    if (!dirty) {
      setEditing(false);
      return;
    }
    setErr(null);
    startTransition(async () => {
      try {
        const res = await updateWorkSlipDetails({ id: slipId, description, actionSummary: summary });
        if (!res.ok) {
          setErr(res.error);
          return;
        }
        setSaved({ description: description.trim(), summary: summary.trim() });
        setEditing(false);
        softRefresh();
      } catch {
        setErr('Could not confirm the save. Your words are still here. Try saving again.');
      }
    });
  }

  if (editing) {
    return (
      <div>
        <label className="eyebrow" htmlFor={`summary-${slipId}`} style={{ display: 'block', marginBottom: 6, color: 'var(--signal)' }}>
          Action summary
        </label>
        <textarea
          id={`summary-${slipId}`}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          disabled={pending}
          rows={2}
          placeholder="One line: what needs doing"
          style={fieldStyle}
        />
        <label className="eyebrow" htmlFor={`description-${slipId}`} style={{ display: 'block', margin: '16px 0 6px' }}>
          Description
        </label>
        <textarea
          id={`description-${slipId}`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={pending}
          rows={Math.min(14, Math.max(5, description.split('\n').length + 1))}
          placeholder="Counts, sizes, where it goes"
          style={fieldStyle}
        />
        <div className="flex items-center gap-2" style={{ marginTop: 12 }}>
          <Button variant="primary" size="sm" onClick={save} pending={pending} pendingLabel="Saving">
            Save
          </Button>
          <Button size="sm" onClick={cancel} disabled={pending}>
            Cancel
          </Button>
        </div>
        {err && (
          <p role="alert" style={{ marginTop: 10, fontSize: 13, color: 'var(--negative)' }}>
            {err}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      {saved.summary && (
        <div style={{ marginBottom: 14 }}>
          <div className="eyebrow" style={{ marginBottom: 6, color: 'var(--signal)' }}>Action summary</div>
          <p style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.5, margin: 0 }}>{saved.summary}</p>
        </div>
      )}
      {saved.description ? (
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Description</div>
          <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55, margin: 0, whiteSpace: 'pre-wrap' }}>
            {saved.description}
          </p>
        </div>
      ) : !saved.summary ? (
        <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: 0 }}>No description yet.</p>
      ) : null}
      <div style={{ marginTop: 12 }}>
        <Button size="sm" onClick={begin}>
          {saved.description || saved.summary ? 'Edit details' : 'Add details'}
        </Button>
      </div>
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  font: 'inherit',
  fontSize: 14,
  lineHeight: 1.55,
  padding: '10px 12px',
  border: '1px solid var(--rule)',
  background: 'var(--paper-2, #fff)',
  color: 'var(--ink)',
  resize: 'vertical',
};
