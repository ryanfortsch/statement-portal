'use client';

import { useState, useTransition } from 'react';
import {
  backfillPropertyFromIntegrations,
  type BackfillResult,
} from './actions';

type Props = {
  propertyId: string;
};

/**
 * "Backfill from integrations" button — pulls bedroom / bathroom / property
 * type / lat-lng from Guesty's listing detail endpoint, applies smart
 * defaults (e.g. owner_preferred_contact = 'email' when owner_emails has
 * any value), and surfaces a per-field summary so Dotti can see exactly
 * what landed.
 *
 * Never overwrites an existing value — backfill is fill-blanks-only.
 */
export function PropertyBackfillButton({ propertyId }: Props) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<BackfillResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const r = await backfillPropertyFromIntegrations(propertyId);
        setResult(r);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        style={{
          fontSize: 11,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'var(--ink)',
          background: 'transparent',
          border: '1px solid var(--rule)',
          padding: '8px 14px',
          fontWeight: 500,
          cursor: pending ? 'wait' : 'pointer',
          alignSelf: 'flex-start',
        }}
      >
        {pending ? 'Pulling…' : 'Backfill from integrations'}
      </button>

      {error && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--negative)',
            border: '1px solid var(--negative)',
            padding: '8px 12px',
            maxWidth: 640,
          }}
        >
          {error}
        </div>
      )}

      {result && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--ink-3)',
            border: '1px solid var(--rule)',
            padding: '12px 14px',
            maxWidth: 640,
            background: 'var(--paper-2)',
          }}
        >
          {result.filled.length === 0 && result.warnings.length === 0 && (
            <div style={{ color: 'var(--ink-4)' }}>
              Nothing new to fill — every field we could backfill is already populated.
            </div>
          )}

          {result.sources.length > 0 && (
            <div style={{ marginBottom: 10, fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic', lineHeight: 1.55 }}>
              Pulled from: {result.sources.join('; ')}
            </div>
          )}

          {result.filled.length > 0 && (
            <>
              <div className="eyebrow" style={{ marginBottom: 6, color: 'var(--positive)' }}>
                Filled {result.filled.length} {result.filled.length === 1 ? 'field' : 'fields'}
              </div>
              <ul style={{ margin: '0 0 8px', paddingLeft: 18, lineHeight: 1.55 }}>
                {result.filled.map((line) => (
                  <li key={line} className="font-mono" style={{ fontSize: 11, color: 'var(--ink)' }}>
                    {line}
                  </li>
                ))}
              </ul>
            </>
          )}

          {result.skipped.length > 0 && (
            <>
              <div className="eyebrow" style={{ marginBottom: 6 }}>
                Left alone ({result.skipped.length}) — already set
              </div>
              <ul style={{ margin: '0 0 8px', paddingLeft: 18, lineHeight: 1.55 }}>
                {result.skipped.slice(0, 6).map((line) => (
                  <li
                    key={line}
                    className="font-mono"
                    style={{ fontSize: 11, color: 'var(--ink-4)' }}
                  >
                    {line}
                  </li>
                ))}
                {result.skipped.length > 6 && (
                  <li style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                    … and {result.skipped.length - 6} more
                  </li>
                )}
              </ul>
            </>
          )}

          {result.warnings.length > 0 && (
            <>
              <div className="eyebrow" style={{ marginBottom: 6, color: 'var(--signal)' }}>
                Warnings
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.55 }}>
                {result.warnings.map((line) => (
                  <li key={line} style={{ fontSize: 11, color: 'var(--signal)' }}>
                    {line}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
