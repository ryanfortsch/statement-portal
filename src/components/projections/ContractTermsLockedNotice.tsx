import { CONTRACT_LOCKED_MESSAGE } from '@/lib/contract-terms';

/**
 * The one notice for a signed contract's locked terms. The workroom prints
 * it over the edit form (where it also names any terms a save just held)
 * and in place of the owner-redlines panel, and the server returns the
 * same sentence when it refuses a write, so the reader meets one wording.
 */
export function ContractTermsLockedNotice({
  held,
  othersSave = false,
}: {
  /** Terms a save just tried to change, from ?terms_locked=. */
  held?: string | null;
  /** True over the edit form, where everything that is not a term still saves. */
  othersSave?: boolean;
}) {
  return (
    <p
      role={held ? 'alert' : undefined}
      style={{
        margin: '0 0 18px',
        padding: '10px 14px',
        fontSize: 12,
        lineHeight: 1.55,
        maxWidth: 680,
        border: `1px solid ${held ? 'var(--negative)' : 'var(--rule)'}`,
        background: 'var(--paper-2)',
        color: 'var(--ink)',
      }}
    >
      {held && (
        <>
          <strong>Not saved.</strong> These would have changed the signed contract: {held}.{' '}
        </>
      )}
      {CONTRACT_LOCKED_MESSAGE}
      {othersSave && ' Everything else on this form still saves.'}
    </p>
  );
}
