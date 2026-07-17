'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { parseWalkthroughAction, applyWalkthroughAction } from './onboarding-actions';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { captureColumn, isHighStakesColumn } from '@/lib/property-capture-catalog';
import type { CaptureItem } from '@/lib/property-capture-catalog';
import type { WalkthroughProposal } from '@/lib/ai/property-walkthrough';
import type { RoomType } from '@/lib/property-rooms-shared';

/**
 * Walk-the-house dictation for onboarding. The operator narrates a full
 * walkthrough room by room; Helm segments it into rooms and routes every
 * fragment to a room record, a structured field, or a property note. The
 * review screen groups the proposal by room; nothing writes until approved.
 *
 * Voice mechanics mirror QuickCapture (continuous SpeechRecognition with
 * the #1089 keep-alive restart) because a walkthrough runs many minutes.
 */

type Phase = 'input' | 'review' | 'done';

type ReviewRoomItem = {
  _id: number;
  include: boolean;
  roomName: string;
  kind: 'bed' | 'tv' | 'amenity' | 'quirk' | 'note';
  value: string;
  guestFacing: boolean;
  confidence: 'high' | 'medium' | 'low';
};

type ReviewCaptureItem = CaptureItem & { _id: number; include: boolean };

export function WalkthroughCapture({ propertyId, propertyName }: { propertyId: string; propertyName: string }) {
  const softRefresh = useSoftRefresh();
  const [phase, setPhase] = useState<Phase>('input');
  const [text, setText] = useState('');
  const [rooms, setRooms] = useState<{ name: string; roomType: RoomType }[]>([]);
  const [roomItems, setRoomItems] = useState<ReviewRoomItem[]>([]);
  const [captureItems, setCaptureItems] = useState<ReviewCaptureItem[]>([]);
  const [unrouted, setUnrouted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneSummary, setDoneSummary] = useState<{ rooms: number; roomFacts: number; columns: number; notes: number } | null>(null);
  const [pending, start] = useTransition();

  // ── Voice (QuickCapture's keep-alive pattern) ──
  const [listening, setListening] = useState(false);
  const [voiceOk, setVoiceOk] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);
  const baseTextRef = useRef('');
  const wantRef = useRef(false);
  const textRef = useRef('');
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  textRef.current = text;

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVoiceOk(true);
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let chunk = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        chunk += e.results[i][0].transcript;
      }
      const joined = (baseTextRef.current + ' ' + chunk).replace(/\s+/g, ' ').trimStart();
      setText(joined);
    };
    rec.onend = () => {
      if (wantRef.current) {
        restartTimerRef.current = setTimeout(() => {
          if (!wantRef.current) return;
          baseTextRef.current = textRef.current.trim();
          try {
            rec.start();
          } catch {
            wantRef.current = false;
            setListening(false);
            setError('Dictation stopped unexpectedly. Tap the mic to resume.');
          }
        }, 150);
        return;
      }
      setListening(false);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (e: any) => {
      const code = e?.error;
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        wantRef.current = false;
        setListening(false);
        setError('Microphone access was blocked. Allow mic access, then try again.');
      } else if (code === 'audio-capture') {
        wantRef.current = false;
        setListening(false);
        setError('No microphone found.');
      }
      // 'no-speech' / 'aborted' fall through to onend, which restarts while wanted.
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
    if (listening) { stopListening(); return; }
    baseTextRef.current = text.trim();
    setError(null);
    try {
      wantRef.current = true;
      rec.start();
      setListening(true);
    } catch {
      wantRef.current = false;
      setError('Could not start dictation.');
      setListening(false);
    }
  }

  function process() {
    stopListening();
    setError(null);
    start(async () => {
      const res = await parseWalkthroughAction(propertyId, propertyName, text);
      if (!res.ok) { setError(res.error); return; }
      const p: WalkthroughProposal = res.proposal;
      if (p.rooms.length === 0 && p.columnItems.length === 0 && p.noteItems.length === 0) {
        setError('Nothing routable found. Try narrating room by room ("in the primary bedroom...").');
        return;
      }
      setRooms(p.rooms);
      setRoomItems(p.roomItems.map((it, i) => ({ _id: i, include: true, roomName: it.roomName, kind: it.kind, value: it.value, guestFacing: it.guestFacing, confidence: it.confidence })));
      let id = 0;
      const cap: ReviewCaptureItem[] = [
        ...p.columnItems.map((c) => ({
          // High-stakes entry fields are never pre-checked: a mis-heard
          // dictated door code must not become the entry instruction a
          // cleaner follows on one bulk click. Same opt-in rule as
          // QuickCapture.
          _id: id++, include: !isHighStakesColumn(c.column),
          target: 'column' as const, column: c.column, value: c.value,
          noteTitle: null, noteBody: null, noteTag: null, guestFacing: false,
          sourceText: c.sourceText, confidence: c.confidence,
        })),
        ...p.noteItems.map((n) => ({
          _id: id++, include: true,
          target: 'note' as const, column: null, value: null,
          noteTitle: n.noteTitle, noteBody: n.noteBody, noteTag: n.noteTag, guestFacing: n.guestFacing,
          sourceText: n.sourceText, confidence: n.confidence,
        })),
      ];
      setCaptureItems(cap);
      setUnrouted(p.unrouted);
      setPhase('review');
    });
  }

  function apply() {
    setError(null);
    start(async () => {
      const inclRoomItems = roomItems.filter((i) => i.include);
      const inclCapture = captureItems.filter((i) => i.include).map(({ _id, include, ...rest }) => { void _id; void include; return rest; });
      const usedRooms = rooms.filter((r) => inclRoomItems.some((i) => i.roomName === r.name));
      if (inclRoomItems.length === 0 && inclCapture.length === 0) { setError('Nothing checked to apply.'); return; }
      const res = await applyWalkthroughAction({
        propertyId,
        rooms: usedRooms,
        roomItems: inclRoomItems.map(({ roomName, kind, value, guestFacing }) => ({ roomName, kind, value, guestFacing })),
        captureItems: inclCapture,
      });
      if (!res.ok) { setError(res.error); return; }
      setDoneSummary({ rooms: res.rooms, roomFacts: res.roomFacts, columns: res.columns, notes: res.notes });
      setPhase('done');
      softRefresh();
    });
  }

  function reset() {
    stopListening();
    setPhase('input');
    setText('');
    setRooms([]);
    setRoomItems([]);
    setCaptureItems([]);
    setUnrouted(null);
    setError(null);
    setDoneSummary(null);
    baseTextRef.current = '';
  }

  return (
    <div style={{ borderLeft: '3px solid var(--signal)', background: 'var(--paper-2)', padding: '14px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
        <div className="eyebrow" style={{ color: 'var(--signal)', letterSpacing: '.18em' }}>
          Walk the house
        </div>
        {phase !== 'input' && (
          <button type="button" onClick={reset} style={quietBtn}>Start over</button>
        )}
      </div>

      {phase === 'input' && (
        <>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.5, maxWidth: 720 }}>
            Narrate a full walkthrough, room by room: beds, TVs, quirks, codes, anything you see.
            Say where you are ("in the primary bedroom... now the main bath") and keep talking.
            Helm sorts every fact into rooms, fields, and notes; you review before anything saves.
          </p>
          <div style={{ position: 'relative' }}>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              aria-label="Walkthrough dictation"
              placeholder={'e.g. "Front door code is on the Schlage. In the living room the left lamp needs the switch on the cord. Primary bedroom upstairs, king bed, 55 inch Roku TV, closet on the right is the owner\'s and stays locked..."'}
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
                aria-pressed={listening}
                style={{
                  position: 'absolute', top: 8, right: 8, width: 36, height: 36, borderRadius: '50%',
                  border: `1px solid ${listening ? 'var(--signal)' : 'var(--rule)'}`,
                  background: listening ? 'var(--signal)' : 'var(--paper)',
                  color: listening ? 'var(--paper)' : 'var(--ink-3)',
                  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10 }}>
            <button
              type="button"
              onClick={process}
              disabled={pending || text.trim().length < 10}
              style={{ ...primaryBtn, opacity: pending || text.trim().length < 10 ? 0.6 : 1, cursor: pending ? 'wait' : 'pointer' }}
            >
              {pending ? 'Sorting the house…' : 'Sort it into rooms'}
            </button>
            <span role="status" aria-live="polite" style={{ fontSize: 12, color: 'var(--signal)', letterSpacing: '.04em' }}>
              {listening ? 'Listening… keep walking' : ''}
            </span>
          </div>
        </>
      )}

      {phase === 'review' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)' }}>
            Uncheck anything wrong, then apply. Room facts merge into the room cards below;
            fields and notes flow through the same guarded path as Quick Capture.
          </p>
          {rooms.map((room) => {
            const items = roomItems.filter((i) => i.roomName === room.name);
            if (items.length === 0) return null;
            return (
              <div key={room.name} style={{ border: '1px solid var(--rule)', background: 'var(--paper)', padding: '10px 14px' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
                  {room.name} <span style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '.1em' }}>{room.roomType}</span>
                </div>
                {items.map((it) => (
                  <label key={it._id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 0', fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={it.include}
                      onChange={() => setRoomItems((prev) => prev.map((p) => (p._id === it._id ? { ...p, include: !p.include } : p)))}
                      style={{ accentColor: 'var(--signal)' }}
                    />
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: it.kind === 'quirk' ? 'var(--signal)' : 'var(--ink-4)', width: 52, flexShrink: 0 }}>
                      {it.kind}
                    </span>
                    <span>{it.value}</span>
                    {it.guestFacing && <span style={{ fontSize: 9, color: 'var(--tide-deep)', textTransform: 'uppercase', letterSpacing: '.1em' }}>guest</span>}
                    {it.confidence === 'low' && <span style={{ fontSize: 9, color: 'var(--negative)', textTransform: 'uppercase', letterSpacing: '.1em' }}>check</span>}
                  </label>
                ))}
              </div>
            );
          })}
          {captureItems.length > 0 && (
            <div style={{ border: '1px solid var(--rule)', background: 'var(--paper)', padding: '10px 14px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>Whole-property</div>
              {captureItems.map((it) => (
                <label key={it._id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 0', fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={it.include}
                    onChange={() => setCaptureItems((prev) => prev.map((p) => (p._id === it._id ? { ...p, include: !p.include } : p)))}
                    style={{ accentColor: 'var(--signal)' }}
                  />
                  {it.target === 'column' ? (
                    <span>
                      <span style={{ fontSize: 11, color: 'var(--tide-deep)' }}>{captureColumn(it.column!)?.label ?? it.column}:</span>{' '}
                      {it.value}
                      {isHighStakesColumn(it.column) && (
                        <span style={{ display: 'block', fontSize: 10.5, color: 'var(--signal)', lineHeight: 1.4 }}>
                          Becomes the entry instruction cleaners and inspectors follow. Check it only if you are sure.
                        </span>
                      )}
                    </span>
                  ) : (
                    <span>
                      <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{it.guestFacing ? 'guest note' : 'ops note'}:</span>{' '}
                      {it.noteTitle}
                    </span>
                  )}
                  {it.confidence === 'low' && <span style={{ fontSize: 9, color: 'var(--negative)', textTransform: 'uppercase', letterSpacing: '.1em' }}>check</span>}
                </label>
              ))}
            </div>
          )}
          {unrouted && (
            <div style={{ borderLeft: '3px solid var(--ink-4)', padding: '8px 12px', fontSize: 12, color: 'var(--ink-3)', background: 'var(--paper)' }}>
              Could not route: &ldquo;{unrouted}&rdquo;
            </div>
          )}
          {error && <div style={{ fontSize: 12, color: 'var(--negative)' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button type="button" onClick={apply} disabled={pending} style={{ ...primaryBtn, opacity: pending ? 0.6 : 1, cursor: pending ? 'wait' : 'pointer' }}>
              {pending ? 'Applying…' : 'Apply to the property'}
            </button>
          </div>
        </div>
      )}

      {phase === 'done' && doneSummary && (
        <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
          Saved: {doneSummary.rooms} room{doneSummary.rooms === 1 ? '' : 's'} updated with {doneSummary.roomFacts} fact{doneSummary.roomFacts === 1 ? '' : 's'},
          {' '}{doneSummary.columns} field{doneSummary.columns === 1 ? '' : 's'}, {doneSummary.notes} note{doneSummary.notes === 1 ? '' : 's'}.
          {' '}
          <button type="button" onClick={reset} style={{ ...quietBtn, textDecoration: 'underline', textUnderlineOffset: 2 }}>
            Walk another area
          </button>
        </div>
      )}

      {phase === 'input' && error && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--negative)' }}>{error}</div>
      )}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: '1px solid var(--ink)',
  padding: '9px 16px',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
};

const quietBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  fontSize: 10,
  letterSpacing: '.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-4)',
  cursor: 'pointer',
  fontWeight: 500,
};
