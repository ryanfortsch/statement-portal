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

/**
 * List Stripe charges whose creation date falls in a window around the
 * statement month. STR payment timing doesn't align with stay timing --
 * guests pay at booking (1-6 months ahead) and VRBO/Direct balances hit
 * 30-60 days before check-in -- so a month-only window misses most of the
 * charges that pay for this month's stays. We pull a 6-months-back to
 * 2-months-forward window, which covers normal booking lead times.
 */
async function listChargesAroundMonth(key: string, month: string): Promise<StripeCharge[]> {
  const [y, m] = month.split('-').map(Number);
  // 6 months before the start of the statement month, through 2 months
  // after the end of it.
  const start = Math.floor(Date.UTC(y, m - 1 - 6, 1) / 1000);
  const end = Math.floor(Date.UTC(y, m + 2, 1) / 1000);
  const charges: StripeCharge[] = [];
  let startingAfter: string | undefined;
  // Safety cap at 50 pages (5000 charges) -- more than any small portfolio
  // will have in 8 months, cheap insurance against a runaway loop.
  for (let i = 0; i < 50; i++) {
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
        const charges = await listChargesAroundMonth(restrictedKey, month);
        const succeeded = charges.filter(c => c.status === 'succeeded' || c.paid);
        pr.charges_found = succeeded.length;

        // This statement-month's reservations -- the ones we may update fees
        // on and emit gaps for.
        const { data: rRes } = await supabase
          .from('reservations')
          .select('id, confirmation_code, platform, guest_name, property_statement_id, guesty_rental_income, stripe_fee, adjusted_revenue')
          .eq('property_statement_id', stmt.id);
        const reservations: ReservationRow[] = (rRes || []) as ReservationRow[];
        const byCode = new Map<string, ReservationRow>();
        for (const r of reservations) if (r.confirmation_code) byCode.set(r.confirmation_code, r);

        // Additionally, know about every reservation across all months for
        // this property. A Stripe charge is only a real 'orphan' if no
        // reservation in the DB matches -- otherwise the charge just belongs
        // to a stay in a different statement month, which is normal
        // (guests pay months before check-in).
        const { data: crossMonthRes } = await supabase
          .from('reservations')
          .select('confirmation_code, property_statement_id')
          .not('confirmation_code', 'is', null);
        // Narrow the cross-month set to this property via property_statements.
        const { data: allStmtsThisProp } = await supabase
          .from('property_statements')
          .select('id')
          .eq('property_id', propertyId);
        const thisPropStmtIds = new Set((allStmtsThisProp || []).map(s => s.id));
        const knownCodesThisProp = new Set(
          (crossMonthRes || [])
            .filter(r => r.property_statement_id && thisPropStmtIds.has(r.property_statement_id))
            .map(r => r.confirmation_code as string),
        );
        // Same lookup against guesty_reservations (this captures upcoming
        // stays that don't yet have a reservations row because their
        // statement month hasn't been ingested).
        const { data: guestyAllForProp } = await supabase
          .from('guesty_reservations')
          .select('confirmation_code')
          .eq('property_id', propertyId);
        for (const g of guestyAllForProp || []) {
          if (g.confirmation_code) knownCodesThisProp.add(g.confirmation_code);
        }

        // TOTAL_PAID gross on this month's reservations, for mismatch check.
        const codesForThisProp = reservations.map(r => r.confirmation_code).filter(Boolean);
        const { data: gRes } = codesForThisProp.length
          ? await supabase.from('guesty_reservations').select('confirmation_code, total_paid').in('confirmation_code', codesForThisProp)
          : { data: [] as { confirmation_code: string; total_paid: number | null }[] };
        const grossByCode = new Map<string, number>();
        (gRes || []).forEach(g => { if (g.total_paid != null && g.confirmation_code) grossByCode.set(g.confirmation_code, g.total_paid); });

        // Aggregate Stripe charges by confirmation code (a single reservation
        // often has an initial + final-balance charge, both with the same
        // description). We sum fees, sum grosses, and track refunds across all
        // charges for the code.
        type Agg = { grossCents: number; refundedCents: number; feeCents: number; feeKnown: boolean; chargeCount: number };
        const byCodeAgg = new Map<string, Agg>();
        const orphanCodes: { code: string; amount: number }[] = [];

        for (const charge of succeeded) {
          const desc = (charge.description || '').trim();
          const firstToken = desc.split(/\s+/)[0];
          const code = firstToken || desc;
          if (!code) {
            pr.unmatched_charges.push(`no description (${charge.id})`);
            continue;
          }

          const agg = byCodeAgg.get(code) || { grossCents: 0, refundedCents: 0, feeCents: 0, feeKnown: false, chargeCount: 0 };
          agg.grossCents += charge.amount;
          agg.refundedCents += charge.amount_refunded;
          const fee = (charge.balance_transaction && typeof charge.balance_transaction !== 'string')
            ? charge.balance_transaction.fee
            : null;
          if (fee != null) { agg.feeCents += fee; agg.feeKnown = true; }
          agg.chargeCount += 1;
          byCodeAgg.set(code, agg);
        }

        const matchedCodes = new Set<string>();

        for (const [code, agg] of byCodeAgg.entries()) {
          const res = byCode.get(code);
          if (!res) {
            // A charge for a reservation we don't have this month is only
            // a real orphan if it doesn't match any reservation for this
            // property in any month (past or future).
            if (!knownCodesThisProp.has(code)) {
              orphanCodes.push({ code, amount: round2(agg.grossCents / 100) });
            }
            continue;
          }
          matchedCodes.add(code);
          pr.matched++;

          // Airbnb / Booking.com shouldn't be in these accounts at all.
          const p = (res.platform || '').toUpperCase();
          const isRTStripeChannel = p.includes('HOMEAWAY') || p === 'VRBO' || p === 'MANUAL';
          if (!isRTStripeChannel) continue;

          const stripeGross = round2(agg.grossCents / 100);
          const refunded = round2(agg.refundedCents / 100);
          const actualFee = agg.feeKnown ? round2(agg.feeCents / 100) : null;

          // Gross mismatch vs Guesty.
          const guestyGross = grossByCode.get(code);
          if (guestyGross != null && Math.abs(guestyGross - stripeGross) > 1) {
            pr.gross_mismatches.push({ code, guest: res.guest_name || 'Guest', stripe: stripeGross, guesty: guestyGross });
          }

          if (refunded > 0) {
            pr.refunds_detected.push({ code, guest: res.guest_name || 'Guest', amount: refunded });
          }

          // Fee update: swap our estimate for the summed actual fee across
          // all charges for this reservation, when it differs by > $1.
          if (actualFee != null && res.stripe_fee != null) {
            const prev = round2(res.stripe_fee);
            if (Math.abs(prev - actualFee) > 1) {
              const deltaFee = round2(actualFee - prev);
              const newAdjusted = round2((res.adjusted_revenue || 0) - deltaFee);
              await supabase
                .from('reservations')
                .update({ stripe_fee: actualFee, adjusted_revenue: newAdjusted })
                .eq('id', res.id);
              pr.fee_updates.push({ code, guest: res.guest_name || 'Guest', prev, next: actualFee, delta: deltaFee });
            }
          }
        }

        pr.unmatched_charges = orphanCodes.map(o => `${o.code} ($${o.amount.toFixed(2)})`);

        // Reservations in this statement month we expected a Stripe charge
        // for but didn't find one in the wider window. Only VRBO/Manual
        // non-homeowner stays -- other channels don't flow through this
        // Stripe account.
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
