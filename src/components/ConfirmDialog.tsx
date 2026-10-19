'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { typedWordMatches } from '@/lib/confirm-question';

/**
 * One confirm style: the paper-and-ink modal the statements page already
 * used for its previews, in place of the browser's confirm(), prompt() and
 * alert(). Each question names the verb on its button, says what the action
 * does, and says "This cannot be undone." when that is true, instead of a
 * grey OK/Cancel box with a paragraph in it.
 *
 *   const { ask, askText, choose, notify } = useConfirm();
 *   if (!(await ask({ title: 'Void this receipt?', confirmLabel: 'Void', tone: 'danger', irreversible: true }))) return;
 *
 * Replacing `if (!confirm(text)) return;` is one line:
 * `if (!(await ask({ ...askFromSentence(text), confirmLabel: 'Delete' }))) return;`
 *
 * <ConfirmProvider> is mounted once for the whole app, in Providers (the root
 * layout), so every page and every client component under it gets the modal.
 * A component rendered with no provider above it (the smoke fixtures bundle
 * components on their own) falls back to the native dialogs, so an action is
 * never stranded behind a dialog that cannot open.
 *
 * The modal traps focus while it is open (Tab and Shift+Tab cycle inside it),
 * Escape and a click on the backdrop cancel, and focus returns to whatever
 * opened it. `typeToConfirm` is the gate for the few actions that destroy a
 * lot at once: the confirm button stays off until the word is typed.
 *
 * `choose` is for a question with two real answers besides "never mind"
 * ("Replace all" or "Fill blanks only"): it resolves to the picked value, or
 * null on Cancel, Escape or the backdrop. Without a provider it falls back to
 * the old two-way native question: OK picks the first choice, Cancel the second.
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
  /**
   * The word to type before the confirm button wakes, for the most
   * destructive actions only (a mass cancel, a wipe). Case and surrounding
   * spaces are ignored.
   */
  typeToConfirm?: string;
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

export type ChooseOptions<T extends string = string> = {
  title: string;
  body?: ReactNode;
  list?: string[];
  /** The answers, most likely first: the first is the dark button. */
  choices: { value: T; label: string; tone?: 'default' | 'danger' }[];
  cancelLabel?: string;
};

type Confirm = {
  ask: (o: AskOptions) => Promise<boolean>;
  /** Resolves to the typed text, or null when cancelled. */
  askText: (o: AskTextOptions) => Promise<string | null>;
  /** Resolves to the picked choice's value, or null when cancelled. */
  choose: <T extends string>(o: ChooseOptions<T>) => Promise<T | null>;
  notify: (o: NotifyOptions) => Promise<void>;
};

type Pending =
  | { kind: 'ask'; o: AskOptions; resolve: (v: boolean) => void }
  | { kind: 'text'; o: AskTextOptions; resolve: (v: string | null) => void }
  | { kind: 'choose'; o: ChooseOptions; resolve: (v: string | null) => void }
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
  ask: async (o) => o.typeToConfirm
    ? typedWordMatches(prompt(`${nativeText(o)}\n\nType ${o.typeToConfirm} to confirm.`), o.typeToConfirm)
    : confirm(nativeText(o)),
  askText: async (o) => prompt(nativeText(o)),
  choose: async (o) => (confirm(nativeText(o)) ? o.choices[0]?.value : o.choices[1]?.value) ?? null,
  notify: async (o) => { alert(nativeText(o)); },
};

const ConfirmContext = createContext<Confirm | null>(null);

export function useConfirm(): Confirm {
  return useContext(ConfirmContext) ?? NATIVE;
}

/**
 * A submit button's onClick that asks first: the click is held, and a yes
 * resubmits the form with the same button as submitter, so its formAction
 * and name/value ride along exactly as a plain click's.
 *
 *   <button type="submit" onClick={(e) => askThenSubmit(e, ask, { title: 'Resend?', confirmLabel: 'Resend' })}>
 */
export async function askThenSubmit(
  e: ReactMouseEvent<HTMLButtonElement>,
  ask: Confirm['ask'],
  question: AskOptions,
): Promise<void> {
  const button = e.currentTarget;
  const form = button.form;
  if (!form) return;
  e.preventDefault();
  if ((await ask(question)) && button.isConnected && !button.disabled) form.requestSubmit(button);
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState('');
  const [typed, setTyped] = useState('');
  const dialog = useRef<HTMLDivElement | null>(null);
  // Whatever had focus when the question opened gets it back on close.
  const opener = useRef<HTMLElement | null>(null);
  // A second question while one is open answers the first with "no".
  const settle = useRef<(() => void) | null>(null);

  const open = useCallback((next: Pending) => {
    if (!settle.current) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    settle.current?.();
    settle.current = () => {
      if (next.kind === 'ask') next.resolve(false);
      else if (next.kind === 'text' || next.kind === 'choose') next.resolve(null);
      else next.resolve();
    };
    // Outside the caller's transition: React 19 holds an async transition's
    // state updates until its action finishes, so a question asked from
    // inside startTransition(async () => { await ask(...) }) would never
    // open and the action would wait on it forever. A microtask runs after
    // startTransition has handed back its scope.
    queueMicrotask(() => {
      setText('');
      setTyped('');
      setPending(next);
    });
  }, []);

  const value = useMemo<Confirm>(() => ({
    ask: (o) => new Promise<boolean>(resolve => open({ kind: 'ask', o, resolve })),
    askText: (o) => new Promise<string | null>(resolve => open({ kind: 'text', o, resolve })),
    choose: <T extends string>(o: ChooseOptions<T>) =>
      new Promise<T | null>(resolve => open({ kind: 'choose', o, resolve: (v) => resolve(v as T | null) })),
    notify: (o) => new Promise<void>(resolve => open({ kind: 'notify', o, resolve })),
  }), [open]);

  const gate = pending && (pending.kind === 'ask' || pending.kind === 'text') ? pending.o.typeToConfirm : undefined;
  const textMissing = pending?.kind === 'text' && !pending.o.optional && !text.trim();
  const gateShut = !!gate && !typedWordMatches(typed, gate);
  const blocked = textMissing || gateShut;

  const close = useCallback((answer: 'yes' | 'no', choice?: string) => {
    if (!pending) return;
    if (answer === 'yes' && blocked) return;
    settle.current = null;
    if (pending.kind === 'ask') pending.resolve(answer === 'yes');
    else if (pending.kind === 'text') pending.resolve(answer === 'yes' ? text : null);
    else if (pending.kind === 'choose') pending.resolve(answer === 'yes' ? choice ?? null : null);
    else pending.resolve();
    setPending(null);
    const back = opener.current;
    opener.current = null;
    // After the modal unmounts, so focus does not land on a node being removed.
    if (back) setTimeout(() => { if (back.isConnected) back.focus({ preventScroll: true }); }, 0);
  }, [pending, text, blocked]);

  // Capture phase, and stopped there: an Escape meant for the question must
  // not also close the editor or modal it was asked from.
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close('no');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pending, close]);

  // The page behind stays put while a question is open.
  const isOpen = !!pending;
  useEffect(() => {
    if (!isOpen) return;
    const prior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prior; };
  }, [isOpen]);

  // Focus trap: Tab and Shift+Tab cycle inside the dialog.
  const trap = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !dialog.current) return;
    const items = Array.from(dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !dialog.current.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !dialog.current.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  const o = pending?.o;
  const danger = !!o && 'tone' in o && o.tone === 'danger';

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending && o && (
        <div
          onClick={() => close('no')}
          style={{
            // Above every other modal in Helm (the highest is 1000), since a
            // question is often asked from inside one.
            position: 'fixed', inset: 0, zIndex: 2000,
            background: 'rgba(30, 46, 52, 0.35)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '96px 16px 40px', overflow: 'auto',
          }}
        >
          <div
            ref={dialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="helm-confirm-title"
            aria-describedby={o.body || (o.list && o.list.length > 0) ? 'helm-confirm-body' : undefined}
            data-helm-confirm=""
            onClick={(e) => e.stopPropagation()}
            onKeyDown={trap}
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
            {(o.body || (o.list && o.list.length > 0)) && (
              <div id="helm-confirm-body">
                {o.body && (
                  <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginTop: 10 }}>{o.body}</div>
                )}
                {o.list && o.list.length > 0 && (
                  <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6 }}>
                    {o.list.map((item, i) => <li key={i}>{item}</li>)}
                  </ul>
                )}
              </div>
            )}
            {(pending.kind === 'ask' || pending.kind === 'text') && pending.o.irreversible && (
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
            {gate && (
              <label style={{ display: 'block', marginTop: 14 }}>
                <span className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>
                  Type <span style={{ fontFamily: 'var(--mono, monospace)', color: 'var(--ink)' }}>{gate}</span> to confirm
                </span>
                <input
                  autoFocus={pending.kind !== 'text'}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); close('yes'); } }}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-label={`Type ${gate} to confirm`}
                  style={{
                    width: '100%', border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)',
                    padding: '8px 10px', fontSize: 14, fontFamily: 'inherit', minHeight: 40,
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
                    padding: '10px 16px', minHeight: 40, cursor: 'pointer',
                  }}
                >
                  {pending.o.cancelLabel || 'Cancel'}
                </button>
              )}
              {pending.kind === 'choose' ? (
                [...pending.o.choices].reverse().map((c, i, all) => {
                  const primary = i === all.length - 1;
                  const red = c.tone === 'danger';
                  return (
                    <button
                      key={c.value}
                      type="button"
                      autoFocus={primary}
                      onClick={() => close('yes', c.value)}
                      style={{
                        background: primary ? (red ? 'var(--negative)' : 'var(--ink)') : 'transparent',
                        border: `1px solid ${red ? 'var(--negative)' : 'var(--ink)'}`,
                        color: primary ? 'var(--paper)' : red ? 'var(--negative)' : 'var(--ink)',
                        fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase',
                        padding: '10px 18px', minHeight: 40, cursor: 'pointer',
                      }}
                    >
                      {c.label}
                    </button>
                  );
                })
              ) : (
                <button
                  type="button"
                  autoFocus={pending.kind !== 'text' && !gate}
                  disabled={blocked}
                  onClick={() => close('yes')}
                  style={{
                    background: danger ? 'var(--negative)' : 'var(--ink)',
                    border: `1px solid ${danger ? 'var(--negative)' : 'var(--ink)'}`,
                    color: 'var(--paper)',
                    fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase',
                    padding: '10px 18px', minHeight: 40, cursor: blocked ? 'not-allowed' : 'pointer',
                    opacity: blocked ? 0.4 : 1,
                  }}
                >
                  {pending.kind === 'notify' ? 'OK' : pending.o.confirmLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
