'use client';

import { useOwnerEmailDraft } from '@/lib/use-owner-email-draft';

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
  const { pending: drafting, error: err, draftUrl, draft } = useOwnerEmailDraft('/api/work/draft-owner-email', 'property_id', propertyId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
      <button
        type="button"
        onClick={() => { if (!disabled) void draft(); }}
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
        {drafting ? 'Drafting…' : draftUrl ? 'Open Gmail draft' : 'Draft Owner Email'}
      </button>
      {draftUrl && <a href={draftUrl} target="_blank" rel="noopener noreferrer">Open saved Gmail draft</a>}
      {err && (
        <div role="alert" style={{ fontSize: 11, color: 'var(--negative)', maxWidth: 320, textAlign: 'right' }}>
          {err}
        </div>
      )}
    </div>
  );
}
