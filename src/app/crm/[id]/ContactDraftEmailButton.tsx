'use client';

import { useOwnerEmailDraft } from '@/lib/use-owner-email-draft';

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
  const { pending: drafting, error: err, draftUrl, draft } = useOwnerEmailDraft('/api/crm/draft-contact-email', 'contact_id', contactId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
      <button
        type="button"
        onClick={() => { if (!disabled) void draft(); }}
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
        {drafting ? 'Drafting…' : draftUrl ? 'Open Gmail draft' : 'Draft Email'}
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
