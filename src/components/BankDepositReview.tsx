'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

/**
 * Per-property review queue for unattributed bank deposits found during
 * /api/ingest. The operator either attributes a deposit to a specific
 * reservation as an add-on (fee-bearing revenue by default) or dismisses
 * it as not-revenue (silently). Lives inline on each property card on
 * /statements, just above the Data Gaps section.
 */

type Deposit = {
  id: string;
  deposit_date: string;
  amount: number;
  description: string | null;
  source: string;
  suggested_reservation_code: string | null;
};

type ReservationOption = { confirmation_code: string | null; guest_name: string };

function fmtDate(iso: string): string {
  try {
    const [y, m, d] = iso.split('-');
    return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return iso; }
}

function fmtMoney(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function BankDepositReview({
  propertyId, month, reservations,
}: {
  propertyId: string;
  month: string;
  reservations: ReservationOption[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<Deposit[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { label: string; code: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: e } = await supabase
      .from('bank_deposit_attributions')
      .select('id, deposit_date, amount, description, source, suggested_reservation_code')
      .eq('property_id', propertyId)
      .eq('month', month)
      .eq('status', 'pending')
      .order('deposit_date', { ascending: true });
    if (e && e.code !== 'PGRST205' && !/does not exist|relation|Could not find the table/i.test(e.message || '')) {
      setError(e.message);
      return;
    }
    setItems((data || []) as Deposit[]);
  }, [propertyId, month]);

  // Initial load + refresh when month/property changes. eslint disable here
  // matches the same pattern used elsewhere in this file.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const validCodes = reservations.map(r => r.confirmation_code).filter((c): c is string => !!c);
  function draftFor(dep: Deposit) {
    const d = drafts[dep.id];
    if (d) return d;
    const initial = {
      label: 'Add-on',
      code: dep.suggested_reservation_code && validCodes.includes(dep.suggested_reservation_code)
        ? dep.suggested_reservation_code
        : (validCodes[0] || ''),
    };
    return initial;
  }
  function setDraft(id: string, next: { label?: string; code?: string }) {
    setDrafts(prev => ({ ...prev, [id]: { ...draftFor({ id, suggested_reservation_code: null } as Deposit), ...prev[id], ...next } }));
  }

  async function attribute(dep: Deposit) {
    const { label, code } = draftFor(dep);
    if (!code) { setError('Pick a reservation first.'); return; }
    setBusyId(dep.id); setError(null);
    try {
      const res = await fetch(`/api/bank-deposits/${dep.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'attribute', reservation_code: code, label }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setItems(prev => (prev || []).filter(d => d.id !== dep.id));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(dep: Deposit) {
    setBusyId(dep.id); setError(null);
    try {
      const res = await fetch(`/api/bank-deposits/${dep.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Dismiss failed');
      setItems(prev => (prev || []).filter(d => d.id !== dep.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dismiss failed');
    } finally {
      setBusyId(null);
    }
  }

  if (!items || items.length === 0) return null;

  return (
    <div style={{ marginTop: 28 }}>
      <div className="eyebrow" style={{ marginBottom: 10, color: 'var(--signal)' }}>
        Unattributed deposits · {items.length}
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 8, lineHeight: 1.5, maxWidth: 720 }}>
        Bank deposits we couldn&rsquo;t auto-match to a reservation. Attribute as an add-on (fee-bearing
        revenue, e.g. a pet fee charged through Airbnb after booking) or dismiss as not-revenue
        (refunds, transfers).
      </div>
      {items.map(dep => {
        const d = draftFor(dep);
        const busy = busyId === dep.id;
        return (
          <div key={dep.id} style={{
            padding: '10px 14px', marginBottom: 8, background: 'var(--paper-2)',
            borderLeft: '3px solid var(--signal)', display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <div className="flex items-baseline flex-wrap" style={{ gap: 10, fontSize: 12, color: 'var(--ink-2)' }}>
              <span className="font-mono" style={{ color: 'var(--ink-3)' }}>{fmtDate(dep.deposit_date)}</span>
              <span style={{ textTransform: 'uppercase', fontSize: 9, letterSpacing: '.14em', color: 'var(--ink-4)' }}>{dep.source}</span>
              <span className="font-serif tabular-nums" style={{ fontSize: 14, color: 'var(--ink)' }}>{fmtMoney(Number(dep.amount))}</span>
              <span style={{ color: 'var(--ink-4)', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }} title={dep.description || ''}>
                {(dep.description || '').slice(0, 60)}
              </span>
            </div>
            <div className="flex items-center flex-wrap" style={{ gap: 8 }}>
              <input
                type="text"
                value={d.label}
                onChange={(e) => setDraft(dep.id, { label: e.target.value })}
                disabled={busy}
                placeholder="Add-on label"
                style={{ border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', padding: '4px 8px', fontSize: 12, width: 140 }}
              />
              <span style={{ fontSize: 10, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '.14em' }}>to</span>
              <select
                value={d.code}
                onChange={(e) => setDraft(dep.id, { code: e.target.value })}
                disabled={busy}
                style={{ border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', padding: '4px 8px', fontSize: 12 }}
              >
                {reservations.filter(r => r.confirmation_code).map(r => (
                  <option key={r.confirmation_code!} value={r.confirmation_code!}>{r.guest_name || r.confirmation_code}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => attribute(dep)}
                disabled={busy || !d.code}
                style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
                  color: 'var(--paper)', background: 'var(--ink)', border: '1px solid var(--ink)',
                  padding: '5px 10px', cursor: busy ? 'wait' : 'pointer', opacity: !d.code ? 0.5 : 1,
                }}
              >
                {busy ? 'Saving…' : '+ Add to revenue'}
              </button>
              <button
                type="button"
                onClick={() => dismiss(dep)}
                disabled={busy}
                style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
                  color: 'var(--ink-3)', background: 'transparent', border: '1px solid var(--rule)',
                  padding: '5px 10px', cursor: busy ? 'wait' : 'pointer',
                }}
              >
                Not revenue
              </button>
            </div>
          </div>
        );
      })}
      {error && <div style={{ marginTop: 4, fontSize: 11, color: 'var(--negative, #b13b2a)' }}>{error}</div>}
    </div>
  );
}
