import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Sync Stripe charges against our reservations as a check-and-balance on
 * the estimated Stripe fees computed during ingest.
 *
 * Rising Tide uses independent Stripe accounts per property (not a
 * Connect platform), so each property's read-only restricted key sits in
 * the STRIPE_KEYS_JSON env var keyed by property_id. Example:
 *
 *   STRIPE_KEYS_JSON={"17_beach_rd":"rk_live_...","21_horton":"rk_live_..."}
 *
 * For each property, this endpoint:
 *   1. Pulls the month's successful charges from that account's Stripe.
 *   2. Matches each charge to a reservation by description (the
 *      confirmation code is used as the Stripe charge description).
 *   3. Updates reservations.stripe_fee with the REAL fee pulled from
 *      balance_transaction.fee, and recomputes adjusted_revenue +
 *      propagates the delta into property_statements.owner_payout.
 *   4. Emits data gaps when:
 *         - Stripe shows a refund the reservations table doesn't know about
 *         - Stripe's charge amount disagrees with guesty_reservations.total_paid
 *         - A Stripe charge has no matching reservation (orphan)
 *         - A reservation has no matching Stripe charge (VRBO/Manual only)
 *
 * Airbnb + Booking.com reservations are skipped -- those don't flow
 * through Rising Tide's Stripe accounts.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

type StripeCharge = {
  id: string;
  amount: number;              // cents
  amount_refunded: number;     // cents
  currency: string;
  created: number;             // unix seconds
  description: string | null;
  status: string;              // 'succeeded' | 'pending' | 'failed'
  refunded: boolean;
  paid: boolean;
  balance_transaction:
    | string
    | { id: string; fee: number; net: number; amount: number; currency: string }
    | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function getStripeKeysMap(): Record<string, string> {
  const raw = process.env.STRIPE_KEYS_JSON || '';
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

async function stripeGet<T>(key: string, path: string, params: Record<string, string | string[]>): Promise<T> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach(item => q.append(k, item));
    else q.append(k, v);
  }
  const res = await fetch(`https://api.stripe.com/v1/${path}?${q.toString()}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Stripe ${path} failed (${res.status}): ${body?.error?.message || JSON.stringify(body)}`);
  }
  return body as T;
}

async function listChargesForMonth(key: string, month: string): Promise<StripeCharge[]> {
  const [y, m] = month.split('-').map(Number);
  const start = Math.floor(Date.UTC(y, m - 1, 1) / 1000);
  const end = Math.floor(Date.UTC(y, m, 1) / 1000);
  const charges: StripeCharge[] = [];
  let startingAfter: string | undefined;
  // Safety cap: don't loop forever if Stripe keeps returning has_more (shouldn't,
  // but defence in depth against a bug that would otherwise burn our budget).
  for (let i = 0; i < 10; i++) {
    const params: Record<string, string | string[]> = {
      'created[gte]': String(start),
      'created[lt]': String(end),
      limit: '100',
      'expand[]': ['data.balance_transaction'],
    };
    if (startingAfter) params.starting_after = startingAfter;
    const page = await stripeGet<{ data: StripeCharge[]; has_more: boolean }>(key, 'charges', params);
    charges.push(...page.data);
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return charges;
}

// Pull out the Stripe fee in dollars from the expanded balance_transaction.
// Returns null if we didn't get it back expanded (e.g. restricted key lacks
// access to balance_transactions) -- caller decides how to handle.
function feeFromCharge(c: StripeCharge): number | null {
  if (!c.balance_transaction || typeof c.balance_transaction === 'string') return null;
  return round2(c.balance_transaction.fee / 100);
}

type ReservationRow = {
  id: string;
  confirmation_code: string;
  platform: string | null;
  guest_name: string | null;
  property_statement_id: string;
  guesty_rental_income: number;
  stripe_fee: number | null;
  adjusted_revenue: number | null;
};

type PerPropertyResult = {
  property_id: string;
  charges_found: number;
  matched: number;
  unmatched_charges: string[];
  fee_updates: { code: string; guest: string; prev: number; next: number; delta: number }[];
  refunds_detected: { code: string; guest: string; amount: number }[];
  gross_mismatches: { code: string; guest: string; stripe: number; guesty: number }[];
  reservations_missing_charge: { code: string; guest: string; expected: number }[];
  error?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as { month?: string }));
    const month: string = body.month || '';
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'month is required, format YYYY-MM' }, { status: 400 });
    }

    const keys = getStripeKeysMap();
    if (Object.keys(keys).length === 0) {
      return NextResponse.json(
        { error: 'STRIPE_KEYS_JSON env var is not configured. Set it to a JSON object mapping property_id -> restricted Stripe key.' },
        { status: 400 },
      );
    }

    // Locate the statement period + its property_statements so we can find
    // which reservations to match against.
    const { data: period } = await supabase.from('statement_periods').select('id').eq('month', month).single();
    if (!period) {
      return NextResponse.json({ error: `No statement period for ${month}` }, { status: 404 });
    }

    type StmtRow = {
      id: string;
      property_id: string;
      management_fee_pct: number;
      rental_revenue: number;
      management_fee: number;
      cleaning_total: number;
      repairs_total: number;
      owner_payout: number;
    };
    const { data: stmts } = await supabase
      .from('property_statements')
      .select('id, property_id, management_fee_pct, rental_revenue, management_fee, cleaning_total, repairs_total, owner_payout')
      .eq('period_id', period.id);

    const stmtByPropertyId = new Map<string, StmtRow>();
    ((stmts || []) as StmtRow[]).forEach(s => stmtByPropertyId.set(s.property_id, s));

    const results: PerPropertyResult[] = [];

    // Per-property sync. We intentionally do these sequentially rather than in
    // parallel so a single bad key doesn't cascade into every other account's
    // output and so Stripe rate limits don't spike.
    for (const [propertyId, restrictedKey] of Object.entries(keys)) {
      const stmt = stmtByPropertyId.get(propertyId);
      if (!stmt) {
        results.push({
          property_id: propertyId,
          charges_found: 0, matched: 0,
          unmatched_charges: [], fee_updates: [], refunds_detected: [], gross_mismatches: [], reservations_missing_charge: [],
          error: `No statement for ${propertyId} / ${month} -- run the monthly ingest first`,
        });
        continue;
      }

      const pr: PerPropertyResult = {
        property_id: propertyId,
        charges_found: 0, matched: 0,
        unmatched_charges: [], fee_updates: [], refunds_detected: [], gross_mismatches: [], reservations_missing_charge: [],
      };

      try {
        const charges = await listChargesForMonth(restrictedKey, month);
        const succeeded = charges.filter(c => c.status === 'succeeded' || c.paid);
        pr.charges_found = succeeded.length;

        // Existing reservations for this statement -- for matching + fee updates.
        const { data: rRes } = await supabase
          .from('reservations')
          .select('id, confirmation_code, platform, guest_name, property_statement_id, guesty_rental_income, stripe_fee, adjusted_revenue')
          .eq('property_statement_id', stmt.id);
        const reservations: ReservationRow[] = (rRes || []) as ReservationRow[];
        const byCode = new Map<string, ReservationRow>();
        for (const r of reservations) if (r.confirmation_code) byCode.set(r.confirmation_code, r);

        // Also pull guesty_reservations for the TOTAL_PAID gross so we can
        // flag mismatches between what Stripe charged and what Guesty thinks
        // the guest paid.
        const codesForThisProp = reservations.map(r => r.confirmation_code).filter(Boolean);
        const { data: gRes } = codesForThisProp.length
          ? await supabase.from('guesty_reservations').select('confirmation_code, total_paid').in('confirmation_code', codesForThisProp)
          : { data: [] as { confirmation_code: string; total_paid: number | null }[] };
        const grossByCode = new Map<string, number>();
        (gRes || []).forEach(g => { if (g.total_paid != null && g.confirmation_code) grossByCode.set(g.confirmation_code, g.total_paid); });

        const matchedCodes = new Set<string>();

        for (const charge of succeeded) {
          // Stripe descriptions carry the confirmation code -- sometimes
          // with trailing notes, so match on the first token.
          const desc = (charge.description || '').trim();
          const firstToken = desc.split(/\s+/)[0];
          const code = firstToken || desc;
          if (!code) {
            pr.unmatched_charges.push(`no description (${charge.id})`);
            continue;
          }

          const res = byCode.get(code);
          if (!res) {
            pr.unmatched_charges.push(`${code} ($${(charge.amount / 100).toFixed(2)}) -- no reservation`);
            continue;
          }
          matchedCodes.add(code);
          pr.matched++;

          // Airbnb / Booking.com shouldn't be in these accounts at all,
          // so if we see one it's a data puzzle, skip the update.
          const p = (res.platform || '').toUpperCase();
          const isRTStripeChannel = p.includes('HOMEAWAY') || p === 'VRBO' || p === 'MANUAL';
          if (!isRTStripeChannel) continue;

          const actualFee = feeFromCharge(charge);
          const stripeGross = round2(charge.amount / 100);
          const refunded = round2(charge.amount_refunded / 100);

          // Gross mismatch: Stripe says the guest paid X, Guesty says Y.
          const guestyGross = grossByCode.get(code);
          if (guestyGross != null && Math.abs(guestyGross - stripeGross) > 1) {
            pr.gross_mismatches.push({ code, guest: res.guest_name || 'Guest', stripe: stripeGross, guesty: guestyGross });
          }

          // Refund on Stripe side we haven't accounted for -- flag it. We
          // don't auto-reduce owner payout here because the accounting
          // convention depends on timing (was it within statement period?
          // how does it affect mgmt fee?). Flag + human decides.
          if (refunded > 0) {
            pr.refunds_detected.push({ code, guest: res.guest_name || 'Guest', amount: refunded });
          }

          // Fee update: swap our estimate for Stripe's actual if they differ
          // by more than a dollar and we have the actual value.
          if (actualFee != null && res.stripe_fee != null) {
            const prev = round2(res.stripe_fee);
            if (Math.abs(prev - actualFee) > 1) {
              const deltaFee = round2(actualFee - prev);  // positive means we under-estimated the fee
              const newAdjusted = round2((res.adjusted_revenue || 0) - deltaFee);
              await supabase
                .from('reservations')
                .update({ stripe_fee: actualFee, adjusted_revenue: newAdjusted })
                .eq('id', res.id);
              pr.fee_updates.push({ code, guest: res.guest_name || 'Guest', prev, next: actualFee, delta: deltaFee });
            }
          }
        }

        // Reservations we expected a Stripe charge for but didn't find one.
        // Only care about VRBO/Manual non-zero stays; other channels don't
        // flow through this account.
        for (const r of reservations) {
          if (matchedCodes.has(r.confirmation_code)) continue;
          const p = (r.platform || '').toUpperCase();
          const isRTStripeChannel = p.includes('HOMEAWAY') || p === 'VRBO' || p === 'MANUAL';
          if (!isRTStripeChannel) continue;
          const isHomeownerStay = p === 'MANUAL' && (!r.guesty_rental_income || r.guesty_rental_income === 0);
          if (isHomeownerStay) continue;
          pr.reservations_missing_charge.push({
            code: r.confirmation_code,
            guest: r.guest_name || 'Guest',
            expected: round2(r.guesty_rental_income || 0),
          });
        }

        // If any fee updates landed, recompute the statement's rental_revenue
        // + management_fee + owner_payout off the freshest reservation numbers.
        if (pr.fee_updates.length > 0) {
          const { data: freshRes } = await supabase
            .from('reservations')
            .select('adjusted_revenue')
            .eq('property_statement_id', stmt.id);
          const newRentalRevenue = round2((freshRes || []).reduce((s, r) => s + (r.adjusted_revenue || 0), 0));
          const newMgmtFee = round2(newRentalRevenue * (stmt.management_fee_pct / 100));
          const newOwnerPayout = round2(newRentalRevenue - newMgmtFee - (stmt.cleaning_total || 0) - (stmt.repairs_total || 0));
          await supabase
            .from('property_statements')
            .update({ rental_revenue: newRentalRevenue, management_fee: newMgmtFee, owner_payout: newOwnerPayout })
            .eq('id', stmt.id);
        }

        // Persist discrepancy gaps. Wipe any prior stripe_sync gaps so
        // re-runs don't pile up duplicates.
        await supabase
          .from('data_gaps')
          .delete()
          .eq('property_statement_id', stmt.id)
          .in('gap_type', ['stripe_refund_detected', 'stripe_gross_mismatch', 'stripe_missing_charge', 'stripe_orphan_charge']);

        const newGaps: { gap_type: string; description: string; severity: string; expected_data: string }[] = [];
        for (const r of pr.refunds_detected) {
          newGaps.push({
            gap_type: 'stripe_refund_detected',
            description: `Stripe shows $${r.amount.toFixed(2)} refunded on ${r.guest} (${r.code}). Owner payout may need adjustment.`,
            severity: 'warning',
            expected_data: `Confirm whether the refund is in-period and update the statement manually`,
          });
        }
        for (const m of pr.gross_mismatches) {
          newGaps.push({
            gap_type: 'stripe_gross_mismatch',
            description: `Stripe gross $${m.stripe.toFixed(2)} disagrees with Guesty TOTAL_PAID $${m.guesty.toFixed(2)} for ${m.guest} (${m.code})`,
            severity: 'info',
            expected_data: `Re-check the Guesty reservation amount for this stay`,
          });
        }
        for (const mc of pr.reservations_missing_charge) {
          newGaps.push({
            gap_type: 'stripe_missing_charge',
            description: `No Stripe charge found for ${mc.guest} (${mc.code}) expected $${mc.expected.toFixed(2)}`,
            severity: 'info',
            expected_data: `Check Stripe dashboard for this confirmation code`,
          });
        }
        for (const oc of pr.unmatched_charges) {
          newGaps.push({
            gap_type: 'stripe_orphan_charge',
            description: `Stripe charge with no matching reservation: ${oc}`,
            severity: 'info',
            expected_data: `Check whether this charge belongs to a stay we haven't ingested yet`,
          });
        }
        if (newGaps.length > 0) {
          await supabase
            .from('data_gaps')
            .insert(newGaps.map(g => ({ property_statement_id: stmt.id, ...g })));
        }
      } catch (err) {
        pr.error = err instanceof Error ? err.message : String(err);
      }

      results.push(pr);
    }

    // Log last sync for the dashboard's relative-time badge.
    await supabase
      .from('sync_status')
      .upsert({ source: 'stripe', last_synced_at: new Date().toISOString(), last_result: { month, properties: results.length } });

    return NextResponse.json({ success: true, month, results });
  } catch (err) {
    console.error('sync-stripe error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
