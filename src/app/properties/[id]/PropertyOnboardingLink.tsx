'use client';

import { useState, useTransition } from 'react';
import { ensurePropertyOnboardingToken } from '@/app/projections/actions';

type Props = {
  propertyId: string;
  /** Existing onboarding token, or null if one hasn't been generated yet. */
  initialToken: string | null;
  /** ISO timestamp of the latest submission, or null if never submitted. */
  submittedAt: string | null;
};

/**
 * Public-form link surface for the Owner section on a property page.
 *
 * If the property has no token yet, shows a single "Generate onboarding
 * link" button. Clicking it asks the server to mint a token for this
 * property and stores it on the row. Once a token exists, the component
 * shows the public URL with a Copy button and a status line indicating
 * whether the owner has submitted yet (and when).
 */
export function PropertyOnboardingLink({ propertyId, initialToken, submittedAt }: Props) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onGenerate = () => {
    setError(null);
    startTransition(async () => {
      try {
        const fresh = await ensurePropertyOnboardingToken(propertyId);
        setToken(fresh);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const onCopy = async () => {
    if (!token) return;
    try {
      const url = `${window.location.origin}/onboarding/${token}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Older browsers / blocked clipboards: fall back to selecting the
      // text in the input so the user can Cmd+C manually.
      const input = document.getElementById(`onboarding-url-${propertyId}`) as HTMLInputElement | null;
      input?.select();
    }
  };

  // Status line: when the form was last submitted, or "Not yet submitted".
  const statusLine = (() => {
    if (!submittedAt) return 'Not yet submitted';
    try {
      const then = new Date(submittedAt);
      const days = Math.floor((Date.now() - then.getTime()) / (24 * 60 * 60 * 1000));
      if (days <= 0) return 'Submitted today';
      if (days === 1) return 'Submitted yesterday';
      if (days < 14) return `Submitted ${days} days ago`;
      return `Submitted ${then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } catch {
      return 'Submitted';
    }
  })();

  return (
    <div
      style={{
        marginTop: 24,
        paddingTop: 18,
        borderTop: '1px dotted var(--rule)',
      }}
    >
      <div className="eyebrow" style={{ marginBottom: 10 }}>Owner onboarding intake</div>

      {!token ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onGenerate}
            disabled={pending}
            style={{
              fontSize: 11,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              fontWeight: 500,
              color: 'var(--paper)',
              background: 'var(--ink)',
              border: '1px solid var(--ink)',
              padding: '10px 16px',
              cursor: pending ? 'wait' : 'pointer',
            }}
          >
            {pending ? 'Generating…' : 'Generate onboarding link'}
          </button>
          <span style={{ fontSize: 12, color: 'var(--ink-3)', maxWidth: 480, lineHeight: 1.55 }}>
            Creates a unique public form URL the owner can fill in. Their answers
            land back on this property record.
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              id={`onboarding-url-${propertyId}`}
              readOnly
              value={`/onboarding/${token}`}
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono"
              style={{
                fontSize: 12,
                color: 'var(--ink)',
                background: 'var(--paper-2)',
                border: '1px solid var(--rule)',
                padding: '8px 12px',
                minWidth: 280,
                flex: 1,
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={onCopy}
              style={{
                fontSize: 11,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                fontWeight: 500,
                color: 'var(--ink)',
                background: 'transparent',
                border: '1px solid var(--rule)',
                padding: '10px 16px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {copied ? 'Copied ✓' : 'Copy link'}
            </button>
            <a
              href={`/onboarding/${token}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 11,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                fontWeight: 500,
                color: 'var(--ink-3)',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              Preview ↗
            </a>
          </div>
          <span
            style={{
              fontSize: 12,
              color: submittedAt ? 'var(--positive)' : 'var(--ink-4)',
              letterSpacing: '.04em',
            }}
          >
            {statusLine}
          </span>
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: 10,
            fontSize: 12,
            color: 'var(--negative)',
            border: '1px solid var(--negative)',
            padding: '8px 12px',
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
