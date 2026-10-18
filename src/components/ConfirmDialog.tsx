'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * One confirm style: the paper-and-ink modal the statements page already
 * used for its previews, in place of the browser's confirm(), prompt() and
 * alert(). Each question names the verb on its button, says what the action
 * does, and says "This cannot be undone." when that is true, instead of a
 * grey OK/Cancel box with a paragraph in it.
 *
 *   const { ask, askText, notify } = useConfirm();
 *   if (!(await ask({ title: 'Void this receipt?', confirmLabel: 'Void', tone: 'danger', irreversible: true }))) return;
 *
 * Mount <ConfirmProvider> once around the page. A component rendered with
 * no provider above it falls back to the native dialogs, so moving one onto
 * another page never strands an action behind a dialog that cannot open.
 */

export type AskOptions = {
  /** The question, e.g. "Remove this cancelled stay from the statement?" */
  title: string;
  /** What the action does, in a sentence or two. */
  body?: ReactNode;
  /** Items to weigh first (open flags, rows awaiting review). */
  list?: string[];
  /** The verb on the confirm button. */
  confirmLabel: string;
  cancelLabel?: string;
  /** 'danger' paints the confirm button red: removes, voids, overrides. */
  tone?: 'default' | 'danger';
  /** Adds "This cannot be undone." under the body. */
  irreversible?: boolean;
};

export type AskTextOptions = AskOptions & {
  inputLabel: string;
  placeholder?: string;
  /** Allow an empty answer (an optional note). */
  optional?: boolean;
};

export type NotifyOptions = {
  title: string;
  body?: ReactNode;
  list?: string[];
  tone?: 'default' | 'danger';
};

type Confirm = {
  ask: (o: AskOptions) => Promise<boolean>;
  /** Resolves to the typed text, or null when cancelled. */
  askText: (o: AskTextOptions) => Promise<string | null>;
  notify: (o: NotifyOptions) => Promise<void>;
};

type Pending =
  | { kind: 'ask'; o: AskOptions; resolve: (v: boolean) => void }
  | { kind: 'text'; o: AskTextOptions; resolve: (v: string | null) => void }
  | { kind: 'notify'; o: NotifyOptions; resolve: () => void };

function plain(node: ReactNode): string {
  return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
}

function nativeText(o: { title: string; body?: ReactNode; list?: string[]; irreversible?: boolean }): string {
  return [
    o.title,
    plain(o.body),
    (o.list || []).map(item => `  · ${item}`).join('\n'),
    o.irreversible ? 'This cannot be undone.' : '',
  ].filter(Boolean).join('\n\n');
}

/** Native dialogs, for a component rendered outside any provider. */
const NATIVE: Confirm = {
  ask: async (o) => confirm(nativeText(o)),
  askText: async (o) => prompt(nativeText(o)),
  notify: async (o) => { alert(nativeText(o)); },
};

const ConfirmContext = createContext<Confirm | null>(null);

export function useConfirm(): Confirm {
  return useContext(ConfirmContext) ?? NATIVE;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState('');
  // A second question while one is open answers the first with "no".
  const settle = useRef<(() => void) | null>(null);

  const open = useCallback((next: Pending) => {
    settle.current?.();
    settle.current = () => {
      if (next.kind === 'ask') next.resolve(false);
      else if (next.kind === 'text') next.resolve(null);
      else next.resolve();
    };
    setText('');
    setPending(next);
  }, []);

  const value = useMemo<Confirm>(() => ({
    ask: (o) => new Promise<boolean>(resolve => open({ kind: 'ask', o, resolve })),
    askText: (o) => new Promise<string | null>(resolve => open({ kind: 'text', o, resolve })),
    notify: (o) => new Promise<void>(resolve => open({ kind: 'notify', o, resolve })),
  }), [open]);

  const close = useCallback((answer: 'yes' | 'no') => {
    if (!pending) return;
    settle.current = null;
    if (pending.kind === 'ask') pending.resolve(answer === 'yes');
    else if (pending.kind === 'text') pending.resolve(answer === 'yes' ? text : null);
    else pending.resolve();
    setPending(null);
  }, [pending, text]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close('no'); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, close]);

  const o = pending?.o;
  const danger = o?.tone === 'danger';
  const textMissing = pending?.kind === 'text' && !pending.o.optional && !text.trim();

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending && o && (
        <div
          onClick={() => close('no')}
          style={{
            position: 'fixed', inset: 0, zIndex: 120,
            background: 'rgba(30, 46, 52, 0.35)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '96px 16px 40px', overflow: 'auto',
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="helm-confirm-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--paper)',
              border: '1px solid var(--ink)',
              width: '100%', maxWidth: 520,
              padding: 24,
              boxShadow: '0 30px 80px -20px rgba(30,46,52,.25), 0 8px 24px -8px rgba(30,46,52,.1)',
              fontFamily: 'var(--sans)',
            }}
          >
            <h2 id="helm-confirm-title" className="font-serif" style={{ fontSize: 20, fontWeight: 500, margin: 0, color: 'var(--ink)', lineHeight: 1.25 }}>
              {o.title}
            </h2>
            {o.body && (
              <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginTop: 10 }}>{o.body}</div>
            )}
            {o.list && o.list.length > 0 && (
              <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6 }}>
                {o.list.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            )}
            {pending.kind !== 'notify' && pending.o.irreversible && (
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--negative)', marginTop: 12 }}>This cannot be undone.</div>
            )}
            {pending.kind === 'text' && (
              <label style={{ display: 'block', marginTop: 14 }}>
                <span className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>{pending.o.inputLabel}</span>
                <textarea
                  autoFocus
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={pending.o.placeholder}
                  rows={3}
                  style={{
                    width: '100%', border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)',
                    padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', resize: 'vertical',
                  }}
                />
              </label>
            )}
            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
              {pending.kind !== 'notify' && (
                <button
                  type="button"
                  onClick={() => close('no')}
                  style={{
                    background: 'transparent', border: '1px solid var(--rule)', color: 'var(--ink-3)',
                    fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase',
                    padding: '10px 16px', cursor: 'pointer',
                  }}
                >
                  {pending.o.cancelLabel || 'Cancel'}
                </button>
              )}
              <button
                type="button"
                autoFocus={pending.kind !== 'text'}
                disabled={textMissing}
                onClick={() => close('yes')}
                style={{
                  background: danger ? 'var(--negative)' : 'var(--ink)',
                  border: `1px solid ${danger ? 'var(--negative)' : 'var(--ink)'}`,
                  color: 'var(--paper)',
                  fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase',
                  padding: '10px 18px', cursor: textMissing ? 'not-allowed' : 'pointer',
                  opacity: textMissing ? 0.4 : 1,
                }}
              >
                {pending.kind === 'notify' ? 'OK' : pending.o.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
