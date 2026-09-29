'use client';

import Link from 'next/link';
import { useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { useDraftNavigationGuard } from '@/lib/use-draft-navigation-guard';

/** Native fields remain mounted after failure; server-owned form content stays on the server. */
export function RetainedPropertyForm({ action, children, style, buttonStyle, submitLabel, cancelHref }: {
  action: (data: FormData) => Promise<void> | void;
  children: ReactNode;
  style?: CSSProperties;
  buttonStyle?: CSSProperties;
  submitLabel: string;
  cancelHref?: string;
}) {
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const submissionId = useRef<string | null>(null);
  const { busy, pending, error, run } = useRecoverableAction();
  useDraftNavigationGuard(dirty, pending);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const data = new FormData(event.currentTarget);
    submissionId.current ??= crypto.randomUUID();
    data.set('submission_id', submissionId.current);
    setDirty(true);
    setSaved(false);
    run(async () => { await action(data); setDirty(false); setSaved(true); },
      'Could not confirm the save. Your fields are kept. Try again; if the message persists, check the property before starting another entry.');
  }
  return <form onSubmit={submit} onChange={() => { setDirty(true); setSaved(false); }} style={style}>
    <fieldset disabled={pending} style={{ border: 0, margin: 0, padding: 0, minWidth: 0, display: 'contents' }}>
      {children}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 18 }}>
        <button type="submit" disabled={pending} aria-busy={pending} style={buttonStyle}>{pending ? 'Saving…' : submitLabel}</button>
        {cancelHref && <Link href={cancelHref} style={{ color: 'var(--ink-3)', padding: '13px 14px', fontSize: 11, fontWeight: 500, letterSpacing: '.18em', textTransform: 'uppercase', textDecoration: 'none' }}>Cancel</Link>}
      </div>
    </fieldset>
    {error && <p role="alert" style={{ color: 'var(--signal)', fontSize: 13 }}>{error}</p>}
    {saved && <p role="status">Saved.</p>}
  </form>;
}
