'use client';

import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { UpdatePropertyState } from '@/app/properties/actions';

/**
 * Client wrapper around the property edit form. Two protections born
 * from repeated data loss (missing-migration save crash on 2026-06-12,
 * schema-cache silent drops on 2026-06-02):
 *
 * 1. DRAFTS. Every keystroke (debounced 400ms) snapshots the form into
 *    localStorage, keyed per property. If the page dies mid-edit — save
 *    crash, browser crash, accidental back — the next visit offers a
 *    one-click restore. The draft auto-deletes when it matches what the
 *    server already has (i.e. after a successful save), so the banner
 *    only appears when there are genuinely unsaved values.
 *
 * 2. INLINE ERRORS. The save action returns { error } via
 *    useActionState instead of throwing, so a failed save re-renders
 *    this same form — typed values intact — with a red banner, rather
 *    than Next's dead "server error" page.
 */
export function EditFormShell({
  action,
  propertyId,
  children,
}: {
  action: (prev: UpdatePropertyState, formData: FormData) => Promise<UpdatePropertyState>;
  propertyId: string;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const formRef = useRef<HTMLFormElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftKey = `helm-property-edit-draft:${propertyId}`;
  const [draftAt, setDraftAt] = useState<string | null>(null);

  /** Snapshot current form values into a plain {name: value} object. */
  const snapshot = useCallback((): Record<string, string> => {
    const form = formRef.current;
    const out: Record<string, string> = {};
    if (!form) return out;
    const fd = new FormData(form);
    for (const [k, v] of fd.entries()) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  }, []);

  const persistDraft = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(
          draftKey,
          JSON.stringify({ at: new Date().toISOString(), values: snapshot() }),
        );
      } catch {
        // localStorage full / unavailable — drafts are best-effort.
      }
    }, 400);
  }, [draftKey, snapshot]);

  // On mount: if a stored draft differs from what the server rendered,
  // offer restore. If it's identical (the usual case right after a
  // successful save), delete it silently so the banner never nags.
  useEffect(() => {
    // Deferred a tick so the banner state flip happens outside the
    // effect body proper (react-hooks/set-state-in-effect) and after
    // the server-rendered defaults have painted.
    const t = setTimeout(() => {
      try {
        const raw = localStorage.getItem(draftKey);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { at?: string; values?: Record<string, string> };
        const values = parsed.values ?? {};
        const current = snapshot();
        const differs = Object.entries(values).some(([k, v]) => (current[k] ?? '') !== v);
        if (!differs) {
          localStorage.removeItem(draftKey);
          return;
        }
        setDraftAt(parsed.at ?? null);
      } catch {
        localStorage.removeItem(draftKey);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [draftKey, snapshot]);

  const restoreDraft = useCallback(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const { values } = JSON.parse(raw) as { values?: Record<string, string> };
      const form = formRef.current;
      if (!form || !values) return;
      for (const [name, value] of Object.entries(values)) {
        const el = form.elements.namedItem(name);
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
          el.value = value;
        }
      }
      setDraftAt(null);
    } catch {
      // Corrupt draft — discard.
      localStorage.removeItem(draftKey);
      setDraftAt(null);
    }
  }, [draftKey]);

  const dismissDraft = useCallback(() => {
    localStorage.removeItem(draftKey);
    setDraftAt(null);
  }, [draftKey]);

  return (
    <form
      ref={formRef}
      action={formAction}
      onInput={persistDraft}
      className="max-w-[900px] mx-auto px-10"
      style={{ paddingBottom: 80, width: '100%', display: 'flex', flexDirection: 'column', gap: 36 }}
    >
      {draftAt && (
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 14,
            flexWrap: 'wrap',
            padding: '12px 16px',
            borderLeft: '3px solid var(--tide-deep)',
            background: 'var(--paper-2)',
            fontSize: 13,
            color: 'var(--ink)',
          }}
        >
          <span>
            Unsaved changes from {formatDraftTime(draftAt)} found for this property.
          </span>
          <button type="button" onClick={restoreDraft} style={bannerButtonStyle}>
            Restore
          </button>
          <button type="button" onClick={dismissDraft} style={{ ...bannerButtonStyle, color: 'var(--ink-4)', borderColor: 'var(--rule)' }}>
            Discard
          </button>
        </div>
      )}

      {children}

      <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {state.error && (
          <div
            style={{
              padding: '12px 16px',
              borderLeft: '3px solid var(--negative)',
              background: 'var(--paper-2)',
              fontSize: 13,
              color: 'var(--negative)',
              lineHeight: 1.5,
            }}
          >
            <strong>Save failed.</strong> {state.error}
            <span style={{ display: 'block', marginTop: 4, color: 'var(--ink-3)' }}>
              Your entries are still in the form (and drafted locally). Fix the issue and hit Save
              again — nothing is lost.
            </span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="submit"
            disabled={pending}
            style={{
              background: 'var(--ink)',
              color: 'var(--paper)',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              padding: '14px 28px',
              border: 'none',
              cursor: pending ? 'wait' : 'pointer',
              opacity: pending ? 0.7 : 1,
            }}
          >
            {pending ? 'Saving…' : 'Save changes'}
          </button>
          <Link
            href={`/properties/${propertyId}`}
            style={{
              fontSize: 11,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
              textDecoration: 'none',
              padding: '14px 14px',
            }}
          >
            Cancel
          </Link>
        </div>
      </div>
    </form>
  );
}

function formatDraftTime(iso: string): string {
  try {
    const d = new Date(iso);
    const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return 'earlier';
  }
}

const bannerButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--tide-deep)',
  color: 'var(--tide-deep)',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  padding: '5px 12px',
  cursor: 'pointer',
};
