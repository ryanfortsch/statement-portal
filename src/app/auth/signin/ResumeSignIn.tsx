'use client';

import { useEffect, useRef } from 'react';
import { resumeSignIn } from './actions';
import { LAST_SIGN_IN_KEY, RESUME_ATTEMPT_KEY, shouldResumeSignIn } from '@/lib/auth-resume';

/**
 * When this browser was signed in before and the cookie has gone, try once
 * to sign the same person back in silently (src/lib/auth-resume.ts). The form
 * is always in the page but hidden; the effect fills it from localStorage,
 * shows one quiet line and submits. Otherwise the page reads as usual.
 */
export function ResumeSignIn({ callbackUrl, error }: { callbackUrl?: string; error?: string }) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const hintRef = useRef<HTMLInputElement | null>(null);
  const statusRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    let lastAttemptAt: number | null = null;
    try {
      stored = window.localStorage.getItem(LAST_SIGN_IN_KEY);
      const raw = window.localStorage.getItem(RESUME_ATTEMPT_KEY);
      lastAttemptAt = raw ? Number(raw) : null;
    } catch {
      return;
    }
    const now = Date.now();
    if (!stored || !shouldResumeSignIn({ hint: stored, error, lastAttemptAt, now })) return;
    try {
      window.localStorage.setItem(RESUME_ATTEMPT_KEY, String(now));
    } catch {
      // Without a place to record the attempt it could repeat; do not try.
      return;
    }
    const form = formRef.current;
    if (!form || !hintRef.current || !statusRef.current) return;
    hintRef.current.value = stored;
    statusRef.current.textContent = `Signing you back in as ${stored.split('@')[0]}...`;
    form.hidden = false;
    form.requestSubmit();
  }, [error]);

  return (
    <form ref={formRef} action={resumeSignIn} hidden style={{ marginBottom: 20, textAlign: 'center' }}>
      <input ref={hintRef} type="hidden" name="hint" defaultValue="" />
      <input type="hidden" name="callbackUrl" value={callbackUrl ?? '/'} />
      <p ref={statusRef} style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)' }} role="status" />
    </form>
  );
}
