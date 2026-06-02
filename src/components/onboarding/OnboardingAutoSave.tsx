'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { saveOnboardingDraft } from '@/app/projections/actions';

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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    initialSavedAt ? 'saved' : 'idle',
  );
  const [savedAt, setSavedAt] = useState<string | null>(initialSavedAt ?? null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    function saveNow() {
      const form = root?.querySelector('form');
      if (!form) return;
      const fd = new FormData(form);
      setStatus('saving');
      startTransition(async () => {
        try {
          const res = await saveOnboardingDraft(fd);
          if (res.ok) {
            setSavedAt(res.savedAt);
            setStatus('saved');
            dirtyRef.current = false;
          } else {
            setStatus('error');
          }
        } catch {
          setStatus('error');
        }
      });
    }

    function scheduleSave() {
      dirtyRef.current = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(saveNow, 1500);
    }

    // Don't fire on the form's own submit — let submitOnboarding take
    // over. We also flush a final save on visibilitychange so a pending
    // debounced edit isn't lost when the owner switches tabs.
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden' && dirtyRef.current) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        saveNow();
      }
    }

    root.addEventListener('input', scheduleSave);
    root.addEventListener('change', scheduleSave);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      root.removeEventListener('input', scheduleSave);
      root.removeEventListener('change', scheduleSave);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div ref={containerRef}>
      <DraftStatus status={status} savedAt={savedAt} />
      {children}
    </div>
  );
}

function DraftStatus({
  status,
  savedAt,
}: {
  status: 'idle' | 'saving' | 'saved' | 'error';
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
  if (status === 'saving') {
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
