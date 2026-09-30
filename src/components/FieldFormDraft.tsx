'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDraftScope } from '@/components/PhotoUploader';
import { clearFormDraft, clearSubmittedFormDraft, markFormDraftSubmitted, formDraftKey, readFormDraft, type DraftFields } from '@/lib/field-form-drafts';

type Status = 'loading' | 'empty' | 'saved' | 'unavailable';
/** Writes in the input handler, without a debounce that can lose the final edit. */
export function useFieldFormDraft<T extends DraftFields>(local: string | undefined, defaults: T) {
  const scope = useDraftScope(local);
  const initial = useRef(defaults);
  useEffect(() => { initial.current = defaults; });
  const current = useRef<{ scope: string | undefined; value: T; raw: string | null }>({ scope, value: defaults, raw: null });
  const [snapshot, setSnapshot] = useState({ scope, value: defaults, status: (scope ? 'loading' : 'empty') as Status });
  useEffect(() => {
    let value = initial.current, raw: string | null = null, status: Status = 'empty';
    if (scope) {
      try {
        ({ value, raw } = readFormDraft(localStorage, scope, value));
        status = raw ? 'saved' : 'empty';
      } catch { status = 'unavailable'; }
    }
    current.current = { scope, value, raw };
    setSnapshot({ scope, value, status });
  }, [scope]);
  const ready = snapshot.scope === scope && snapshot.status !== 'loading';
  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    if (current.current.scope !== scope) return;
    const next = { ...current.current.value, [key]: value };
    let raw = current.current.raw;
    let status: Status = 'empty';
    if (scope) {
      try { raw = JSON.stringify(next); localStorage.setItem(formDraftKey(scope), raw); status = 'saved'; }
      catch { status = 'unavailable'; }
    }
    current.current = { scope, value: next, raw };
    setSnapshot({ scope, value: next, status });
  }, [scope]);
  // Capture the submitted version. An in-flight response cannot clear later edits.
  const clear = useCallback((submitted: T = snapshot.value) => {
    if (scope) {
      try { clearFormDraft(localStorage, scope, JSON.stringify(submitted)); }
      catch { /* A confirmed server save stays successful if device cleanup fails. */ }
    }
  }, [scope, snapshot.value]);
  const markSubmitted = useCallback(() => {
    if (scope) { try { markFormDraftSubmitted(localStorage, scope, snapshot.value); } catch { /* keep in memory */ } }
  }, [scope, snapshot.value]);
  return { markSubmitted, value: snapshot.scope === scope ? snapshot.value : defaults, set, clear, ready,
    status: (ready ? snapshot.status : 'loading') as Status };
}

export function FieldDraftStatus({ status }: { status: Status }) {
  if (status === 'empty') return null;
  return <p role="status" style={{ margin: '8px 0', fontSize: 12, lineHeight: 1.5, color: status === 'unavailable' ? 'var(--signal)' : 'var(--ink-3)' }}>
    {status === 'loading' ? 'Checking for a saved draft…' : status === 'saved'
      ? 'Draft saved on this device. Not submitted yet.'
      : 'Device storage is unavailable. Keep this page open until you save.'}
  </p>;
}

/** Render only after the server confirms this maintenance task is complete. */
export function ClearCompletedFormDraft({ draftKey }: { draftKey: string }) {
  const scope = useDraftScope(draftKey);
  useEffect(() => {
    if (scope) {
      try { clearSubmittedFormDraft(localStorage, scope); } catch { /* best effort */ }
    }
  }, [scope]);
  return null;
}
