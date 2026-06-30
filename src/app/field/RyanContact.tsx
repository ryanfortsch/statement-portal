'use client';

import { useState } from 'react';
import { sendContractorNote } from './actions';

const PHONE_DISPLAY = '(978) 865-2387';
const PHONE_E164 = '+19788652387';
const PHOTO_SRC = '/ryan.jpg';

/**
 * A quiet, portal-wide "have a question?" affordance. Collapsed it is one
 * understated line with Ryan's portrait; tapping it opens a small panel to text
 * him, call him, or send a note in-app (delivered to Ryan, reply-to the
 * contractor). Rendered in FieldShell only when a contractor is signed in.
 *
 * The portrait is duotoned to the brand (navy shadows, warm-paper highlights)
 * via an inline SVG filter so a phone snapshot reads like it belongs here;
 * falls back to a navy monogram if the photo file isn't present yet.
 */
export function RyanContact() {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [taFocus, setTaFocus] = useState(false);

  async function send() {
    if (note.trim().length < 2) {
      setErr('Add a short message first.');
      setStatus('error');
      return;
    }
    setStatus('sending');
    setErr(null);
    try {
      const res = await sendContractorNote(note);
      if (res.ok) {
        setStatus('sent');
        setNote('');
      } else {
        setErr(res.error ?? 'Could not send.');
        setStatus('error');
      }
    } catch {
      setErr('Could not send. Give us a text or call instead.');
      setStatus('error');
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 clamp(16px,5vw,24px)', width: '100%' }}>
      <Duotone />
      <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 18, paddingBottom: 8 }}>
        {/* Collapsed trigger */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          style={{ boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', width: '100%', background: 'none', border: 'none', padding: 0, margin: 0, font: 'inherit', color: 'inherit', textAlign: 'left', outlineOffset: 3 }}
        >
          <Portrait size={40} />
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span className="font-serif" style={{ fontSize: 16, color: 'var(--ink)', lineHeight: 1.2 }}>
              Have a question?
            </span>
            <span style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>
              Reach Ryan directly. He&apos;d rather you ask than guess.
            </span>
          </span>
          <span aria-hidden style={{ marginLeft: 'auto', color: 'var(--tide)', fontSize: 18, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s ease', flexShrink: 0 }}>
            ⌄
          </span>
        </button>

        {/* Expanded panel */}
        {open && (
          <div style={{ marginTop: 16 }}>
            {status === 'sent' ? (
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, color: 'var(--ink)', lineHeight: 1.55, background: 'var(--paper-2)', padding: '14px 16px' }}>
                <span aria-hidden style={{ color: 'var(--tide)', flexShrink: 0 }}>✓</span>
                <span>Got it. Ryan will get back to you, usually same day. For anything urgent, text or call below.</span>
              </div>
            ) : (
              <>
                <textarea
                  value={note}
                  onChange={(e) => { setNote(e.target.value); if (status === 'error') setStatus('idle'); }}
                  onFocus={() => setTaFocus(true)}
                  onBlur={() => setTaFocus(false)}
                  rows={3}
                  placeholder="What's on your mind? A home, a packet, getting set up — anything."
                  disabled={status === 'sending'}
                  style={{ width: '100%', font: 'inherit', fontSize: 15, color: 'var(--ink)', background: 'var(--paper-2)', border: `1px solid ${taFocus ? 'var(--tide)' : 'var(--rule)'}`, borderRadius: 0, padding: '11px 13px', resize: 'vertical', outline: 'none', boxShadow: taFocus ? '0 0 0 2px rgba(78,124,158,0.2)' : 'none' }}
                />
                {err && <div style={{ fontSize: 12.5, color: 'var(--negative)', marginTop: 6 }}>{err}</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={send}
                    disabled={status === 'sending'}
                    style={{ background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 0, cursor: status === 'sending' ? 'wait' : 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', padding: '11px 22px', opacity: status === 'sending' ? 0.7 : 1 }}
                  >
                    {status === 'sending' ? 'Sending…' : 'Send note'}
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>or</span>
                  <a href={`sms:${PHONE_E164}`} style={{ fontSize: 13, color: 'var(--tide)', textDecoration: 'none', fontWeight: 600 }}>Text</a>
                  <span style={{ color: 'var(--rule)' }}>·</span>
                  <a href={`tel:${PHONE_E164}`} style={{ fontSize: 13, color: 'var(--tide)', textDecoration: 'none', fontWeight: 600 }}>Call</a>
                  <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>{PHONE_DISPLAY}</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** The brand duotone filter, declared once, off-screen. */
function Duotone() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute', overflow: 'hidden' }} aria-hidden focusable="false">
      {/* Soft brand duotone: shadows to ink-2 (not pure navy), a warm midtone
          stop so skin doesn't posterize, highlights to warm paper. */}
      <filter id="rt-duotone" colorInterpolationFilters="sRGB">
        <feColorMatrix
          type="matrix"
          values="0.33 0.34 0.33 0 0  0.33 0.34 0.33 0 0  0.33 0.34 0.33 0 0  0 0 0 1 0"
        />
        <feComponentTransfer>
          <feFuncR type="table" tableValues="0.094 0.52 0.92" />
          <feFuncG type="table" tableValues="0.216 0.45 0.90" />
          <feFuncB type="table" tableValues="0.361 0.38 0.84" />
        </feComponentTransfer>
      </filter>
    </svg>
  );
}

function Portrait({ size }: { size: number }) {
  const [ok, setOk] = useState(true);
  if (!ok) {
    return (
      <span
        className="font-serif"
        aria-hidden
        style={{ width: size, height: size, borderRadius: '50%', background: 'var(--ink)', color: 'var(--paper)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.36), flexShrink: 0 }}
      >
        RF
      </span>
    );
  }
  return (
    <span style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', background: 'var(--paper-2)', boxShadow: '0 0 0 1px var(--rule)', flexShrink: 0, display: 'inline-block' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={PHOTO_SRC}
        alt="Ryan, Rising Tide"
        onError={() => setOk(false)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 28%', filter: 'url(#rt-duotone)', display: 'block' }}
      />
    </span>
  );
}
