'use client';

import { useState } from 'react';

type Props = {
  propertyId: string;
  /** Disable when there's nothing to draft (no open owner-action slips). */
  disabled?: boolean;
};

/**
 * Property-detail-page version of the Draft Owner Email button shipped on
 * the Work Queue's PropertyGroup (#136). Same backend; opens the resulting
 * Gmail draft in a new tab on success.
 */
export function PropertyDraftOwnerEmailButton({ propertyId, disabled }: Props) {
  const [drafting, setDrafting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function draft() {
    if (drafting || disabled) return;
    setDrafting(true);
    setErr(null);
    try {
      const res = await fetch('/api/work/draft-owner-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: propertyId }),
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
        title={disabled ? 'No open owner-action items to draft' : 'Open Gmail draft listing every open owner-action item'}
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
        {drafting ? 'Drafting…' : 'Draft Owner Email'}
      </button>
      {err && (
        <div style={{ fontSize: 11, color: 'var(--negative)', maxWidth: 320, textAlign: 'right' }}>
          {err}
        </div>
      )}
    </div>
  );
}
