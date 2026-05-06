'use client';

import { useState } from 'react';

type Props = {
  contactId: string;
  /** Disable when there's nothing to draft (no open owner-action slips
   *  across the contact's linked properties). */
  disabled?: boolean;
};

/**
 * Cross-property version of the property page's Draft Owner Email
 * button (#147). Same backend behavior — opens a Gmail draft listing
 * every open owner-action item — but rolled up across all of the
 * contact's linked properties instead of one. Useful when an operator
 * is doing a periodic check-in with an owner who manages multiple
 * properties through Rising Tide.
 */
export function ContactDraftEmailButton({ contactId, disabled }: Props) {
  const [drafting, setDrafting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function draft() {
    if (drafting || disabled) return;
    setDrafting(true);
    setErr(null);
    try {
      const res = await fetch('/api/crm/draft-contact-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: contactId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.error || `Failed (${res.status})`);
        return;
      }
      if (data?.draft_url) {
        window.open(data.draft_url, '_blank', 'noopener,noreferrer');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDrafting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
      <button
        type="button"
        onClick={draft}
        disabled={disabled || drafting}
        title={
          disabled
            ? 'No open owner-action items across this contact\'s properties'
            : 'Open a Gmail draft listing every open owner-action item across this contact\'s linked properties'
        }
        style={{
          background: disabled ? 'transparent' : 'var(--ink)',
          color: disabled ? 'var(--ink-4)' : 'var(--paper)',
          border: '1px solid var(--ink)',
          padding: '6px 12px',
          fontSize: 11,
          letterSpacing: '.16em',
          textTransform: 'uppercase',
          fontWeight: 500,
          cursor: disabled || drafting ? 'default' : 'pointer',
          opacity: disabled ? 0.5 : drafting ? 0.7 : 1,
        }}
      >
        {drafting ? 'Drafting…' : 'Draft Email'}
      </button>
      {err && (
        <div style={{ fontSize: 11, color: 'var(--negative)', maxWidth: 320, textAlign: 'right' }}>
          {err}
        </div>
      )}
    </div>
  );
}
