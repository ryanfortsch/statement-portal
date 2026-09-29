'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';

/** Retain a text draft until the server confirms it, including after a blur. */
export function PacketTextEditor({ value, label, save, rows = 2, maxLength = 4000, required = false, placeholder, style, autoFocus, onDirtyChange }: {
  value: string;
  label: string;
  save: (text: string) => Promise<{ ok: boolean }>;
  rows?: number;
  maxLength?: number;
  required?: boolean;
  placeholder?: string;
  style?: React.CSSProperties;
  autoFocus?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [text, setText] = useState(value);
  const [saved, setSaved] = useState({ source: value, text: value });
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const lock = useRef(false);
  const report = useRef(onDirtyChange);
  report.current = onDirtyChange;
  if (saved.source !== value) {
    if (!lock.current && text === saved.text && !uncertain) setText(value);
    setSaved({ source: value, text: value });
  }
  const dirty = text !== saved.text || uncertain;
  useUnsavedWorkGuard(dirty || pending);
  useEffect(() => {
    report.current?.(dirty || pending);
    return () => report.current?.(false);
  }, [dirty, pending]);

  function submit() {
    if (lock.current || (!dirty && !error)) return;
    const submitted = text.trim();
    if (required && !submitted) { setError('The job needs a description. Your saved text has not changed.'); return; }
    lock.current = true; setError('');
    start(async () => {
      try {
        const result = await save(submitted);
        if (!result.ok) { setError('Could not save this text. Your edit is kept; please retry.'); return; }
        setSaved({ source: value, text: submitted });
        setText(submitted); setUncertain(false);
      } catch {
        setUncertain(true);
        setError('Could not confirm this save. Your edit is kept; retry to save this version.');
      } finally { lock.current = false; }
    });
  }
  function discard() {
    if (lock.current) return;
    setText(saved.text); setUncertain(false); setError('');
  }

  return <div>
    <textarea aria-label={label} value={text} onChange={(e) => setText(e.target.value)} onBlur={submit}
      disabled={pending} rows={rows} maxLength={maxLength} placeholder={placeholder} style={style} autoFocus={autoFocus} />
    <div style={{ fontSize: 11, marginTop: 4, color: 'var(--ink-4)' }}>
      {pending ? <span role="status">Saving…</span> : dirty || error ? <>
        <span>{error ? '' : 'Unsaved edits '}</span>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={submit}>{error ? 'Retry save' : 'Save'}</button>{' '}
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={discard}>Discard edit</button>
      </> : <span>Saved</span>}
    </div>
    {error && <div role="alert" style={{ fontSize: 12, color: 'var(--negative)', marginTop: 4 }}>{error}</div>}
  </div>;
}
