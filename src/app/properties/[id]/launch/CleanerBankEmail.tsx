'use client';

import { useState } from 'react';
import { draftCleanerBankEmail } from './actions';
import { CAPE_ANN_ELITE_BILLING_TO, CHASE_ACH_ROUTING } from '@/lib/cleaner-bank-email';
import { copiedEmailText, writeClipboard } from '@/lib/copy-email';

/**
 * The cleaner_bank_sent step's composer: the full account number (typed
 * here, never saved) and the routing number, then one verb that drafts the
 * email to Cape Ann Elite in the owner's own Gmail, or copies it when Helm
 * holds no Gmail for them. Rendered inside the step's card, owners only.
 */
export function CleanerBankEmail({ propertyId, bankLast4 }: { propertyId: string; bankLast4: string | null }) {
  const [account, setAccount] = useState('');
  const [routing, setRouting] = useState(CHASE_ACH_ROUTING);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState<'clipboard' | string | null>(null);

  async function draft() {
    setPending(true);
    setError(null);
    setDraftUrl(null);
    setCopied(null);
    const res = await draftCleanerBankEmail(propertyId, account, routing);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    // The number has done its job; it does not linger on the page.
    setAccount('');
    if (res.kind === 'draft') {
      setDraftUrl(res.draftUrl);
      return;
    }
    const text = copiedEmailText(res.email);
    setCopied((await writeClipboard(text)) ? 'clipboard' : text);
  }

  return (
    <div className="rt-launch-row-field">
      <label className="rt-launch-row-field-label">
        Account number{bankLast4 ? ` (ends in ${bankLast4})` : ''}
      </label>
      <div className="rt-launch-row-field-row">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          placeholder={bankLast4 ? `…${bankLast4}` : 'Enter the last 4 above first'}
          className="rt-launch-row-field-input font-mono"
        />
      </div>
      <label className="rt-launch-row-field-label" style={{ marginTop: 10 }}>Routing number</label>
      <div className="rt-launch-row-field-row">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={routing}
          onChange={(e) => setRouting(e.target.value)}
          className="rt-launch-row-field-input font-mono"
        />
        <button
          type="button"
          onClick={draft}
          disabled={pending || !account.trim() || !bankLast4}
          className="rt-launch-row-btn rt-launch-row-btn-primary"
        >
          {pending ? 'Drafting…' : 'Draft email'}
        </button>
      </div>
      <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--ink-4)' }}>
        To {CAPE_ANN_ELITE_BILLING_TO.join(', ')}. Helm checks the number against the last 4 and does not keep it.
      </div>
      {error && <div className="rt-launch-row-error">{error}</div>}
      {draftUrl && (
        <div className="rt-launch-row-stamp">
          The draft is in your Gmail.{' '}
          <a href={draftUrl} target="_blank" rel="noopener noreferrer" className="rt-launch-row-deeplink">
            Open draft ↗
          </a>{' '}
          Mark this step Done once it is sent.
        </div>
      )}
      {copied === 'clipboard' && (
        <div className="rt-launch-row-stamp">
          Copied. Paste it into your mail and send, then mark this step Done.
        </div>
      )}
      {copied && copied !== 'clipboard' && (
        <textarea
          readOnly
          value={copied}
          rows={14}
          onFocus={(e) => e.currentTarget.select()}
          className="rt-launch-row-field-input font-mono"
          style={{ marginTop: 8, width: '100%' }}
        />
      )}
    </div>
  );
}
