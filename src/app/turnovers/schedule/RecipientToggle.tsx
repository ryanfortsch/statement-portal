'use client';

import { useState } from 'react';
import { SubmitButton } from '@/components/SubmitButton';
import { toggleRecipientAction } from './actions';

/**
 * The per-recipient delivery switch. Turning a cleaner's texts OFF asks
 * once ("Stop texting Rosa? Confirm / Cancel") because one tap on a
 * person's name used to silently stop the crew text with nothing on the
 * pill saying what the tap did. Turning delivery back on is one tap.
 */
export function RecipientToggle({ phone, name, enabled }: { phone: string; name: string; enabled: boolean }) {
  const [confirming, setConfirming] = useState(false);

  const pill: React.CSSProperties = {
    fontSize: 12,
    padding: '5px 12px',
    borderRadius: 12,
    cursor: 'pointer',
    border: enabled ? '1px solid var(--ink)' : '1px solid var(--rule)',
    background: enabled ? 'var(--ink)' : 'transparent',
    color: enabled ? 'var(--paper)' : 'var(--ink-4)',
  };

  if (enabled && !confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} style={pill} title={`${name} gets the daily text. Tap to stop.`}>
        {name} · gets the text
      </button>
    );
  }

  return (
    <form action={toggleRecipientAction} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <input type="hidden" name="phone" value={phone} />
      <input type="hidden" name="enabled" value={enabled ? 'false' : 'true'} />
      {enabled ? (
        <>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Stop texting {name} the daily schedule?</span>
          <SubmitButton
            label="Confirm"
            busyLabel="..."
            style={{ fontSize: 11, padding: '4px 12px', background: 'var(--ink)', color: 'var(--paper)', border: '1px solid var(--ink)', borderRadius: 12, cursor: 'pointer' }}
          />
          <button
            type="button"
            onClick={() => setConfirming(false)}
            style={{ fontSize: 11, padding: '4px 12px', background: 'transparent', color: 'var(--ink-3)', border: '1px solid var(--rule)', borderRadius: 12, cursor: 'pointer' }}
          >
            Cancel
          </button>
        </>
      ) : (
        <SubmitButton label={`${name} · off`} busyLabel="..." spinnerTone="ink" style={pill} />
      )}
    </form>
  );
}
