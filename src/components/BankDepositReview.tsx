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
  // 'deposit' = credit on the bank statement (potential add-on revenue);
  // 'debit'   = charge that came out of the property's account (potential
  //             repair / maintenance / reimbursement -- e.g. the $49.99
  //             trash-can transfer to RT operating).
  direction: 'deposit' | 'debit';
  status: 'pending' | 'attributed' | 'dismissed';
  attributed_reservation_code: string | null;
  label: string | null;
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

/**
 * Default label for a one-off Stripe payment-link charge, inferred from
 * the description the operator typed into the link. Best-effort -- the
 * label field stays editable either way.
 */
function inferStripeLabel(description: string | null): string {
  const d = (description || '').toLowerCase();
  if (/early\s*check/.test(d)) return 'Early check-in';
  if (/late\s*check/.test(d)) return 'Late checkout';
  if (/extra\s*(night|day)|extension|extend|added?\s*(night|day)/.test(d)) return 'Extra night';
  if (/pet\s*fee|\bpet\b|\bdog\b/.test(d)) return 'Pet fee';
  return 'Add-on';
}

export function BankDepositReview({
  propertyId, month, reservations, refreshToken = 0,
}: {
  propertyId: string;
  month: string;
  reservations: ReservationOption[];
  // Bump to force a refetch (the dashboard increments it on every period
  // reload so charges queued by a just-finished sync appear immediately).
  refreshToken?: number;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Deposit[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { label: string; code: string }>>({});
  // Collapsed by default so the queue doesn't dominate the property card.
  // Click the header to expand the review list. Three independent toggles
  // for deposits-pending / debits-pending / already-attributed.
  const [expanded, setExpanded] = useState(false);
  const [debitsExpanded, setDebitsExpanded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    // Pull pending + attributed (skip dismissed). Pending → review queue;
    // attributed → "Already attributed · N" history block with an Undo
    // button so a mis-attribution can be reverted without a DB hack.
    const { data, error: e } = await supabase
      .from('bank_deposit_attributions')
      .select('id, deposit_date, amount, description, source, suggested_reservation_code, direction, status, attributed_reservation_code, label')
      .eq('property_id', propertyId)
      .eq('month', month)
      .in('status', ['pending', 'attributed'])
      .order('deposit_date', { ascending: true });
    if (e && e.code !== 'PGRST205' && !/does not exist|relation|Could not find the table|direction/i.test(e.message || '')) {
      setError(e.message);
      return;
    }
    setItems(((data || []) as Deposit[]).map(d => ({ ...d, direction: d.direction || 'deposit' })));
  }, [propertyId, month, refreshToken]);

  // Initial load + refresh when month/property changes. eslint disable here
  // matches the same pattern used elsewhere in this file.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const validCodes = reservations.map(r => r.confirmation_code).filter((c): c is string => !!c);
  function draftFor(dep: Deposit) {
    const d = drafts[dep.id];
    if (d) return d;
    const initial = {
      label: dep.source === 'stripe_charge' ? inferStripeLabel(dep.description) : 'Add-on',
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
    // Deposits MUST pick a reservation (the credit ties to a specific
    // stay's revenue). Debits don't have to -- the trash-can reimbursement
    // is a property-level expense, not tied to a guest. Also require a
    // non-default label on debits so the audit trail says what it was.
    if (dep.direction === 'deposit' && !code) {
      setError('Pick a reservation first.'); return;
    }
    if (dep.direction === 'debit' && (!label || label === 'Add-on')) {
      setError('Describe the charge (e.g. "Trash can reimbursement").'); return;
    }
    setBusyId(dep.id); setError(null);
    try {
      const res = await fetch(`/api/bank-deposits/${dep.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'attribute', reservation_code: code || null, label }),
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

  async function unattribute(dep: Deposit) {
    // Revert a mis-attributed row back to pending so the operator can
    // re-do it with the right reservation / label. Recompute on the
    // server fixes add_ons_revenue / attributed_debits_total + owner_payout.
    setBusyId(dep.id); setError(null);
    try {
      const res = await fetch(`/api/bank-deposits/${dep.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'unattribute' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Undo failed');
      // Flip in place: clear attribution and move back to pending.
      setItems(prev => (prev || []).map(d => d.id === dep.id ? { ...d, status: 'pending', attributed_reservation_code: null, label: null } : d));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Undo failed');
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

  const pending = (items || []).filter(i => i.status === 'pending');
  const deposits = pending.filter(i => i.direction === 'deposit');
  const debits = pending.filter(i => i.direction === 'debit');
  const attributed = (items || []).filter(i => i.status === 'attributed');
  // Map a reservation code -> human guest name for the attributed history.
  const guestByCode = new Map<string, string>();
  reservations.forEach(r => { if (r.confirmation_code) guestByCode.set(r.confirmation_code, r.guest_name); });
  if (deposits.length === 0 && debits.length === 0 && attributed.length === 0) return null;

  return (
    <div style={{ marginTop: 28 }}>
      {deposits.length > 0 && (
        <div style={{ marginBottom: debits.length > 0 ? 18 : 0 }}>
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="flex items-baseline justify-between w-full"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px 0',
              textAlign: 'left', borderBottom: expanded ? '1px solid var(--rule-soft)' : 'none',
              marginBottom: expanded ? 10 : 0,
            }}
            aria-expanded={expanded}
          >
            <span className="eyebrow" style={{ color: 'var(--signal)' }}>
              Unattributed deposits &middot; {deposits.length}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
              {expanded ? 'Hide −' : 'Review +'}
            </span>
          </button>
          {expanded && (
            <>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 8, lineHeight: 1.5, maxWidth: 720 }}>
                Money that reached this property outside a reservation&rsquo;s normal payment: bank
                deposits we couldn&rsquo;t auto-match, plus one-off Stripe payment-link charges (early
                check-in, extra night, pet fee). Attribute to the guest&rsquo;s stay as add-on revenue
                (management fee applies) or dismiss as not-revenue (refunds, transfers). Stripe
                amounts are net of the real processing fee.
              </div>
              {deposits.map(dep => {
                const d = draftFor(dep);
                const busy = busyId === dep.id;
                return (
                  <div key={dep.id} style={{
                    padding: '10px 14px', marginBottom: 8, background: 'var(--paper-2)',
                    borderLeft: '3px solid var(--signal)', display: 'flex', flexDirection: 'column', gap: 8,
                  }}>
                    <div className="flex items-baseline flex-wrap" style={{ gap: 10, fontSize: 12, color: 'var(--ink-2)' }}>
                      <span className="font-mono" style={{ color: 'var(--ink-3)' }}>{fmtDate(dep.deposit_date)}</span>
                      <span style={{ textTransform: 'uppercase', fontSize: 9, letterSpacing: '.14em', color: 'var(--ink-4)' }}>{dep.source === 'stripe_charge' ? 'stripe link' : dep.source}</span>
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
                      <button type="button" onClick={() => attribute(dep)} disabled={busy || !d.code}
                        style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--paper)', background: 'var(--ink)', border: '1px solid var(--ink)', padding: '5px 10px', cursor: busy ? 'wait' : 'pointer', opacity: !d.code ? 0.5 : 1 }}>
                        {busy ? 'Saving…' : '+ Add to revenue'}
                      </button>
                      <button type="button" onClick={() => dismiss(dep)} disabled={busy}
                        style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)', background: 'transparent', border: '1px solid var(--rule)', padding: '5px 10px', cursor: busy ? 'wait' : 'pointer' }}>
                        Not revenue
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {debits.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setDebitsExpanded(e => !e)}
            className="flex items-baseline justify-between w-full"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px 0',
              textAlign: 'left', borderBottom: debitsExpanded ? '1px solid var(--rule-soft)' : 'none',
              marginBottom: debitsExpanded ? 10 : 0,
            }}
            aria-expanded={debitsExpanded}
          >
            <span className="eyebrow" style={{ color: 'var(--signal)' }}>
              Unattributed charges &middot; {debits.length}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
              {debitsExpanded ? 'Hide −' : 'Review +'}
            </span>
          </button>
          {debitsExpanded && (
            <>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 8, lineHeight: 1.5, maxWidth: 720 }}>
                Outgoing charges we couldn&rsquo;t auto-match to a known cleaning / linen / repair
                vendor. Attribute as a property expense (e.g. an Online Transfer to RT operating that
                reimbursed RT for a trash can on the corporate card -- flows into the &quot;Repairs&quot;
                bucket on the owner statement) or dismiss as not-an-expense (internal sweeps, etc).
              </div>
              {debits.map(dep => {
                const d = draftFor(dep);
                const busy = busyId === dep.id;
                return (
                  <div key={dep.id} style={{
                    padding: '10px 14px', marginBottom: 8, background: 'var(--paper-2)',
                    borderLeft: '3px solid var(--ink-3)', display: 'flex', flexDirection: 'column', gap: 8,
                  }}>
                    <div className="flex items-baseline flex-wrap" style={{ gap: 10, fontSize: 12, color: 'var(--ink-2)' }}>
                      <span className="font-mono" style={{ color: 'var(--ink-3)' }}>{fmtDate(dep.deposit_date)}</span>
                      <span style={{ textTransform: 'uppercase', fontSize: 9, letterSpacing: '.14em', color: 'var(--ink-4)' }}>charge</span>
                      <span className="font-serif tabular-nums" style={{ fontSize: 14, color: 'var(--ink)' }}>−{fmtMoney(Number(dep.amount))}</span>
                      <span style={{ color: 'var(--ink-4)', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }} title={dep.description || ''}>
                        {(dep.description || '').slice(0, 60)}
                      </span>
                    </div>
                    <div className="flex items-center flex-wrap" style={{ gap: 8 }}>
                      <input
                        type="text"
                        value={d.label === 'Add-on' ? '' : d.label}
                        onChange={(e) => setDraft(dep.id, { label: e.target.value })}
                        disabled={busy}
                        placeholder="e.g. Trash can reimbursement"
                        style={{ border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', padding: '4px 8px', fontSize: 12, width: 220 }}
                      />
                      <button type="button" onClick={() => attribute(dep)} disabled={busy}
                        style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--paper)', background: 'var(--ink)', border: '1px solid var(--ink)', padding: '5px 10px', cursor: busy ? 'wait' : 'pointer' }}>
                        {busy ? 'Saving…' : '− Add as expense'}
                      </button>
                      <button type="button" onClick={() => dismiss(dep)} disabled={busy}
                        style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)', background: 'transparent', border: '1px solid var(--rule)', padding: '5px 10px', cursor: busy ? 'wait' : 'pointer' }}>
                        Not an expense
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {attributed.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <button
            type="button"
            onClick={() => setHistoryExpanded(e => !e)}
            className="flex items-baseline justify-between w-full"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px 0',
              textAlign: 'left', borderBottom: historyExpanded ? '1px solid var(--rule-soft)' : 'none',
              marginBottom: historyExpanded ? 10 : 0,
            }}
            aria-expanded={historyExpanded}
          >
            <span className="eyebrow" style={{ color: 'var(--ink-3)' }}>
              Already attributed &middot; {attributed.length}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
              {historyExpanded ? 'Hide −' : 'Show +'}
            </span>
          </button>
          {historyExpanded && (
            <>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 8, lineHeight: 1.5, maxWidth: 720 }}>
                Bank rows you&rsquo;ve already attributed this month. Undo any that point at the wrong
                guest or label -- the row drops back into the queue above so you can re-do it.
              </div>
              {attributed.map(dep => {
                const busy = busyId === dep.id;
                const guest = dep.attributed_reservation_code ? (guestByCode.get(dep.attributed_reservation_code) || dep.attributed_reservation_code) : null;
                const sign = dep.direction === 'debit' ? '−' : '+';
                return (
                  <div key={dep.id} style={{
                    padding: '8px 14px', marginBottom: 6, background: 'var(--paper-2)',
                    borderLeft: '3px solid var(--rule)', display: 'flex', alignItems: 'baseline',
                    gap: 10, flexWrap: 'wrap', fontSize: 12,
                  }}>
                    <span className="font-mono" style={{ color: 'var(--ink-3)' }}>{fmtDate(dep.deposit_date)}</span>
                    <span className="font-serif tabular-nums" style={{ fontSize: 13, color: 'var(--ink)' }}>{sign}{fmtMoney(Number(dep.amount))}</span>
                    <span style={{ color: 'var(--ink-2)' }}>
                      {dep.label || (dep.direction === 'debit' ? 'Reimbursement' : 'Add-on')}
                      {guest && <> &nbsp;&middot;&nbsp; <span style={{ fontFamily: 'var(--font-fraunces)' }}>{guest}</span></>}
                    </span>
                    <span style={{ flex: 1 }} />
                    <button
                      type="button"
                      onClick={() => unattribute(dep)}
                      disabled={busy}
                      title="Move back to the pending queue"
                      style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
                        color: 'var(--ink-3)', background: 'transparent', border: '1px solid var(--rule)',
                        padding: '4px 10px', cursor: busy ? 'wait' : 'pointer',
                      }}
                    >
                      {busy ? '…' : 'Undo'}
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {error && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--negative, #b13b2a)' }}>{error}</div>}
    </div>
  );
}
