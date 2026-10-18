'use client';

import { useOwnerEmailDraft } from '@/lib/use-owner-email-draft';
import { CopiedEmailNotice } from '@/components/CopiedEmailNotice';

type Props = {
  propertyId: string;
  /** Disable when there's nothing to draft (no open owner-action slips). */
  disabled?: boolean;
  /** The signed-in person's own Gmail, or null when Helm holds none for
   *  them: the email is then copied, not drafted. */
  myMailbox?: string | null;
};

/**
 * Property-detail-page version of the Draft Owner Email button shipped on
 * the Work Queue's PropertyGroup (#136). Same backend: drafts in the
 * sender's own Gmail and opens it, or copies the email when Helm holds no
 * Gmail for them.
 */
export function PropertyDraftOwnerEmailButton({ propertyId, disabled, myMailbox }: Props) {
  const { pending: drafting, error: err, draftUrl, draft, savedIn, copied } = useOwnerEmailDraft('/api/work/draft-owner-email', 'property_id', propertyId);
  const copyMode = myMailbox === null || !!copied;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
      <button
        type="button"
        onClick={() => { if (!disabled) void draft(); }}
        disabled={disabled || drafting}
        title={disabled ? 'No open owner-action items to draft' : copyMode ? 'Copy an email listing every open owner-action item' : `Draft in your Gmail${myMailbox ? ` (${myMailbox})` : ''} an email listing every open owner-action item`}
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
        {drafting ? (copyMode ? 'Copying…' : 'Drafting…') : draftUrl ? 'Open Gmail draft' : savedIn ? 'Drafted' : copied ? 'Copy again' : copyMode ? 'Copy owner email' : 'Draft Owner Email'}
      </button>
      {copied && <CopiedEmailNotice copied={copied} align="right" />}
      {draftUrl && <a href={draftUrl} target="_blank" rel="noopener noreferrer">Open saved Gmail draft</a>}
      {savedIn && <span style={{ fontSize: 11, color: 'var(--ink-3)', maxWidth: 320, textAlign: 'right' }}>{savedIn}</span>}
      {err && (
        <div role="alert" style={{ fontSize: 11, color: 'var(--negative)', maxWidth: 320, textAlign: 'right' }}>
          {err}
        </div>
      )}
    </div>
  );
}
