'use client';

import { useState } from 'react';

const PHONE_DISPLAY = '(978) 865-2387';
const PHONE_E164 = '+19788652387';
const PHOTO_SRC = '/ryan.jpg';

/**
 * Portal-wide "reach a real person" card. A warm navy plate with Ryan's photo
 * and a message in his own voice, plus one-tap Text and Call. Rendered in
 * FieldShell when a contractor is signed in.
 */
export function RyanContact() {
  return (
    <div style={{ maxWidth: 760, margin: '44px auto 0', padding: '0 clamp(16px,5vw,24px)', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ background: 'var(--ink)', borderRadius: 4, padding: 'clamp(24px,5vw,32px)' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16 }}>
          <Portrait size={62} />
          <h2 className="font-serif" style={{ fontSize: 'clamp(22px,5vw,26px)', fontWeight: 300, lineHeight: 1.12, color: 'var(--paper)', margin: 0 }}>
            Questions? Come straight to me.
          </h2>
        </div>

        <p style={{ fontSize: 14, color: 'rgba(245,239,226,0.78)', lineHeight: 1.6, margin: '0 0 20px', maxWidth: '58ch' }}>
          I&apos;m Ryan, I run Rising Tide. A home, a packet, getting set up, whatever it is, text or call me. I would
          always rather you ask than guess.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <a href={`sms:${PHONE_E164}`} style={primaryBtn}>Text Ryan</a>
          <a href={`tel:${PHONE_E164}`} style={ghostBtn}>Call</a>
          <span style={{ fontSize: 12, color: 'rgba(245,239,226,0.5)', marginLeft: 'auto' }}>{PHONE_DISPLAY}</span>
        </div>
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
