'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { confirmCleaningDoneAction } from './cleaning-actions';

/**
 * The living lifecycle rail for one turnover: Checked out → Cleaner in →
 * Cleaning → Cleaned → Inspected → Guest-ready. Each node advances off a real
 * signal (lock keypad entry, Quo text / confirm, inspection). The stage we're
 * waiting on pulses and ticks a live elapsed counter; an estimated finish is a
 * dashed node you tap to confirm. Flat-editorial, motion respects
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
  if (ms <= 0) return { text: 'checking in', urgency: 'now' };
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  if (h >= 36) return { text: `in ${Math.round(h / 24)}d`, urgency: 'far' };
  const m = totalMin % 60;
  return { text: `in ${h}h ${m}m`, urgency: h < 6 ? 'now' : h < 12 ? 'soon' : 'far' };
}

export function TurnoverRail(p: Props) {
  // "now" lives in state and updates on the interval, so render stays pure
  // (no Date.now() in the render body) while the counter + countdown breathe
  // between server refreshes. Lazy init keeps SSR + first paint correct.
  const [now, setNow] = useState(() => Date.now());
  const activeRef = useRef<HTMLDivElement | null>(null);
  const [pending, start] = useTransition();
  const [justConfirmed, setJustConfirmed] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Slow pulse on the one active node, via the Web Animations API (no global
  // CSS), disabled under reduced-motion.
  useEffect(() => {
    const el = activeRef.current;
    if (!el) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const anim = el.animate([{ opacity: 1 }, { opacity: 0.4 }, { opacity: 1 }], {
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

  let active: 'in' | 'cleaning' | 'inspected' | null = null;
  if (checkedOut) {
    if (!cleanerIn) active = 'in';
    else if (!cleaned) active = 'cleaning';
    else if (!inspected) active = 'inspected';
  }

  const counterSince =
    active === 'in'
      ? p.previousCheckout
        ? `${p.previousCheckout}T11:00:00`
        : null
      : active === 'cleaning'
        ? p.enteredAt
        : null;

  const nodes: Array<{ key: string; label: string; cls: NodeCls; time?: string | null; glyph?: 'lock' | 'phone' | null }> = [
    { key: 'out', label: 'Checked out', cls: checkedOut ? 'passed' : 'future' },
    {
      key: 'in',
      label: 'Cleaner in',
      cls: cleanerIn ? 'good' : active === 'in' ? 'active' : 'future',
      time: p.enteredAt,
      glyph: cleanerIn && p.enteredViaLock ? 'lock' : null,
    },
    { key: 'cleaning', label: 'Cleaning', cls: cleaned ? 'good' : active === 'cleaning' ? 'active' : 'future' },
    {
      key: 'cleaned',
      label: 'Cleaned',
      cls: cleaned ? (p.cleanedEstimated && !justConfirmed ? 'est' : 'good') : 'future',
      time: justConfirmed ? new Date().toISOString() : p.cleanedAt,
      glyph: cleaned && p.cleanedSource === 'quo' ? 'phone' : null,
    },
    { key: 'inspected', label: 'Inspected', cls: inspected ? 'good' : active === 'inspected' ? 'active' : 'future' },
    { key: 'ready', label: 'Guest-ready', cls: ready ? 'good' : 'future' },
  ];

  const cd = countdown(p.checkIn, now);
  const overdue = active !== null && Date.parse(`${p.checkIn.slice(0, 10)}T16:00:00`) < now;
  const activeColor = overdue ? 'var(--negative)' : 'var(--signal)';
  const cdColor =
    overdue || cd.urgency === 'now' ? 'var(--negative)' : cd.urgency === 'soon' ? 'var(--signal)' : 'var(--ink-4)';
  // Baseline runs hot when the turn is tight (soon / same-day) and red when
  // check-in has passed with a stage unmet.
  const railHot = active !== null && (cd.urgency !== 'far' || p.sameDay);
  const baseColor = overdue ? 'rgba(200,90,58,.5)' : railHot ? 'rgba(200,90,58,.28)' : 'var(--rule)';
  const showEstConfirm = cleaned && p.cleanedEstimated && !justConfirmed;

  return (
    <div style={{ marginTop: 10, paddingLeft: 180, paddingRight: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 2 }}>
        <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11, color: cdColor }}>
          next check-in {cd.text}
        </span>
      </div>
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div
          style={{
            position: 'absolute',
            top: 6,
            left: '4%',
            right: '4%',
            height: 2,
            background: baseColor,
            zIndex: 0,
          }}
        />
        {nodes.map((n) => (
          <div
            key={n.key}
            ref={n.cls === 'active' ? activeRef : undefined}
            style={{
              position: 'relative',
              zIndex: 1,
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              minWidth: 0,
            }}
          >
            <span
              style={
                n.cls === 'active' && overdue
                  ? { ...dotStyle('active'), background: 'var(--negative)', borderColor: 'var(--negative)' }
                  : dotStyle(n.cls)
              }
            />
            <span
              style={{
                fontSize: 10,
                lineHeight: 1.2,
                textAlign: 'center',
                color: n.cls === 'active' ? activeColor : n.cls === 'good' ? 'var(--positive)' : 'var(--ink-4)',
              }}
            >
              {n.glyph === 'lock' ? '⌁ ' : n.glyph === 'phone' ? '✆ ' : ''}
              {n.label}
            </span>
            <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 10, color: n.cls === 'active' ? activeColor : 'var(--ink-4)', minHeight: 12 }}>
              {n.cls === 'active' && counterSince ? fmtElapsed(counterSince, now) : n.time ? fmtTime(n.time) : ''}
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
        ))}
      </div>
    </div>
  );
}

function dotStyle(cls: NodeCls): React.CSSProperties {
  const base: React.CSSProperties = {
    width: 13,
    height: 13,
    borderRadius: '50%',
    boxSizing: 'border-box',
    border: '2px solid var(--rule)',
    background: 'transparent',
  };
  if (cls === 'passed') return { ...base, background: 'var(--ink-3)', borderColor: 'var(--ink-3)' };
  if (cls === 'good') return { ...base, background: 'var(--positive)', borderColor: 'var(--positive)' };
  if (cls === 'active') return { ...base, background: 'var(--signal)', borderColor: 'var(--signal)' };
  if (cls === 'est') return { ...base, borderStyle: 'dashed', borderColor: 'var(--positive)' };
  return base; // future: hollow ring
}
