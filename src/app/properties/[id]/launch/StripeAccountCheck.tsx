'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Stripe account-identity panel for the launch checklist's Financial phase.
 *
 * Renders /api/stripe-account-check: which Stripe account this property's
 * key actually reaches (account id + dashboard name), how many charges that
 * account saw in the last 60 days, and the wrong-account warning when the
 * key reads clean but sees nothing while Direct/VRBO stays are on the
 * books. That exact combination is how 3 Windward's mis-minted key hid for
 * weeks: a valid key from someone else's account syncs cleanly with
 * charges_found=0.
 *
 * Auto-runs scoped to this property on mount (two Stripe reads, cheap);
 * "Check all keys" widens to the whole fleet on demand.
 */

type AccountCheckRow = {
  property_id: string;
  account_id: string | null;
  display_name: string;
  account_error: string | null;
  charges_60d: number | null;
  charges_capped: boolean;
  charges_error: string | null;
  direct_stays: number | null;
  suspect: boolean;
};

type CheckResponse = {
  ok: boolean;
  window_days: number;
  properties: AccountCheckRow[];
  refused_secret_key_ids: string[];
};

export function StripeAccountCheck({ propertyId }: { propertyId: string }) {
  const [scoped, setScoped] = useState<CheckResponse | null>(null);
  const [fleet, setFleet] = useState<CheckResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fleetLoading, setFleetLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (all: boolean) => {
    const qs = all ? '' : `?property_id=${encodeURIComponent(propertyId)}`;
    const res = await fetch(`/api/stripe-account-check${qs}`);
    if (!res.ok) throw new Error(`account check failed (HTTP ${res.status})`);
    return (await res.json()) as CheckResponse;
  }, [propertyId]);

  useEffect(() => {
    let cancelled = false;
    run(false)
      .then((data) => { if (!cancelled) { setScoped(data); setLoading(false); } })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [run]);

  const onCheckFleet = () => {
    setFleetLoading(true);
    setError(null);
    run(true)
      .then((data) => { setFleet(data); setFleetLoading(false); })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setFleetLoading(false);
      });
  };

  const envVar = `STRIPE_KEY_${propertyId.toUpperCase()}`;
  const row = scoped?.properties.find((r) => r.property_id === propertyId) ?? null;
  const refusedSk = scoped?.refused_secret_key_ids.includes(propertyId) ?? false;

  return (
    <div
      style={{
        marginTop: 18,
        border: '1px solid var(--rule)',
        background: 'var(--paper-2, #f5f1e7)',
        padding: '16px 18px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
            Stripe account check
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 560 }}>
            Verifies which Stripe account this property&apos;s key actually reaches. A key minted
            from the wrong account is still valid, so the sync reads clean and simply sees no
            charges.
          </div>
        </div>
        <button
          type="button"
          onClick={onCheckFleet}
          disabled={fleetLoading}
          style={{
            fontSize: 11,
            letterSpacing: '.14em',
            textTransform: 'uppercase',
            color: 'var(--ink)',
            background: 'transparent',
            border: '1px solid var(--rule)',
            padding: '7px 12px',
            fontWeight: 500,
            cursor: fleetLoading ? 'wait' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {fleetLoading ? 'Checking…' : 'Check all keys'}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--negative, #a33)', border: '1px solid var(--negative, #a33)', padding: '8px 12px' }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-4)' }}>Checking this property&apos;s key…</div>
      )}

      {!loading && !error && !row && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-2, var(--ink))', lineHeight: 1.55 }}>
          {refusedSk ? (
            <>
              <span style={{ color: 'var(--signal, #c85a3a)', fontWeight: 600 }}>Full-access key refused.</span>{' '}
              <code style={{ fontFamily: 'var(--font-mono-dash), ui-monospace, monospace' }}>{envVar}</code> holds
              an sk_ secret, which Helm ignores by policy. Mint a <em>restricted</em> key in the
              property&apos;s own Stripe dashboard and replace the value in Vercel.
            </>
          ) : (
            <>
              No Stripe key configured for this property. Mint a restricted key in the
              property&apos;s own Stripe account and add it in Vercel as{' '}
              <code style={{ fontFamily: 'var(--font-mono-dash), ui-monospace, monospace' }}>{envVar}</code>.
              Until then, Direct/VRBO fees stay on the 3.9% estimate.
            </>
          )}
        </div>
      )}

      {!loading && row && (
        <div style={{ marginTop: 12 }}>
          <ResultRow row={row} windowDays={scoped?.window_days ?? 60} prominent />
        </div>
      )}

      {fleet && (
        <div style={{ marginTop: 16, borderTop: '1px solid var(--rule)', paddingTop: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8 }}>
            All configured keys
          </div>
          {fleet.properties.map((r) => (
            <ResultRow key={r.property_id} row={r} windowDays={fleet.window_days} />
          ))}
          {fleet.refused_secret_key_ids.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--signal, #c85a3a)' }}>
              Refused sk_ pastes: {fleet.refused_secret_key_ids.join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResultRow({ row, windowDays, prominent }: { row: AccountCheckRow; windowDays: number; prominent?: boolean }) {
  const mono = { fontFamily: 'var(--font-mono-dash), ui-monospace, monospace' } as const;
  return (
    <div
      style={{
        padding: prominent ? 0 : '8px 0',
        borderBottom: prominent ? 'none' : '1px solid var(--rule)',
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'baseline' }}>
        {!prominent && (
          <span style={{ ...mono, fontWeight: 700, color: 'var(--ink)' }}>{row.property_id}</span>
        )}
        {row.account_id ? (
          <>
            <span style={mono}>{row.account_id}</span>
            <span style={{ color: 'var(--ink)' }}>
              {row.display_name || <em style={{ color: 'var(--ink-4)' }}>no dashboard name</em>}
            </span>
          </>
        ) : (
          <span style={{ color: 'var(--signal, #c85a3a)' }}>
            account unreadable: {row.account_error}
          </span>
        )}
        <span style={{ color: 'var(--ink-3)' }}>
          {row.charges_error
            ? `charges unreadable: ${row.charges_error}`
            : `${row.charges_60d ?? '?'}${row.charges_capped ? '+' : ''} charges / ${windowDays}d`}
        </span>
        {row.direct_stays != null && (
          <span style={{ color: 'var(--ink-3)' }}>{row.direct_stays} Direct/VRBO stays booked</span>
        )}
      </div>
      {row.suspect && (
        <div
          style={{
            marginTop: 6,
            border: '1px solid var(--signal, #c85a3a)',
            background: 'rgba(200, 90, 58, 0.06)',
            padding: '8px 12px',
            color: 'var(--ink)',
            maxWidth: 640,
          }}
        >
          <span style={{ color: 'var(--signal, #c85a3a)', fontWeight: 600 }}>
            Zero charges but {row.direct_stays} Direct/VRBO stay{row.direct_stays === 1 ? '' : 's'} on the books.
          </span>{' '}
          This is the wrong-account signature: a valid key from someone else&apos;s Stripe reads
          clean and sees nothing. Open the property&apos;s own Stripe dashboard and confirm its
          account id matches <span style={mono}>{row.account_id}</span>. If it doesn&apos;t,
          re-mint the restricted key from the right account and update{' '}
          <span style={mono}>STRIPE_KEY_{row.property_id.toUpperCase()}</span> in Vercel.
        </div>
      )}
    </div>
  );
}
