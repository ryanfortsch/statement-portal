'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { computeNightsInMonthSplit, type Installment, type InstallmentDraft } from '@/lib/installments';

/**
 * Inline editor for a cross-month booking's installment split.
 *
 * Opens as a modal anchored to the booking. Pre-populates the per-month
 * allocation using nights-in-month proration (per Dotti, 2026-06-01).
 * Every cell is editable; a live "Sum: $X / $Y" indicator stays red
 * until the entered total exactly matches the booking's adjusted_revenue.
 * Save calls /api/installments POST (atomic replace).
 */

export type CrossMonthBooking = {
  confirmation_code: string;
  property_id: string;
  guest_name: string;
  check_in: string;        // 'YYYY-MM-DD'
  check_out: string;       // 'YYYY-MM-DD'
  nights: number;
  /** The booking's full pre-mgmt-fee, post-Stripe-fee net to be split. */
  adjusted_revenue: number;
  channel: string | null;
  // Breakdown shown in the editor's "Booking breakdown" panel so the
  // operator can see where adjusted_revenue came from. Optional --
  // omit and the panel just doesn't render.
  total_paid?: number | null;
  total_taxes?: number | null;
  channel_commission?: number | null;
  stripe_fee_estimate?: number | null;
};

type VerifyResponse = {
  guesty: { total_paid: number; total_taxes: number; channel_commission: number; owner_net_revenue_guesty: number; channel: string | null };
  stripe: { total: number; charge_id: string; description: string | null; match_method: string } | null;
  stripe_status: 'matched' | 'no_key' | 'wrong_channel' | 'no_match' | 'error';
  stripe_note: string | null;
};

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function monthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function InstallmentEditor({
  booking, open, onClose,
}: {
  booking: CrossMonthBooking;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<InstallmentDraft[]>([]);
  const [existing, setExisting] = useState<Installment[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Editable split target. Defaults to the computed adjusted_revenue;
  // the operator can override if Guesty's number is stale (the Hancock
  // glitch case) without leaving the editor to re-sync.
  const [targetRev, setTargetRev] = useState<number>(Number(booking.adjusted_revenue) || 0);
  // Stripe verification (only Stripe-channel bookings).
  const [verify, setVerify] = useState<VerifyResponse | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);

  const totalRev = targetRev;
  const sum = drafts.reduce((s, d) => s + (Number(d.installment_revenue) || 0), 0);
  const sumCents = Math.round(sum * 100);
  const targetCents = Math.round(totalRev * 100);
  const exact = sumCents === targetCents;

  // Load any existing split (from a prior save) or pre-fill via the
  // nights-in-month default helper.
  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/installments?confirmation_code=${encodeURIComponent(booking.confirmation_code)}`);
      const data = await res.json();
      const exist = (data.installments || []) as Installment[];
      setExisting(exist);
      if (exist.length > 0) {
        setDrafts(exist.map(e => ({
          month: e.month,
          installment_nights: e.installment_nights ?? 0,
          installment_revenue: Number(e.installment_revenue) || 0,
          is_final_month: !!e.is_final_month,
        })));
      } else {
        setDrafts(computeNightsInMonthSplit({
          checkInIso: booking.check_in,
          checkOutIso: booking.check_out,
          totalNights: booking.nights,
          totalRevenue: totalRev,
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, [booking.confirmation_code, booking.check_in, booking.check_out, booking.nights, totalRev]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (open) load(); }, [open, load]);

  // Stripe cross-check on open. Surfaces silently when the property has
  // no key or this isn't a Stripe-channel booking; loudly when Stripe
  // disagrees with Guesty (the "Hancock glitch" signal). The eslint
  // disable matches the same fetch-on-mount pattern used elsewhere in
  // this file -- the rule is intended for unconditional setState during
  // render, not async data loaders.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setVerifyLoading(true);
    setVerify(null);
    fetch(`/api/installments/verify-source?confirmation_code=${encodeURIComponent(booking.confirmation_code)}&property_id=${encodeURIComponent(booking.property_id)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setVerify(d as VerifyResponse); })
      .catch(() => { /* swallow -- the panel just won't render */ })
      .finally(() => { if (!cancelled) setVerifyLoading(false); });
    return () => { cancelled = true; };
  }, [open, booking.confirmation_code, booking.property_id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function setRevenue(idx: number, raw: string) {
    setDrafts(prev => prev.map((d, i) => i === idx ? { ...d, installment_revenue: Number(raw.replace(/[^0-9.\-]/g, '')) || 0 } : d));
  }
  function setFinalMonth(idx: number) {
    setDrafts(prev => prev.map((d, i) => ({ ...d, is_final_month: i === idx })));
  }
  function rebalanceToFinal() {
    // Snap revenue residue onto the marked final-month installment so
    // the sum equals the target exactly. Useful after manual edits.
    setDrafts(prev => {
      const finalIdx = prev.findIndex(d => d.is_final_month);
      if (finalIdx === -1) return prev;
      const others = prev.reduce((s, d, i) => i === finalIdx ? s : s + (Number(d.installment_revenue) || 0), 0);
      const residue = Math.round((totalRev - others) * 100) / 100;
      return prev.map((d, i) => i === finalIdx ? { ...d, installment_revenue: residue } : d);
    });
  }
  function resetToNightsInMonth() {
    setDrafts(computeNightsInMonthSplit({
      checkInIso: booking.check_in,
      checkOutIso: booking.check_out,
      totalNights: booking.nights,
      totalRevenue: totalRev,
    }));
  }
  function applyTargetFromStripe() {
    // Pull Stripe's actual amount into the target field, then re-pro-rate
    // a Stripe fee on it to get the post-fee net the operator should split.
    if (!verify?.stripe) return;
    const stripeGross = verify.stripe.total;
    const stripeFeeEst = Math.round((stripeGross * 0.039 + 0.40) * 100) / 100;
    const taxes = verify.guesty.total_taxes;
    const commission = verify.guesty.channel_commission;
    const net = Math.round((stripeGross - taxes - commission - stripeFeeEst) * 100) / 100;
    setTargetRev(net);
    setDrafts(computeNightsInMonthSplit({
      checkInIso: booking.check_in,
      checkOutIso: booking.check_out,
      totalNights: booking.nights,
      totalRevenue: net,
    }));
  }

  async function save() {
    if (!exact) { setError(`Sum must equal $${fmt(totalRev)} (currently $${fmt(sum)})`); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/installments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          confirmation_code: booking.confirmation_code,
          property_id: booking.property_id,
          installments: drafts.map(d => ({
            month: d.month,
            installment_revenue: d.installment_revenue,
            installment_nights: d.installment_nights,
            is_final_month: d.is_final_month,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function clearSplit() {
    if (!confirm(`Remove the installment split for ${booking.guest_name}? The booking will recognize entirely in its checkout month, like a normal stay.`)) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/installments?confirmation_code=${encodeURIComponent(booking.confirmation_code)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Clear failed');
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clear failed');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const hasExisting = (existing?.length ?? 0) > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(20, 25, 30, 0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--paper)', color: 'var(--ink)',
          maxWidth: 640, width: '100%', maxHeight: '90vh', overflow: 'auto',
          border: '1px solid var(--ink)', padding: '24px 28px',
        }}
      >
        <div style={{ marginBottom: 18 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Installment split</div>
          <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 500, margin: 0, lineHeight: 1.2 }}>
            {booking.guest_name}
          </h2>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>
            {booking.check_in} → {booking.check_out} &middot; {booking.nights} nights &middot; {booking.channel || 'Direct'} &middot; <span className="tabular-nums">${fmt(totalRev)}</span> total
          </div>
        </div>

        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12, lineHeight: 1.5 }}>
          Split this booking&rsquo;s revenue across the calendar months it spans. The default
          is nights-in-month proration; every cell is editable. The owner&rsquo;s monthly statements
          will reflect the per-month allocation. Cleaning and repairs still attach to the
          checkout month only.
        </div>

        {/* Booking breakdown -- shows the operator exactly where the
            split target came from, with a Stripe cross-check below. */}
        {(booking.total_paid != null || verify) && (
          <div style={{ border: '1px solid var(--rule)', background: 'var(--paper-2)', padding: '10px 14px', marginBottom: 14 }}>
            <div className="eyebrow" style={{ marginBottom: 8, color: 'var(--ink-3)' }}>Booking breakdown</div>
            <div style={{ fontSize: 12, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 14, rowGap: 4 }}>
              {booking.total_paid != null && (
                <>
                  <span style={{ color: 'var(--ink-3)' }}>Guesty total paid</span>
                  <span className="tabular-nums" style={{ textAlign: 'right' }}>${fmt(Number(booking.total_paid))}</span>
                </>
              )}
              {booking.total_taxes != null && booking.total_taxes > 0 && (
                <>
                  <span style={{ color: 'var(--ink-3)' }}>Taxes</span>
                  <span className="tabular-nums" style={{ textAlign: 'right' }}>&minus; ${fmt(Number(booking.total_taxes))}</span>
                </>
              )}
              {booking.channel_commission != null && booking.channel_commission > 0 && (
                <>
                  <span style={{ color: 'var(--ink-3)' }}>Channel commission</span>
                  <span className="tabular-nums" style={{ textAlign: 'right' }}>&minus; ${fmt(Number(booking.channel_commission))}</span>
                </>
              )}
              {booking.stripe_fee_estimate != null && booking.stripe_fee_estimate > 0 && (
                <>
                  <span style={{ color: 'var(--ink-3)' }}>Stripe fee (est.)</span>
                  <span className="tabular-nums" style={{ textAlign: 'right' }}>&minus; ${fmt(Number(booking.stripe_fee_estimate))}</span>
                </>
              )}
              <span style={{ color: 'var(--ink)', fontWeight: 600, borderTop: '1px solid var(--rule-soft)', paddingTop: 4 }}>
                Total to split
              </span>
              <span style={{ textAlign: 'right', borderTop: '1px solid var(--rule-soft)', paddingTop: 4 }}>
                <input
                  type="text"
                  inputMode="decimal"
                  value={targetRev.toFixed(2)}
                  onChange={(e) => {
                    const v = Number(e.target.value.replace(/[^0-9.\-]/g, '')) || 0;
                    setTargetRev(v);
                  }}
                  onBlur={() => {
                    // Re-pro-rate the per-month split to the new target
                    setDrafts(computeNightsInMonthSplit({
                      checkInIso: booking.check_in,
                      checkOutIso: booking.check_out,
                      totalNights: booking.nights,
                      totalRevenue: targetRev,
                    }));
                  }}
                  disabled={busy}
                  style={{
                    border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)',
                    padding: '3px 6px', fontSize: 13, width: 110, textAlign: 'right',
                    fontFamily: 'var(--font-mono, monospace)', fontWeight: 600,
                  }}
                />
              </span>
            </div>

            {/* Stripe cross-check. Loud signal when Stripe disagrees with
                Guesty -- the Hancock-style glitch case. */}
            {verifyLoading && (
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-4)' }}>Checking Stripe...</div>
            )}
            {verify && verify.stripe && (() => {
              const stripeTotal = verify.stripe!.total;
              const guestyTotal = verify.guesty.total_paid;
              const diff = Math.round((stripeTotal - guestyTotal) * 100) / 100;
              const matches = Math.abs(diff) <= 5;
              return (
                <div style={{
                  marginTop: 10, paddingTop: 8, borderTop: '1px dotted var(--rule-soft)',
                  fontSize: 11, color: matches ? 'var(--positive, #2f6f3f)' : 'var(--signal)',
                  lineHeight: 1.5,
                }}>
                  <strong>Stripe actual:</strong> <span className="tabular-nums">${fmt(stripeTotal)}</span>
                  {' '}{matches
                    ? <>&middot; matches Guesty ✓</>
                    : <>&middot; differs from Guesty by ${fmt(Math.abs(diff))} {diff > 0 ? '(Stripe higher)' : '(Guesty higher)'} &mdash; consider re-syncing Guesty before splitting.</>}
                  {!matches && (
                    <button
                      type="button"
                      onClick={applyTargetFromStripe}
                      disabled={busy}
                      style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)', background: 'transparent', border: '1px solid var(--rule)', padding: '3px 8px', cursor: 'pointer' }}
                    >
                      Use Stripe number
                    </button>
                  )}
                </div>
              );
            })()}
            {verify && !verify.stripe && verify.stripe_status !== 'wrong_channel' && (
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dotted var(--rule-soft)', fontSize: 11, color: 'var(--ink-4)' }}>
                Stripe cross-check: {verify.stripe_note}
              </div>
            )}
          </div>
        )}

        <table className="w-full tabular-nums" style={{ borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)', borderBottom: '1px solid var(--rule)' }}>
              <th style={{ textAlign: 'left', padding: '8px 6px' }}>Month</th>
              <th style={{ textAlign: 'right', padding: '8px 6px' }}>Nights</th>
              <th style={{ textAlign: 'right', padding: '8px 6px' }}>Revenue</th>
              <th style={{ textAlign: 'center', padding: '8px 6px' }}>Final</th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((d, i) => (
              <tr key={d.month} style={{ borderBottom: '1px dotted var(--rule-soft)' }}>
                <td style={{ padding: '8px 6px', fontFamily: 'var(--font-fraunces)' }}>{monthLabel(d.month)}</td>
                <td style={{ padding: '8px 6px', textAlign: 'right', color: 'var(--ink-3)' }}>{d.installment_nights}</td>
                <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={d.installment_revenue.toFixed(2)}
                    onChange={(e) => setRevenue(i, e.target.value)}
                    onBlur={(e) => setRevenue(i, e.target.value)}
                    disabled={busy}
                    style={{
                      border: '1px solid var(--rule)', background: 'var(--paper-2)', color: 'var(--ink)',
                      padding: '4px 8px', fontSize: 13, width: 110, textAlign: 'right',
                      fontFamily: 'var(--font-mono, monospace)',
                    }}
                  />
                </td>
                <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                  <input
                    type="radio"
                    name="final_month"
                    checked={d.is_final_month}
                    onChange={() => setFinalMonth(i)}
                    disabled={busy}
                    title="Mark this as the checkout month -- cleaning, repairs, and the stay count attach here"
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '1.5px solid var(--ink)', fontWeight: 600 }}>
              <td style={{ padding: '10px 6px' }}>Sum</td>
              <td style={{ padding: '10px 6px', textAlign: 'right', color: 'var(--ink-3)' }}>
                {drafts.reduce((s, d) => s + (d.installment_nights || 0), 0)}
              </td>
              <td style={{ padding: '10px 6px', textAlign: 'right', color: exact ? 'var(--positive, #2f6f3f)' : 'var(--signal)' }}>
                ${fmt(sum)} <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>/ ${fmt(totalRev)}</span>
              </td>
              <td />
            </tr>
          </tfoot>
        </table>

        {!exact && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--signal)' }}>
            Sum is ${fmt(Math.abs(sum - totalRev))} {sum > totalRev ? 'over' : 'short of'} the booking total.
            <button
              type="button"
              onClick={rebalanceToFinal}
              disabled={busy}
              style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)', background: 'transparent', border: '1px solid var(--rule)', padding: '3px 8px', cursor: 'pointer' }}
            >
              Snap residue to final month
            </button>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--negative, #b13b2a)' }}>{error}</div>
        )}

        <div className="flex items-center justify-between" style={{ marginTop: 22, gap: 12, flexWrap: 'wrap' }}>
          <div className="flex items-center" style={{ gap: 8 }}>
            <button
              type="button"
              onClick={resetToNightsInMonth}
              disabled={busy}
              title="Re-populate using the default nights-in-month proration"
              style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)', background: 'transparent', border: '1px solid var(--rule)', padding: '6px 10px', cursor: 'pointer' }}
            >
              Reset to default
            </button>
            {hasExisting && (
              <button
                type="button"
                onClick={clearSplit}
                disabled={busy}
                style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--negative, #b13b2a)', background: 'transparent', border: '1px solid var(--negative, #b13b2a)', padding: '6px 10px', cursor: 'pointer' }}
              >
                Remove split
              </button>
            )}
          </div>
          <div className="flex items-center" style={{ gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)', background: 'transparent', border: '1px solid var(--rule)', padding: '7px 14px', cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy || !exact}
              style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase',
                color: exact ? 'var(--paper)' : 'var(--ink-3)',
                background: exact ? 'var(--ink)' : 'var(--paper-2)',
                border: '1px solid var(--ink)',
                padding: '7px 16px', cursor: busy || !exact ? 'not-allowed' : 'pointer',
              }}
            >
              {busy ? 'Saving…' : (hasExisting ? 'Update split' : 'Save split')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
