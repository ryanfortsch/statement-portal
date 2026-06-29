'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { InstallmentEditor, type CrossMonthBooking } from '@/components/InstallmentEditor';
import type { Installment } from '@/lib/installments';

/**
 * Cross-month bookings surface on /properties/[id].
 *
 * Lists every upcoming reservation at this property whose stay spans
 * 2+ calendar months. For each, shows an inline action to split the
 * booking's revenue across the months it occupies (the editor in
 * `InstallmentEditor`). Bookings that fit inside a single month don't
 * appear -- the existing checkout-month flow already handles them
 * correctly.
 *
 * Hidden entirely when this property has no qualifying bookings -- no
 * blank header taking up vertical space on properties without long
 * stays on the books.
 */

type GuestyRow = {
  confirmation_code: string;
  guest_name: string | null;
  check_in: string;
  check_out: string;
  nights: number | null;
  channel: string | null;
  guesty_channel_id: string | null;
  total_paid: number | null;
  total_taxes: number | null;
  channel_commission: number | null;
  owner_net_revenue_guesty: number | null;
};

// 30-night minimum: short bookings that happen to straddle a month
// boundary (e.g. Aug 28 → Sep 5) don't justify the operator overhead of
// a 2-month split. Long stays (1+ month residencies) are where the
// "owner can't see any revenue until checkout" friction actually bites.
const MIN_NIGHTS_FOR_INSTALLMENT = 30;

function qualifiesForInstallment(checkIn: string, checkOut: string, nights: number | null): boolean {
  if (!checkIn || !checkOut) return false;
  if ((nights || 0) < MIN_NIGHTS_FOR_INSTALLMENT) return false;
  // Check-out is the morning the guest leaves, not a paid night. The
  // stay's LAST PAID night is check_out - 1 day. If that night and the
  // check-in night are in different calendar months, the booking spans
  // multiple months.
  const lastNight = new Date(checkOut + 'T00:00:00Z');
  lastNight.setUTCDate(lastNight.getUTCDate() - 1);
  const ci = checkIn.slice(0, 7);
  const lastNightMonth = lastNight.toISOString().slice(0, 7);
  return ci !== lastNightMonth;
}

/**
 * Strip the legacy 4.4% commission kludge -- a duplicate of the helper
 * in /api/ingest. Pre-overhaul, Ryan/Dotti added 4.4% to CHANNEL
 * COMMISSION in Guesty so the PDF would approximate the post-Stripe
 * owner net. Bookings before the fix landed still carry the inflated
 * value (e.g. Hancock at $32,000 has commission=$1,408 -- exactly 4.4%
 * -- on a Manual booking where the real commission is 0). Without this,
 * the editor's breakdown overstates the deduction and lands on
 * $29,343.60 instead of the correct $30,751.60.
 */
function effectiveCommission(platform: string, totalPaid: number, taxes: number, commission: number): number {
  if (!commission || commission <= 0) return 0;
  const base = Math.max(totalPaid - taxes, 0);
  if (base <= 0) return commission;
  const ratio = commission / base;
  const p = platform.toUpperCase();
  if (p === 'MANUAL' || p === 'DIRECT') {
    // Real Manual/Direct commission = 0. Anything above 2% is the kludge.
    return ratio > 0.02 ? 0 : commission;
  }
  if (p.includes('HOMEAWAY') || p === 'VRBO') {
    // Real VRBO commission = 5%. Above 7% has the 4.4% kludge stacked
    // on top -- restore the underlying 5%.
    return ratio > 0.07 ? Math.round(base * 0.05 * 100) / 100 : commission;
  }
  // Airbnb / Booking.com handle commission themselves -- never kludged.
  return commission;
}

function computeAdjustedRevenue(g: GuestyRow): number {
  // Mirrors the recognition math in /api/ingest exactly, including the
  // legacy commission kludge stripping. The operator can still edit the
  // result in the modal if Guesty has stale data.
  const platform = (g.channel || g.guesty_channel_id || '').toLowerCase();
  const isStripe = platform.includes('homeaway') || platform === 'vrbo' || platform === 'manual' || platform === 'direct';
  const totalPaid = Number(g.total_paid || 0);

  if (isStripe && totalPaid === 0) return 0; // homeowner stay
  if (isStripe && totalPaid > 0) {
    const taxes = Number(g.total_taxes || 0);
    const rawCommission = Number(g.channel_commission || 0);
    const commission = effectiveCommission(platform, totalPaid, taxes, rawCommission);
    const stripeFee = Math.round((totalPaid * 0.039 + 0.40) * 100) / 100;
    return Math.round((totalPaid - taxes - commission - stripeFee) * 100) / 100;
  }
  // Airbnb / Booking.com: prefer Guesty's accounting net if present.
  const ownerNet = Number(g.owner_net_revenue_guesty || 0);
  if (ownerNet > 0) return ownerNet;
  if (totalPaid > 0) {
    return Math.round((totalPaid - Number(g.total_taxes || 0) - Number(g.channel_commission || 0)) * 100) / 100;
  }
  return 0;
}

function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function MultiMonthBookingsSection({ propertyId }: { propertyId: string }) {
  const [bookings, setBookings] = useState<GuestyRow[] | null>(null);
  const [splitsByCode, setSplitsByCode] = useState<Map<string, Installment[]>>(new Map());
  const [editingCode, setEditingCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const { data: rows } = await supabase
      .from('guesty_reservations')
      .select('confirmation_code, guest_name, check_in, check_out, nights, channel, guesty_channel_id, total_paid, total_taxes, channel_commission, owner_net_revenue_guesty')
      .eq('property_id', propertyId)
      .gte('check_out', todayIso)
      .order('check_in', { ascending: true });
    const filtered = ((rows || []) as GuestyRow[])
      .filter(r => qualifiesForInstallment(r.check_in, r.check_out, r.nights));
    setBookings(filtered);

    if (filtered.length > 0) {
      const codes = filtered.map(r => r.confirmation_code).filter(Boolean);
      const { data: installRows } = await supabase
        .from('reservation_installments')
        .select('id, confirmation_code, property_id, month, installment_revenue, installment_nights, is_final_month, note, created_at, updated_at')
        .in('confirmation_code', codes);
      const m = new Map<string, Installment[]>();
      ((installRows || []) as Installment[]).forEach(r => {
        const list = m.get(r.confirmation_code) || [];
        list.push(r);
        m.set(r.confirmation_code, list);
      });
      setSplitsByCode(m);
    }
  }, [propertyId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  if (bookings === null) return null; // still loading -- render nothing rather than a flash
  if (bookings.length === 0) return null; // no qualifying bookings on this property

  const editingBooking = editingCode
    ? bookings.find(b => b.confirmation_code === editingCode)
    : null;

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 24, paddingBottom: 28, width: '100%' }}>
      <div className="eyebrow" style={{ marginBottom: 12, color: 'var(--signal)' }}>
        Multi-month bookings &middot; {bookings.length}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12, lineHeight: 1.5, maxWidth: 720 }}>
        Bookings that span 2+ calendar months. Without a split, owner revenue from these stays recognizes
        entirely in the checkout month. Splitting lets the owner see a partial payout each month the
        booking is occupied. Optional &mdash; bookings without a split flow through the existing single-month
        path.
      </div>

      <div style={{ border: '1px solid var(--rule)' }}>
        {bookings.map((b, idx) => {
          const adjusted = computeAdjustedRevenue(b);
          const split = splitsByCode.get(b.confirmation_code) || [];
          const isSplit = split.length > 0;
          const splitSum = split.reduce((s, i) => s + Number(i.installment_revenue || 0), 0);
          const platform = b.channel || b.guesty_channel_id || 'Direct';
          return (
            <div
              key={b.confirmation_code}
              style={{
                padding: '12px 16px',
                borderTop: idx > 0 ? '1px solid var(--rule-soft)' : 'none',
                background: idx % 2 === 0 ? 'var(--paper)' : 'var(--paper-2)',
              }}
            >
              <div className="flex items-baseline justify-between" style={{ gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                  <div className="font-serif" style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>
                    {b.guest_name || b.confirmation_code}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
                    {fmtDate(b.check_in)} &rarr; {fmtDate(b.check_out)} &middot; {b.nights} nights &middot; {platform} &middot; <span className="tabular-nums">${fmtMoney(adjusted)}</span> net
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingCode(b.confirmation_code)}
                  style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
                    color: isSplit ? 'var(--ink-3)' : 'var(--paper)',
                    background: isSplit ? 'transparent' : 'var(--ink)',
                    border: '1px solid var(--ink)',
                    padding: '7px 14px', cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  {isSplit ? 'Edit split' : 'Split into installments'}
                </button>
              </div>

              {isSplit && (
                <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dotted var(--rule-soft)', fontSize: 11, color: 'var(--ink-2)' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 4 }}>
                    Current split
                  </div>
                  <div className="flex flex-wrap" style={{ gap: 14 }}>
                    {split
                      .slice()
                      .sort((a, b) => a.month.localeCompare(b.month))
                      .map(i => (
                        <span key={i.id} className="tabular-nums">
                          {i.month}: ${fmtMoney(Number(i.installment_revenue))}
                          {i.is_final_month && <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '.08em' }}>final</span>}
                        </span>
                      ))}
                    <span style={{ color: 'var(--ink-3)' }}>
                      &middot; sum <span className="tabular-nums">${fmtMoney(splitSum)}</span>
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editingBooking && (() => {
        const totalPaid = Number(editingBooking.total_paid || 0);
        const stripeFeeEst = totalPaid > 0
          ? Math.round((totalPaid * 0.039 + 0.40) * 100) / 100
          : 0;
        return (
          <InstallmentEditor
            booking={{
              confirmation_code: editingBooking.confirmation_code,
              property_id: propertyId,
              guest_name: editingBooking.guest_name || editingBooking.confirmation_code,
              check_in: editingBooking.check_in,
              check_out: editingBooking.check_out,
              nights: editingBooking.nights || 0,
              adjusted_revenue: computeAdjustedRevenue(editingBooking),
              channel: editingBooking.channel || editingBooking.guesty_channel_id,
              total_paid: editingBooking.total_paid,
              total_taxes: editingBooking.total_taxes,
              channel_commission: editingBooking.channel_commission,
              stripe_fee_estimate: stripeFeeEst,
            } satisfies CrossMonthBooking}
            open={!!editingCode}
            onClose={() => { setEditingCode(null); load(); }}
          />
        );
      })()}
    </section>
  );
}
