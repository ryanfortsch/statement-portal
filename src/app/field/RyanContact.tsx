'use client';

import { useState } from 'react';
import { sendContractorNote } from './actions';

const PHONE_DISPLAY = '(978) 865-2387';
const PHONE_E164 = '+19788652387';
const PHOTO_SRC = '/ryan.jpg';

/**
 * Portal-wide "reach a real person" card. A warm navy plate with Ryan's photo
 * and a message in his own voice: text, call, or send an in-app note (delivered
 * to Ryan, reply-to the contractor). Rendered in FieldShell when a contractor is
 * signed in. Redesigned from a collapsed one-liner into a proper invitation, so
 * it reads as a person, not a footer link.
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
    <div style={{ maxWidth: 760, margin: '44px auto 0', padding: '0 clamp(16px,5vw,24px)', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ background: 'var(--ink)', borderRadius: 4, padding: 'clamp(24px,5vw,32px)' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16 }}>
          <Portrait size={62} />
          <div style={{ minWidth: 0 }}>
            <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--signal-soft)', fontWeight: 600, marginBottom: 6 }}>
              A real person, not a portal
            </div>
            <h2 className="font-serif" style={{ fontSize: 'clamp(22px,5vw,26px)', fontWeight: 300, lineHeight: 1.1, color: 'var(--paper)', margin: 0 }}>
              Ask me anything. I mean it.
            </h2>
          </div>
        </div>

        <p style={{ fontSize: 14, color: 'rgba(245,239,226,0.78)', lineHeight: 1.6, margin: '0 0 20px', maxWidth: '58ch' }}>
          I&apos;m Ryan. I run Rising Tide, and I read these myself. A home, a packet, getting set up, whatever it is,
          reach out. I would always rather you ask than guess.
        </p>

        {status === 'sent' ? (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, color: 'var(--paper)', lineHeight: 1.55 }}>
            <span aria-hidden style={{ color: 'var(--signal-soft)', flexShrink: 0 }}>✓</span>
            <span>Got it. I&apos;ll get back to you, usually the same day. Anything urgent, text or call {PHONE_DISPLAY}.</span>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <a href={`sms:${PHONE_E164}`} style={primaryBtn}>Text Ryan</a>
              <a href={`tel:${PHONE_E164}`} style={ghostBtn}>Call</a>
              <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} style={noteToggle}>
                {open ? 'Hide note' : 'Send a note'}
              </button>
              <span style={{ fontSize: 12, color: 'rgba(245,239,226,0.5)', marginLeft: 'auto' }}>{PHONE_DISPLAY}</span>
            </div>

            {open && (
              <div style={{ marginTop: 14 }}>
                <textarea
                  value={note}
                  onChange={(e) => { setNote(e.target.value); if (status === 'error') setStatus('idle'); }}
                  onFocus={() => setTaFocus(true)}
                  onBlur={() => setTaFocus(false)}
                  rows={3}
                  placeholder="What's on your mind? A home, a packet, getting set up, anything."
                  disabled={status === 'sending'}
                  style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 15, color: 'var(--ink)', background: 'var(--paper)', border: `2px solid ${taFocus ? 'var(--signal-soft)' : 'transparent'}`, borderRadius: 3, padding: '11px 13px', resize: 'vertical', outline: 'none' }}
                />
                {err && <div style={{ fontSize: 12.5, color: 'var(--signal-soft)', marginTop: 6 }}>{err}</div>}
                <button
                  type="button"
                  onClick={send}
                  disabled={status === 'sending'}
                  style={{ ...primaryBtn, marginTop: 10, cursor: status === 'sending' ? 'wait' : 'pointer', opacity: status === 'sending' ? 0.7 : 1 }}
                >
                  {status === 'sending' ? 'Sending…' : 'Send note'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  display: 'inline-block',
  background: 'var(--paper)',
  color: 'var(--ink)',
  textDecoration: 'none',
  border: 'none',
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  padding: '11px 22px',
};
const ghostBtn: React.CSSProperties = {
  display: 'inline-block',
  background: 'transparent',
  color: 'var(--paper)',
  textDecoration: 'none',
  border: '1px solid rgba(245,239,226,0.4)',
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  padding: '10px 20px',
};
const noteToggle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--signal-soft)',
  fontSize: 13,
  fontWeight: 600,
  padding: '0 4px',
};

function Portrait({ size }: { size: number }) {
  const [ok, setOk] = useState(true);
  const ring = '0 0 0 2px rgba(245,239,226,0.25)';
  if (!ok) {
    return (
      <span
        className="font-serif"
        aria-hidden
        style={{ width: size, height: size, borderRadius: '50%', background: 'var(--tide)', color: 'var(--paper)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.36), flexShrink: 0, boxShadow: ring }}
      >
        RF
      </span>
    );
  }
  return (
    <span style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', background: 'var(--paper-2)', boxShadow: ring, flexShrink: 0, display: 'inline-block' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={PHOTO_SRC}
        alt="Ryan, Rising Tide"
        onError={() => setOk(false)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 22%', display: 'block' }}
      />
    </span>
  );
}
