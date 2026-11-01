'use client';

import { useOwnerEmailDraft } from '@/lib/use-owner-email-draft';
import { Button } from '@/components/Button';
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
 * Gmail for them. The house secondary button: the section's one dark verb
 * is the new work item beside it. The draft composes with the model, so the
 * watchdog is off; waiting is the job.
 */
export function PropertyDraftOwnerEmailButton({ propertyId, disabled, myMailbox }: Props) {
  const { pending: drafting, error: err, draftUrl, draft, savedIn, copied } = useOwnerEmailDraft('/api/work/draft-owner-email', 'property_id', propertyId);
  const copyMode = myMailbox === null || !!copied;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => { if (!disabled) void draft(); }}
        disabled={disabled}
        pending={drafting}
        pendingLabel={copyMode ? 'Copying' : 'Drafting'}
        watchdog={false}
        title={disabled ? 'No open owner-action items to draft' : copyMode ? 'Copy an email listing every open owner-action item' : `Draft in your Gmail${myMailbox ? ` (${myMailbox})` : ''} an email listing every open owner-action item`}
      >
        {draftUrl ? 'Open Gmail draft' : savedIn ? 'Drafted' : copied ? 'Copy again' : copyMode ? 'Copy owner email' : 'Draft Owner Email'}
      </Button>
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
