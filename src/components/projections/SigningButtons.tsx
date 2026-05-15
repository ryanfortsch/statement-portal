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

import { useState } from 'react';
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
