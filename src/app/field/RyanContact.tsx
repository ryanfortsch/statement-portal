'use client';

import { useState } from 'react';
import { sendContractorNote } from './actions';

const PHONE_DISPLAY = '(978) 865-2387';
const PHONE_E164 = '+19788652387';
const PHOTO_SRC = '/ryan.jpg';

/**
 * A quiet, portal-wide "have a question?" card. Collapsed it's Ryan's portrait
 * and a warm line; tapping it glides open to text him, call him, or send a note
 * in-app (delivered to Ryan, reply-to the contractor). Rendered in FieldShell
 * only when a contractor is signed in.
 *
 * The portrait gets a soft warm grade and a vignetted frame (not a hard
 * duotone, which only sharpened a phone photo's compression); falls back to a
 * navy monogram if the file isn't present.
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
    <div style={{ maxWidth: 760, margin: '8px auto 0', padding: '0 clamp(16px,5vw,24px)', width: '100%' }}>
      <style>{`
        .rt-ask-card { transition: box-shadow .3s ease; }
        .rt-ask-trigger { transition: opacity .2s ease; }
        .rt-ask-trigger:hover { opacity: .82; }
        .rt-ask-chev { transition: transform .35s cubic-bezier(.4,0,.2,1); }
        .rt-ask-panel { overflow: hidden; transition: max-height .38s cubic-bezier(.4,0,.2,1), opacity .3s ease; }
        .rt-ask-send { transition: transform .15s ease, opacity .2s ease; }
        .rt-ask-send:hover:not(:disabled) { transform: translateY(-1px); }
        .rt-ask-send:active:not(:disabled) { transform: translateY(0); }
        .rt-ask-link { transition: color .2s ease, opacity .2s ease; }
        .rt-ask-link:hover { opacity: .7; }
        .rt-ask-ta { transition: border-color .25s ease, box-shadow .25s ease, background .25s ease; }
      `}</style>

      <div
        className="rt-ask-card"
        style={{ background: 'var(--paper-2)', borderRadius: 4, padding: '16px 18px', boxShadow: '0 1px 2px rgba(11,37,69,0.04), 0 10px 30px rgba(11,37,69,0.05)' }}
      >
        {/* Collapsed trigger */}
        <button
          type="button"
          className="rt-ask-trigger"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          style={{ boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', width: '100%', background: 'none', border: 'none', padding: 0, margin: 0, font: 'inherit', color: 'inherit', textAlign: 'left', outlineOffset: 4 }}
        >
          <Portrait size={48} />
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span className="font-serif" style={{ fontSize: 17, color: 'var(--ink)', lineHeight: 1.2 }}>
              Have a question?
            </span>
            <span style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>
              Reach Ryan directly. He&apos;d rather you ask than guess.
            </span>
          </span>
          <span aria-hidden className="rt-ask-chev" style={{ marginLeft: 'auto', color: 'var(--tide)', fontSize: 20, transform: open ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0, lineHeight: 1 }}>
            ⌄
          </span>
        </button>

        {/* Expanded panel — always mounted so it can glide */}
        <div className="rt-ask-panel" style={{ maxHeight: open ? 460 : 0, opacity: open ? 1 : 0 }}>
          <div style={{ paddingTop: 16 }}>
            {status === 'sent' ? (
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, color: 'var(--ink)', lineHeight: 1.55, background: 'var(--paper)', borderLeft: '3px solid var(--tide)', padding: '13px 15px' }}>
                <span aria-hidden style={{ color: 'var(--tide)', flexShrink: 0 }}>✓</span>
                <span>Got it. Ryan will get back to you, usually same day. For anything urgent, text or call below.</span>
              </div>
            ) : (
              <>
                <textarea
                  className="rt-ask-ta"
                  value={note}
                  onChange={(e) => { setNote(e.target.value); if (status === 'error') setStatus('idle'); }}
                  onFocus={() => setTaFocus(true)}
                  onBlur={() => setTaFocus(false)}
                  rows={3}
                  placeholder="What's on your mind? A home, a packet, getting set up — anything."
                  disabled={status === 'sending'}
                  style={{ width: '100%', font: 'inherit', fontSize: 15, color: 'var(--ink)', background: taFocus ? 'var(--paper)' : 'rgba(0,0,0,0.015)', border: `1px solid ${taFocus ? 'var(--tide)' : 'var(--rule)'}`, borderRadius: 3, padding: '12px 14px', resize: 'vertical', outline: 'none', boxShadow: taFocus ? '0 0 0 3px rgba(78,124,158,0.14)' : 'none' }}
                />
                {err && <div style={{ fontSize: 12.5, color: 'var(--negative)', marginTop: 6 }}>{err}</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="rt-ask-send"
                    onClick={send}
                    disabled={status === 'sending'}
                    style={{ background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 3, cursor: status === 'sending' ? 'wait' : 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', padding: '12px 24px', opacity: status === 'sending' ? 0.7 : 1 }}
                  >
                    {status === 'sending' ? 'Sending…' : 'Send note'}
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>or</span>
                  <a href={`sms:${PHONE_E164}`} className="rt-ask-link" style={{ fontSize: 13, color: 'var(--tide)', textDecoration: 'none', fontWeight: 600 }}>Text</a>
                  <span style={{ color: 'var(--rule)' }}>·</span>
                  <a href={`tel:${PHONE_E164}`} className="rt-ask-link" style={{ fontSize: 13, color: 'var(--tide)', textDecoration: 'none', fontWeight: 600 }}>Call</a>
                  <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>{PHONE_DISPLAY}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Ryan's portrait: a soft warm grade + an elegant vignetted circular frame
 *  that reads premium on a phone photo. Falls back to a navy monogram. */
function Portrait({ size }: { size: number }) {
  const [ok, setOk] = useState(true);
  if (!ok) {
    return (
      <span
        className="font-serif"
        aria-hidden
        style={{ width: size, height: size, borderRadius: '50%', background: 'var(--ink)', color: 'var(--paper)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.36), flexShrink: 0, boxShadow: '0 2px 8px rgba(11,37,69,0.18)' }}
      >
        RF
      </span>
    );
  }
  return (
    <span style={{ position: 'relative', width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, display: 'inline-block', boxShadow: '0 0 0 1px var(--rule), 0 3px 10px rgba(11,37,69,0.16)' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={PHOTO_SRC}
        alt="Ryan, Rising Tide"
        onError={() => setOk(false)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 22%', filter: 'saturate(0.92) contrast(1.03)', display: 'block' }}
      />
      {/* Subtle vignette: focuses the face, softens edge compression. */}
      <span aria-hidden style={{ position: 'absolute', inset: 0, borderRadius: '50%', boxShadow: 'inset 0 0 14px rgba(11,37,69,0.22)', pointerEvents: 'none' }} />
    </span>
  );
}
