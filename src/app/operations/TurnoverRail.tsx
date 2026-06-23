'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { confirmCleaningDoneAction } from './cleaning-actions';

/**
 * The living lifecycle rail for one turnover: Checked out → Cleaner in →
 * Cleaning → Cleaned → Inspected → Guest-ready. Each node advances off a real
 * signal (lock keypad entry, Quo text / confirm, inspection). The stage we're
 * waiting on carries a pulsing coral halo and a live elapsed counter; an
 * estimated finish is a dashed node you tap to confirm. Motion respects
 * prefers-reduced-motion.
 */
type Props = {
  expected: boolean; // checkout has passed — cleaning is due
  enteredAt: string | null;
  cleanedAt: string | null;
  cleanedEstimated: boolean;
  cleanedSource: string | null;
  enteredViaLock: boolean;
  inspected: boolean;
  checkIn: string;
  previousCheckout: string | null;
  propertyId: string;
  sameDay: boolean;
};

type NodeCls = 'passed' | 'good' | 'active' | 'future' | 'est';

const MONO = 'var(--font-mono, monospace)';

function fmtElapsed(sinceIso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(sinceIso)) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? 'p' : 'a';
  h = h % 12 || 12;
  return m === 0 ? `${h}${ap}` : `${h}:${String(m).padStart(2, '0')}${ap}`;
}

function countdown(checkIn: string, now: number): { text: string; urgency: 'far' | 'soon' | 'now' } {
  const target = Date.parse(`${checkIn.slice(0, 10)}T16:00:00`);
  const ms = target - now;
  if (ms <= 0) return { text: 'now', urgency: 'now' };
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  if (h >= 36) return { text: `${Math.round(h / 24)}d`, urgency: 'far' };
  const m = totalMin % 60;
  return { text: `${h}h ${m}m`, urgency: h < 6 ? 'now' : h < 12 ? 'soon' : 'far' };
}

function LockGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" style={{ verticalAlign: '-1px', marginRight: 3 }} aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function PhoneGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ verticalAlign: '-1px', marginRight: 3 }} aria-hidden>
      <path d="M4 5c0 9 6 15 15 15v-4l-4-1-2 2a13 13 0 0 1-6-6l2-2-1-4z" />
    </svg>
  );
}

export function TurnoverRail(p: Props) {
  // "now" lives in state and updates on the interval, so render stays pure
  // (no Date.now() in the render body) while the counter + countdown breathe
  // between server refreshes. Lazy init keeps SSR + first paint correct.
  const [now, setNow] = useState(() => Date.now());
  const haloRef = useRef<HTMLSpanElement | null>(null);
  const [pending, start] = useTransition();
  const [justConfirmed, setJustConfirmed] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Slow breathe on the active node's halo, via the Web Animations API (no
  // global CSS), disabled under reduced-motion.
  useEffect(() => {
    const el = haloRef.current;
    if (!el) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const anim = el.animate([{ opacity: 0.5 }, { opacity: 0.05 }, { opacity: 0.5 }], {
      duration: 2000,
      iterations: Infinity,
      easing: 'ease-in-out',
    });
    return () => anim.cancel();
  });

  const checkedOut = p.expected;
  const cleanerIn = !!p.enteredAt;
  const cleaned = !!p.cleanedAt || justConfirmed;
  const inspected = p.inspected;
  const ready = cleaned && inspected;

  const cd = countdown(p.checkIn, now);
  // "Due" = the clean is genuinely imminent: a same-day turn, or check-in
  // within ~36h. A turnover that's days out stays calm — no pulsing "awaiting
  // cleaner" and no ticking counter, since the cleaner isn't due yet. A REAL
  // lock entry still lights up regardless (that's a fact, not a guess).
  const due = checkedOut && (p.sameDay || cd.urgency !== 'far');

  let active: 'in' | 'cleaning' | 'inspected' | null = null;
  if (!checkedOut) active = null;
  else if (!cleanerIn) active = due ? 'in' : null;
  else if (!cleaned) active = 'cleaning';
  else if (!inspected) active = due ? 'inspected' : null;

  // Live counter ONLY while the cleaner is actually in (real entry time).
  // Never on an awaiting node — a "time since checkout" duration there reads
  // as if the cleaner has already been inside that long.
  const counterSince = active === 'cleaning' ? p.enteredAt : null;

  const nodes: Array<{ key: string; label: string; cls: NodeCls; time?: string | null; glyph?: 'lock' | 'phone' | null }> = [
    { key: 'out', label: 'Checked out', cls: checkedOut ? 'passed' : 'future' },
    {
      key: 'in',
      label: cleanerIn ? 'Cleaner in' : active === 'in' ? 'Awaiting cleaner' : 'Cleaner in',
      cls: cleanerIn ? 'good' : active === 'in' ? 'active' : 'future',
      time: p.enteredAt,
      glyph: cleanerIn && p.enteredViaLock ? 'lock' : null,
    },
    { key: 'cleaning', label: 'Cleaning', cls: cleaned ? 'good' : active === 'cleaning' ? 'active' : 'future' },
    {
      key: 'cleaned',
      label: 'Cleaned',
      cls: cleaned ? (p.cleanedEstimated && !justConfirmed ? 'est' : 'good') : 'future',
      time: justConfirmed ? new Date(now).toISOString() : p.cleanedAt,
      glyph: cleaned && p.cleanedSource === 'quo' ? 'phone' : null,
    },
    { key: 'inspected', label: active === 'inspected' ? 'Inspecting' : 'Inspected', cls: inspected ? 'good' : active === 'inspected' ? 'active' : 'future' },
    { key: 'ready', label: 'Guest-ready', cls: ready ? 'good' : 'future' },
  ];

  const overdue = active !== null && Date.parse(`${p.checkIn.slice(0, 10)}T16:00:00`) < now;
  const hot = overdue ? 'var(--negative)' : 'var(--signal)';
  const cdColor = overdue || cd.urgency === 'now' ? 'var(--negative)' : cd.urgency === 'soon' ? 'var(--signal)' : 'var(--ink-4)';
  const cdTint = overdue || cd.urgency === 'now' ? 'rgba(200,90,58,.12)' : cd.urgency === 'soon' ? 'rgba(200,90,58,.09)' : 'transparent';
  const railHot = active !== null && (cd.urgency !== 'far' || p.sameDay);
  const baseColor = overdue ? 'rgba(200,90,58,.5)' : railHot ? 'rgba(200,90,58,.26)' : 'var(--rule)';
  const showEstConfirm = cleaned && p.cleanedEstimated && !justConfirmed;

  return (
    <div style={{ marginTop: 12, paddingLeft: 176, paddingRight: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: '.02em',
            color: cdColor,
            background: cdTint,
            padding: cdTint === 'transparent' ? 0 : '2px 9px',
            borderRadius: 999,
          }}
        >
          {overdue ? 'checking in now' : `checks in ${cd.text}`}
        </span>
      </div>

      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ position: 'absolute', top: 9, left: '5%', right: '5%', height: 2, background: baseColor, zIndex: 0 }} />
        {nodes.map((n) => {
          const isActive = n.cls === 'active';
          const solid = n.cls === 'good' ? 'var(--positive)' : n.cls === 'passed' ? 'var(--ink-3)' : null;
          const labelColor =
            isActive ? hot : n.cls === 'good' ? 'var(--positive)' : n.cls === 'passed' ? 'var(--ink-3)' : 'var(--ink-4)';
          const size = n.cls === 'future' ? 10 : isActive ? 16 : 14;
          return (
            <div
              key={n.key}
              style={{
                position: 'relative',
                zIndex: 1,
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 5,
                minWidth: 0,
              }}
            >
              <div style={{ position: 'relative', width: 22, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {isActive && (
                  <span
                    ref={haloRef}
                    aria-hidden
                    style={{ position: 'absolute', width: 22, height: 22, borderRadius: '50%', background: hot, opacity: 0.5 }}
                  />
                )}
                <span
                  style={{
                    position: 'relative',
                    width: size,
                    height: size,
                    borderRadius: '50%',
                    boxSizing: 'border-box',
                    background: isActive || n.cls === 'est' || n.cls === 'future' ? 'var(--paper)' : solid ?? 'var(--paper)',
                    border: isActive
                      ? `2.5px solid ${hot}`
                      : n.cls === 'est'
                        ? '2px dashed var(--positive)'
                        : n.cls === 'future'
                          ? '1.5px solid var(--rule)'
                          : `2px solid ${solid ?? 'var(--rule)'}`,
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: 11,
                  lineHeight: 1.2,
                  textAlign: 'center',
                  fontWeight: isActive ? 500 : 400,
                  color: labelColor,
                  whiteSpace: 'nowrap',
                }}
              >
                {n.glyph === 'lock' ? (
                  <span style={{ color: 'var(--positive)' }}>
                    <LockGlyph />
                  </span>
                ) : n.glyph === 'phone' ? (
                  <span style={{ color: 'var(--positive)' }}>
                    <PhoneGlyph />
                  </span>
                ) : null}
                {n.label}
              </span>
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  color: isActive ? hot : 'var(--ink-4)',
                  fontWeight: isActive ? 500 : 400,
                  minHeight: 12,
                }}
              >
                {isActive && counterSince ? fmtElapsed(counterSince, now) : n.time ? fmtTime(n.time) : ''}
              </span>
              {n.key === 'cleaned' && showEstConfirm && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await confirmCleaningDoneAction(p.propertyId, p.previousCheckout ?? '');
                      if (r.ok) setJustConfirmed(true);
                    })
                  }
                  style={{
                    fontSize: 10,
                    color: 'var(--signal)',
                    background: 'none',
                    border: 'none',
                    cursor: pending ? 'wait' : 'pointer',
                    padding: 0,
                    textDecoration: 'underline',
                    textUnderlineOffset: 2,
                  }}
                >
                  {pending ? '…' : 'confirm?'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
