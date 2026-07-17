'use client';

import { useRef, useState, useTransition, useEffect } from 'react';
import {
  parsePropertyCaptureAction,
  applyPropertyCaptureAction,
} from '@/app/properties/actions';
import { captureColumn, isHighStakesColumn, type CaptureItem } from '@/lib/property-capture-catalog';
import { useSoftRefresh } from '@/lib/use-soft-refresh';

/**
 * Quick Capture — the top of the Overview tab. Type or dictate a free-form
 * note; Helm (Claude) routes each fragment to a structured property field,
 * a guest-facing note, or an internal-ops note. Nothing writes until the
 * operator reviews + approves the proposal.
 *
 * Voice uses the browser SpeechRecognition API (zero infra; Chrome/Safari).
 * When unsupported the mic hides and typing carries the feature.
 */

type EditItem = CaptureItem & { include: boolean; _id: number };

type Phase = 'input' | 'review' | 'done';

export function QuickCapture({ propertyId, propertyName }: { propertyId: string; propertyName: string }) {
  const softRefresh = useSoftRefresh();
  const [phase, setPhase] = useState<Phase>('input');
  const [text, setText] = useState('');
  const [items, setItems] = useState<EditItem[]>([]);
  const [unrouted, setUnrouted] = useState<string | null>(null);
  const [current, setCurrent] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [doneSummary, setDoneSummary] = useState<{ columns: number; notes: number; skipped: string[] } | null>(null);
  const [pending, start] = useTransition();

  // ── Voice ──
  //
  // The browser ends a SpeechRecognition session on its own — after a pause
  // in speech, after a network hiccup, sometimes right after one utterance,
  // even with continuous=true. Dictation must feel like "mic on until I turn
  // it off", so sessions are treated as disposable: the transcript is OWNED
  // here, split into three layers, and every session end auto-restarts while
  // the operator still wants the mic.
  //
  //   baseTextRef   whatever was typed/present when the mic went on (or the
  //                 operator hand-edited mid-dictation — that folds the whole
  //                 composite back into base).
  //   finalsRef     speech the engine FINALIZED, accumulated across every
  //                 restarted session since mic-on. Never re-derived from the
  //                 textarea, so a restart can never drop committed words.
  //   interim       the current session's not-yet-final tail, display-only;
  //                 promoted into finalsRef when a session ends so a timeout
  //                 mid-phrase doesn't swallow the phrase.
  //
  // Restarts are attempted immediately, then on a small backoff ladder if
  // start() throws (the engine can briefly report "already started"). A
  // session that keeps dying instantly with no results (mic hardware or
  // speech-service failure loop) trips the rapid-end guard and stops with a
  // clear message instead of spinning silently. console.debug breadcrumbs
  // ([qc-mic]) narrate the lifecycle for remote diagnosis.
  const [listening, setListening] = useState(false);
  const [voiceOk, setVoiceOk] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);
  const baseTextRef = useRef('');
  const finalsRef = useRef('');
  // Current session's not-yet-final tail. Kept in a ref, written
  // synchronously in onresult BEFORE setText, so the onend promotion never
  // races React's render for the freshest words.
  const interimRef = useRef('');
  const wantRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartAttemptRef = useRef(0);
  const lastStartAtRef = useRef(0);
  const rapidEndsRef = useRef(0);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    // Client-only feature detection: deferring to the effect (rather than a
    // lazy initializer) keeps SSR and first client render in sync so the mic
    // button doesn't trigger a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVoiceOk(true);
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    const compose = (interim: string) =>
      [baseTextRef.current, finalsRef.current, interim].join(' ').replace(/\s+/g, ' ').trim();

    const giveUp = (message: string) => {
      wantRef.current = false;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      setListening(false);
      setError(message);
    };

    // Restart the session after the browser ends it. Immediate first try;
    // if start() throws (previous session still winding down), retry on a
    // short ladder before giving up.
    const RESTART_DELAYS_MS = [0, 150, 400, 1000];
    const scheduleRestart = () => {
      if (!wantRef.current) return;
      const attempt = restartAttemptRef.current;
      if (attempt >= RESTART_DELAYS_MS.length) {
        console.debug('[qc-mic] restart ladder exhausted');
        giveUp('Dictation keeps cutting out. What you said is kept — tap the mic to continue, or type the rest.');
        return;
      }
      restartTimerRef.current = setTimeout(() => {
        if (!wantRef.current) return;
        try {
          rec.start();
          console.debug('[qc-mic] restarted (attempt %d)', attempt);
        } catch (err) {
          console.debug('[qc-mic] restart start() threw (attempt %d): %s', attempt, String(err));
          restartAttemptRef.current = attempt + 1;
          scheduleRestart();
        }
      }, RESTART_DELAYS_MS[attempt]);
    };

    rec.onstart = () => {
      lastStartAtRef.current = Date.now();
      restartAttemptRef.current = 0;
      interimRef.current = '';
      console.debug('[qc-mic] session started');
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          finalsRef.current = (finalsRef.current + ' ' + r[0].transcript).trim();
        } else {
          interim += r[0].transcript;
        }
      }
      interimRef.current = interim;
      rapidEndsRef.current = 0; // the engine is genuinely hearing us
      setText(compose(interim));
    };

    // A session can end mid-phrase, before the engine finalizes the tail the
    // operator just spoke. Promote that tail into the committed finals so no
    // words are ever lost to a restart (or to tapping the mic off). Safe
    // against double-counting: when the engine DOES finalize, the onresult
    // that delivers the final also clears the interim it came from.
    const promoteInterim = () => {
      const tail = interimRef.current.trim();
      if (tail) {
        finalsRef.current = (finalsRef.current + ' ' + tail).trim();
        interimRef.current = '';
        setText(compose(''));
      }
    };

    rec.onend = () => {
      console.debug('[qc-mic] session ended (wanted=%s)', wantRef.current);
      promoteInterim();
      if (!wantRef.current) {
        setListening(false);
        return;
      }
      // A session that dies within a second of starting, repeatedly, with no
      // results in between is a failure loop (dead mic, speech service down),
      // not a silence timeout. Stop cleanly instead of spinning forever.
      if (Date.now() - lastStartAtRef.current < 1000) {
        rapidEndsRef.current += 1;
        if (rapidEndsRef.current >= 5) {
          console.debug('[qc-mic] rapid-end loop tripped');
          giveUp('Dictation keeps cutting out in this browser. What you said is kept — type the rest, or try again in a bit.');
          return;
        }
      }
      scheduleRestart();
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (e: any) => {
      const code = e?.error;
      console.debug('[qc-mic] error: %s (wanted=%s)', code, wantRef.current);
      // 'aborted' fires when we call stop() ourselves — not a real error.
      if (code === 'aborted') return;
      // While the mic is wanted, quiet stretches and transient service blips
      // ('no-speech', 'network') are the restart loop's job — onend follows
      // every one of them, and the rapid-end guard catches a hard loop. Only
      // genuinely fatal conditions stop the session and say something.
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        giveUp('Microphone access was blocked. Allow mic access in your browser, then try again.');
        return;
      }
      if (code === 'audio-capture') {
        giveUp('No microphone found. Plug one in, or type instead.');
        return;
      }
      if (!wantRef.current) {
        if (code === 'no-speech') setError('Didn’t catch anything — try again, or type instead.');
        else if (code) setError('Dictation stopped unexpectedly. Try again, or type instead.');
      }
    };

    recRef.current = rec;
    return () => {
      wantRef.current = false;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      try { rec.stop(); } catch { /* noop */ }
    };
  }, []);

  function stopListening() {
    wantRef.current = false;
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    const rec = recRef.current;
    if (rec) { try { rec.stop(); } catch { /* noop */ } }
    setListening(false);
  }

  function toggleMic() {
    const rec = recRef.current;
    if (!rec) return;
    if (listening) {
      stopListening();
      return;
    }
    // Fresh take: current textarea content is the typed base; the spoken
    // layers start empty. All counters reset.
    baseTextRef.current = text.trim();
    finalsRef.current = '';
    restartAttemptRef.current = 0;
    rapidEndsRef.current = 0;
    setError(null);
    try {
      wantRef.current = true;
      rec.start();
      setListening(true);
    } catch {
      wantRef.current = false;
      setError('Could not start dictation. Try again, or type instead.');
      setListening(false);
    }
  }

  /** Hand-edit while the mic is live: the edited text becomes the new base
   *  and the spoken layers reset, so the next result can't resurrect the
   *  pre-edit transcript over her correction. */
  function handleTextEdit(value: string) {
    if (listening || wantRef.current) {
      baseTextRef.current = value;
      finalsRef.current = '';
      interimRef.current = '';
    }
    setText(value);
  }

  function process() {
    // The mic control is unmounted on the review screen, so stop capture
    // before leaving the input phase — never leave the device open with no
    // affordance to turn it off.
    stopListening();
    setError(null);
    start(async () => {
      const res = await parsePropertyCaptureAction(propertyId, text);
      if (!res.ok) { setError(res.error); return; }
      if (res.proposal.items.length === 0 && !res.proposal.unrouted) {
        setError('Nothing actionable found in that note. Try being more specific.');
        return;
      }
      // High-stakes entry/access fields (key/lockbox location, codes, guest
      // access) are NOT auto-checked: a wrong value here becomes the "how to
      // get in" a cleaner or inspector follows, so the operator must opt in.
      setItems(
        res.proposal.items.map((it, i) => ({
          ...it,
          include: !(it.target === 'column' && isHighStakesColumn(it.column)),
          _id: i,
        })),
      );
      setUnrouted(res.proposal.unrouted);
      setCurrent(res.currentValues);
      setPhase('review');
    });
  }

  function patchItem(id: number, patch: Partial<EditItem>) {
    setItems((prev) => prev.map((it) => (it._id === id ? { ...it, ...patch } : it)));
  }

  function addUnroutedAsNote() {
    if (!unrouted) return;
    setItems((prev) => [
      ...prev,
      {
        _id: (prev.at(-1)?._id ?? -1) + 1,
        include: true,
        target: 'note',
        column: null,
        value: null,
        noteTitle: unrouted.slice(0, 80),
        noteBody: unrouted,
        noteTag: null,
        guestFacing: false,
        sourceText: unrouted,
        confidence: 'low',
      },
    ]);
    setUnrouted(null);
  }

  function apply() {
    setError(null);
    const included: CaptureItem[] = items
      .filter((i) => i.include)
      .map(({ include, _id, ...rest }) => { void include; void _id; return rest; });
    if (included.length === 0) { setError('Nothing checked to apply.'); return; }
    start(async () => {
      const res = await applyPropertyCaptureAction(propertyId, included);
      if (!res.ok) { setError(res.error); return; }
      setDoneSummary({ columns: res.columns, notes: res.notes, skipped: res.skipped });
      setPhase('done');
      softRefresh();
    });
  }

  function reset() {
    stopListening();
    setPhase('input');
    setText('');
    setItems([]);
    setUnrouted(null);
    setCurrent({});
    setError(null);
    setDoneSummary(null);
    baseTextRef.current = '';
    finalsRef.current = '';
    interimRef.current = '';
  }

  const includedCount = items.filter((i) => i.include).length;

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 22, paddingBottom: 32, width: '100%' }}>
      {/* Left tide accent instead of a full boxed plate: the capture bar
          should read as the tab's first affordance, not a billboard that
          pushes the day's actual work below the fold. */}
      <div
        style={{
          borderLeft: '3px solid var(--tide-deep)',
          background: 'var(--paper-2)',
          padding: '14px 18px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
          <div className="eyebrow" style={{ color: 'var(--tide-deep)', letterSpacing: '.18em' }}>
            Quick capture
          </div>
          {phase !== 'input' && (
            <button type="button" onClick={reset} style={ghostBtn}>
              Start over
            </button>
          )}
        </div>

        {phase === 'input' && (
          <>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.5, maxWidth: 720 }}>
              Type or dictate anything about {propertyName} — codes, quirks, a thing to tell guests.
              Helm sorts it; you review before anything saves.
            </p>
            <div style={{ position: 'relative' }}>
              <textarea
                value={text}
                onChange={(e) => handleTextEdit(e.target.value)}
                rows={2}
                aria-label="Quick capture note"
                placeholder={'e.g. "Gate code is 4455, trash goes out Tuesdays, and the downstairs shower runs hot for a minute so let guests know."'}
                style={{
                  width: '100%',
                  border: '1px solid var(--rule)',
                  borderBottom: '1px solid var(--ink)',
                  background: 'var(--paper)',
                  color: 'var(--ink)',
                  fontSize: 14,
                  lineHeight: 1.5,
                  padding: '11px 12px',
                  paddingRight: voiceOk ? 52 : 12,
                  outline: 'none',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              />
              {voiceOk && (
                <button
                  type="button"
                  onClick={toggleMic}
                  title={listening ? 'Stop dictation' : 'Dictate'}
                  aria-label={listening ? 'Stop dictation' : 'Dictate'}
                  aria-pressed={listening}
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    border: `1px solid ${listening ? 'var(--signal)' : 'var(--rule)'}`,
                    background: listening ? 'var(--signal)' : 'var(--paper)',
                    color: listening ? 'var(--paper)' : 'var(--ink-3)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    animation: listening ? 'rtpulse 1.3s ease-in-out infinite' : 'none',
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <rect x="9" y="2" width="6" height="12" rx="3" />
                    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12 }}>
              <button
                type="button"
                onClick={process}
                disabled={pending || !text.trim()}
                style={{ ...primaryBtn, opacity: pending || !text.trim() ? 0.6 : 1, cursor: pending ? 'wait' : 'pointer' }}
              >
                {pending ? 'Sorting…' : 'Process with Helm'}
              </button>
              <span role="status" aria-live="polite" style={{ fontSize: 12, color: 'var(--signal)', letterSpacing: '.04em' }}>
                {listening ? 'Listening…' : ''}
              </span>
              {!voiceOk && (
                <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>Voice not supported here — type instead.</span>
              )}
            </div>
          </>
        )}

        {phase === 'review' && (
          <>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55 }}>
              Here&rsquo;s how Helm sorted it. Edit anything, uncheck what you don&rsquo;t want, then apply.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {items.map((it) => (
                <ItemCard
                  key={it._id}
                  item={it}
                  currentValue={it.column ? current[it.column] ?? null : null}
                  onPatch={(p) => patchItem(it._id, p)}
                />
              ))}
            </div>

            {unrouted && (
              <div
                role="status"
                style={{
                  marginTop: 12,
                  padding: '10px 14px',
                  borderLeft: '3px solid var(--ink-4)',
                  background: 'var(--paper)',
                  fontSize: 12,
                  color: 'var(--ink-3)',
                  lineHeight: 1.5,
                }}
              >
                Couldn&rsquo;t place: &ldquo;{unrouted}&rdquo;{' '}
                <button type="button" onClick={addUnroutedAsNote} style={{ ...linkBtn, marginLeft: 6 }}>
                  Add as internal note
                </button>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 16 }}>
              <button
                type="button"
                onClick={apply}
                disabled={pending || includedCount === 0}
                style={{ ...primaryBtn, opacity: pending || includedCount === 0 ? 0.6 : 1, cursor: pending ? 'wait' : 'pointer' }}
              >
                {pending ? 'Saving…' : `Apply ${includedCount} change${includedCount === 1 ? '' : 's'}`}
              </button>
              <button type="button" onClick={() => setPhase('input')} style={linkBtn}>
                Back to edit
              </button>
            </div>
          </>
        )}

        {phase === 'done' && doneSummary && (
          <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, color: 'var(--ink)' }}>
                <span style={{ color: 'var(--positive)', fontWeight: 600 }}>Filed.</span>{' '}
                {doneSummary.columns > 0 && `${doneSummary.columns} field${doneSummary.columns === 1 ? '' : 's'} updated`}
                {doneSummary.columns > 0 && doneSummary.notes > 0 && ', '}
                {doneSummary.notes > 0 && `${doneSummary.notes} note${doneSummary.notes === 1 ? '' : 's'} added`}.
              </span>
              <button type="button" onClick={reset} style={linkBtn}>
                Capture another
              </button>
            </div>
            {doneSummary.skipped.length > 0 && (
              <span style={{ fontSize: 12, color: 'var(--signal)', lineHeight: 1.5 }}>
                Couldn’t read a value for {doneSummary.skipped.join(', ')} — left unchanged.
              </span>
            )}
          </div>
        )}

        {error && (
          <div
            role="alert"
            style={{
              marginTop: 12,
              padding: '10px 14px',
              borderLeft: '3px solid var(--negative)',
              background: 'var(--paper)',
              fontSize: 13,
              color: 'var(--negative)',
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}
      </div>
      <style>{`@keyframes rtpulse { 0%,100% { box-shadow: 0 0 0 0 rgba(200,90,58,0.5); } 50% { box-shadow: 0 0 0 6px rgba(200,90,58,0); } }`}</style>
    </section>
  );
}

function ItemCard({
  item,
  currentValue,
  onPatch,
}: {
  item: EditItem;
  currentValue: string | null;
  onPatch: (p: Partial<EditItem>) => void;
}) {
  const col = item.target === 'column' && item.column ? captureColumn(item.column) : undefined;
  const dot =
    item.confidence === 'high' ? 'var(--positive)' : item.confidence === 'medium' ? 'var(--tide-deep)' : 'var(--ink-4)';
  const destChip =
    item.target === 'column'
      ? col
        ? `${col.section} · ${col.label}`
        : 'Field'
      : item.guestFacing
        ? 'Guest note'
        : 'Internal note';
  const chipColor = item.target === 'column' ? 'var(--ink)' : item.guestFacing ? 'var(--tide-deep)' : 'var(--ink-3)';

  return (
    <div
      style={{
        border: '1px solid var(--rule)',
        background: item.include ? 'var(--paper)' : 'var(--paper-2)',
        opacity: item.include ? 1 : 0.6,
        padding: '12px 14px',
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
      }}
    >
      <input
        type="checkbox"
        checked={item.include}
        onChange={(e) => onPatch({ include: e.target.checked })}
        style={{ marginTop: 4, accentColor: 'var(--tide-deep)', width: 15, height: 15, flexShrink: 0 }}
        aria-label={`Include ${destChip}${item.value ? `: ${item.value}` : item.noteTitle ? `: ${item.noteTitle}` : ''}`}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} title={`${item.confidence} confidence`} />
          <span
            style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase',
              color: chipColor, border: `1px solid ${chipColor}`, padding: '2px 8px', whiteSpace: 'nowrap',
            }}
          >
            {destChip}
          </span>
          {item.target === 'note' && (
            <ToggleGuest guestFacing={item.guestFacing} onChange={(g) => onPatch({ guestFacing: g })} />
          )}
        </div>

        {item.target === 'column' ? (
          <>
            <input
              value={item.value ?? ''}
              onChange={(e) => onPatch({ value: e.target.value })}
              style={fieldInput}
            />
            {currentValue && (
              <div style={{ marginTop: 5, fontSize: 11, color: 'var(--signal)', letterSpacing: '.02em' }}>
                Replaces current value: <span className="font-mono">{currentValue}</span>
              </div>
            )}
            {isHighStakesColumn(item.column) && (
              <div
                style={{
                  marginTop: 6,
                  padding: '6px 9px',
                  borderLeft: '3px solid var(--signal)',
                  background: 'var(--paper-2)',
                  fontSize: 11,
                  color: 'var(--ink-3)',
                  lineHeight: 1.45,
                }}
              >
                Becomes the entry instruction cleaners and inspectors follow. Only apply if this is the main way in. If it is a spare or backup, make it a note instead.
              </div>
            )}
            <button
              type="button"
              onClick={() =>
                onPatch({
                  target: 'note',
                  column: null,
                  value: null,
                  noteTitle: col?.label ?? 'Captured note',
                  noteBody: item.value ?? item.sourceText ?? '',
                  noteTag: null,
                  guestFacing: false,
                  include: true,
                })
              }
              style={{
                marginTop: 6,
                background: 'none',
                border: 'none',
                padding: 0,
                fontSize: 11,
                color: 'var(--tide-deep)',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Make this a note instead
            </button>
          </>
        ) : (
          <>
            <input
              value={item.noteTitle ?? ''}
              onChange={(e) => onPatch({ noteTitle: e.target.value })}
              placeholder="Note title"
              style={{ ...fieldInput, fontWeight: 500 }}
            />
            <textarea
              value={item.noteBody ?? ''}
              onChange={(e) => onPatch({ noteBody: e.target.value })}
              placeholder="Detail"
              rows={2}
              style={{ ...fieldInput, marginTop: 6, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
            />
            <input
              value={item.noteTag ?? ''}
              onChange={(e) => onPatch({ noteTag: e.target.value })}
              placeholder="tag (optional) — hvac, plumbing, parking…"
              style={{ ...fieldInput, marginTop: 6, fontSize: 12 }}
            />
          </>
        )}

        <div style={{ marginTop: 7, fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic' }}>
          from: &ldquo;{item.sourceText}&rdquo;
        </div>
      </div>
    </div>
  );
}

function ToggleGuest({ guestFacing, onChange }: { guestFacing: boolean; onChange: (g: boolean) => void }) {
  return (
    <span
      role="group"
      aria-label="Note audience"
      title="Guest = added to the guest-messaging knowledge base. Internal = ops-only, your team sees it."
      style={{ display: 'inline-flex', border: '1px solid var(--rule)', overflow: 'hidden' }}
    >
      {([['Guest', true], ['Internal', false]] as const).map(([label, val]) => {
        const on = guestFacing === val;
        return (
          <button
            key={label}
            type="button"
            onClick={() => onChange(val)}
            aria-pressed={on}
            style={{
              fontSize: 9, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase',
              padding: '3px 9px', border: 'none', cursor: 'pointer',
              background: on ? (val ? 'var(--tide-deep)' : 'var(--ink-3)') : 'transparent',
              color: on ? 'var(--paper)' : 'var(--ink-4)',
            }}
          >
            {label}
          </button>
        );
      })}
    </span>
  );
}

const fieldInput: React.CSSProperties = {
  width: '100%',
  border: '1px solid var(--rule)',
  borderBottom: '1px solid var(--ink)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  fontSize: 14,
  padding: '8px 10px',
  outline: 'none',
  boxSizing: 'border-box',
};

const primaryBtn: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  color: 'var(--paper)',
  background: 'var(--ink)',
  border: '1px solid var(--ink)',
  padding: '9px 16px',
  fontWeight: 600,
};

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  fontSize: 10,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  color: 'var(--ink-4)',
  cursor: 'pointer',
  fontWeight: 500,
};

const linkBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  fontSize: 11,
  letterSpacing: '.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  cursor: 'pointer',
  fontWeight: 500,
  padding: 0,
};
