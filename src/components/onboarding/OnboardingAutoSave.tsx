'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { saveOnboardingDraft } from '@/app/projections/actions';
import { createDraftAutosave } from '@/lib/draft-autosave';

/**
 * Auto-save wrapper for the public onboarding form.
 *
 * The form is long enough that owners often fill out part of it, get
 * interrupted, and never reach the Submit button at the bottom. This
 * wrapper attaches a single delegated input listener at the form
 * boundary, debounces 1500ms after the last keystroke, and pings
 * `saveOnboardingDraft` on the server — same parser as the final
 * submit, just without the side effects (no `onboarding_submitted_at`
 * stamp, no staff notification email, no redirect).
 *
 * The form itself stays server-rendered with `defaultValue` props; this
 * wrapper only intercepts events. The Submit button at the bottom still
 * fires the full `submitOnboarding` action as today — auto-save is in
 * addition, not a replacement.
 *
 * The status indicator (Saving… / Saved 2 min ago / Couldn't save)
 * sits in the form's hero so the owner can see their progress is safe
 * without scrolling.
 */
export function OnboardingAutoSave({
  initialSavedAt,
  children,
}: {
  initialSavedAt?: string | null;
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const retryRef = useRef<() => void>(() => {});
  const dirtyRef = useRef(false);
  const [status, setStatus] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>(
    initialSavedAt ? 'saved' : 'idle',
  );
  const [savedAt, setSavedAt] = useState<string | null>(initialSavedAt ?? null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const root = containerRef.current;
    const form = root?.querySelector('form');
    if (!root || !form) return;
    const targetForm = form;
    let mounted = true;
    let waitingToSubmit = false;
    let replayingSubmit = false;
    let finalSubmitting = false;
    const autosave = createDraftAutosave({
      capture: () => new FormData(form),
      save: (fd) => new Promise((resolve, reject) => {
        startTransition(async () => {
          try { resolve(await saveOnboardingDraft(fd)); }
          catch (error) { reject(error); }
        });
      }),
      onState: (state) => {
        dirtyRef.current = state.status !== 'saved';
        setStatus(state.status);
        if (state.savedAt) setSavedAt(state.savedAt);
      },
    });
    function retry() { void autosave.flush(); }
    retryRef.current = retry;
    function beforeUnload(event: BeforeUnloadEvent) {
      if (dirtyRef.current && !finalSubmitting) {
        event.preventDefault();
        event.returnValue = '';
      }
    }
    function scheduleSave() { finalSubmitting = false; autosave.resume(); autosave.changed(); }
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') void autosave.flush();
    }

    function onSubmit(event: SubmitEvent) {
      if (event.defaultPrevented) return;
      const olderWrite = autosave.pause();
      if (replayingSubmit || !olderWrite) { finalSubmitting = true; return; }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (waitingToSubmit) return;
      waitingToSubmit = true;
      const submitter = event.submitter;
      void olderWrite.then(() => {
        if (!mounted) return;
        waitingToSubmit = false;
        // Re-run normal validation and the existing form action with the
        // latest answers, after the older draft write has settled.
        autosave.resume();
        replayingSubmit = true;
        try { targetForm.requestSubmit(submitter ?? undefined); }
        finally { replayingSubmit = false; }
      });
    }

    root.addEventListener('input', scheduleSave);
    root.addEventListener('change', scheduleSave);
    form.addEventListener('submit', onSubmit, true);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', retry);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      mounted = false;
      retryRef.current = () => {};
      window.removeEventListener('online', retry);
      window.removeEventListener('beforeunload', beforeUnload);
      autosave.dispose();
      root.removeEventListener('input', scheduleSave);
      root.removeEventListener('change', scheduleSave);
      form.removeEventListener('submit', onSubmit, true);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return (
    <div ref={containerRef}>
      <DraftStatus status={status} savedAt={savedAt} />
      {status === 'error' && <button type="button" onClick={() => retryRef.current()} style={{ background: 'transparent', border: '1px solid var(--rule)', color: 'var(--ink)', padding: '10px 14px', marginBottom: 12, minHeight: 44, font: 'inherit', cursor: 'pointer' }}>Retry save</button>}
      {children}
    </div>
  );
}

function DraftStatus({
  status,
  savedAt,
}: {
  status: 'idle' | 'pending' | 'saving' | 'saved' | 'error';
  savedAt: string | null;
}) {
  // Tick relative-time every 30s so "Saved 1 min ago" rolls forward
  // without re-saving anything.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  let label = '';
  let color = 'var(--ink-4)';
  if (status === 'pending') {
    label = 'Unsaved changes';
    color = 'var(--ink-3)';
  } else if (status === 'saving') {
    label = 'Saving…';
    color = 'var(--ink-3)';
  } else if (status === 'error') {
    label = 'Couldn’t save — check your connection';
    color = 'var(--negative, #b04a3a)';
  } else if (status === 'saved' && savedAt) {
    label = `Saved ${relativeTime(savedAt)}`;
    color = 'var(--positive, #2f7a3a)';
  } else {
    // Idle with nothing saved yet — surface a passive reassurance so the
    // owner knows the form auto-saves before they invest typing.
    label = 'Auto-saves as you type';
    color = 'var(--ink-4)';
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        fontSize: 11,
        letterSpacing: '0.04em',
        color,
        textAlign: 'right',
        marginBottom: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 6,
      }}
    >
      <Dot color={color} pulsing={status === 'saving'} />
      <span>{label}</span>
    </div>
  );
}

function Dot({ color, pulsing }: { color: string; pulsing: boolean }) {
  return (
    <>
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: color,
          display: 'inline-block',
          animation: pulsing ? 'rt-autosave-pulse 1.1s ease-in-out infinite' : undefined,
        }}
      />
      <style>{`
        @keyframes rt-autosave-pulse {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 1; }
        }
      `}</style>
    </>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const d = Math.round(hr / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}
