'use client';

/**
 * Client-side buttons for the contract signing flow. Each one solves a
 * specific UX gap surfaced during smoke testing the auto-email + countersign
 * feature.
 *
 *   CopyLinkButton   one-click copy a link to clipboard (no more right-
 *                    click → Copy Link Address)
 *   SignSubmitButton submit button on the public /contract/<token> form;
 *                    shows "Submitting..." + disables while the server
 *                    action runs (PDF render + email send can take
 *                    5-15 seconds — without this it looks dead)
 *   CountersignButton same pattern for the Allie-side "Countersign & send"
 *                    button on the projection detail page
 *
 * Both submit buttons use useFormStatus() from react-dom — must live INSIDE
 * a <form action={...}> as a CHILD client component (the form itself can
 * stay server-rendered).
 */

import { useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

export function CopyLinkButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // Browser blocked clipboard (e.g. http context). Fall back to
          // a select-all so the user can cmd-c themselves.
          window.prompt('Copy this link:', text);
        }
      }}
      style={{
        background: copied ? 'var(--signal)' : 'transparent',
        color: copied ? 'var(--paper)' : 'var(--ink)',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        padding: '9px 16px',
        border: copied ? '1px solid var(--signal)' : '1px solid var(--ink)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'background 120ms, color 120ms, border-color 120ms',
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

/**
 * Submit button for the public /contract/<token> signing form. Reuses the
 * .rt-sign-btn style from that page; just adds pending-state behavior.
 */
export function SignSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rt-sign-btn"
      style={{
        opacity: pending ? 0.6 : 1,
        cursor: pending ? 'wait' : 'pointer',
      }}
    >
      {pending ? 'Submitting…' : 'Sign and submit'}
    </button>
  );
}

/**
 * "Countersign & send" button on the projection detail page (stage 03).
 * The server action does a PDF render via API fetch + Resend send, which
 * takes 5-15s. Without disabled-state feedback the button looks dead and
 * staff click it multiple times.
 */
/**
 * DocuSign-style floating "Jump to signature" pill. Fixed bottom-right
 * of the page; on click, smooth-scrolls the public /contract/<token>
 * page to the .rt-c-sig-page section so a signer doesn't have to scroll
 * through the entire contract to find where to sign. Hides itself once
 * the signature section is in view (IntersectionObserver) so it doesn't
 * loiter once the signer has reached the form.
 */
export function ScrollToSignButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const sigPage = document.querySelector('.rt-c-sig-page');
    if (!sigPage) return;
    // Initial check: only show if sig page isn't already in view.
    const rect = sigPage.getBoundingClientRect();
    setVisible(rect.top > window.innerHeight - 100);
    // Hide once it scrolls into view.
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting),
      { rootMargin: '-80px' },
    );
    observer.observe(sigPage);
    return () => observer.disconnect();
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => {
        const sigPage = document.querySelector('.rt-c-sig-page');
        sigPage?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }}
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 100,
        background: 'var(--signal)',
        color: 'var(--paper)',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        padding: '14px 22px',
        border: 'none',
        borderRadius: 999,
        cursor: 'pointer',
        boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      Jump to signature
      <span style={{ fontSize: 14 }}>↓</span>
    </button>
  );
}

export function CountersignButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      style={{
        background: 'var(--ink)',
        color: 'var(--paper)',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        padding: '12px 18px',
        border: 'none',
        cursor: pending ? 'wait' : 'pointer',
        whiteSpace: 'nowrap',
        opacity: pending ? 0.6 : 1,
      }}
    >
      {pending ? 'Sending…' : 'Countersign & send'}
    </button>
  );
}
