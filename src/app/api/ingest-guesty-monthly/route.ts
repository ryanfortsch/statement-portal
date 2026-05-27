import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { PROPERTIES } from '@/lib/properties';
import { calcStripeFee, stripLegacyCommissionKludge, normalizePlatform } from '@/lib/revenue-math';

/**
 * Bulk Guesty reservations ingest for a single month, fanned out across
 * every Rising Tide property in one shot.
 *
 * The operator drops the Guesty Platform CSV (the "reservations spreadsheet"
 * from Guesty) and picks a month. We:
 *   1. Upsert every parsed row into `guesty_reservations` (the per-stay
 *      cache used elsewhere -- same write the existing /api/ingest-guesty-csv
 *      endpoint does), so the rest of the app sees full reservation data.
 *   2. For rows whose CHECK-OUT falls inside the chosen month, group by
 *      property and roll up to `property_statements` + per-stay `reservations`
 *      rows -- the same totals /api/ingest produces from a PDF, derived from
 *      the CSV's money columns (TOTAL_PAID, TAXES, COMMISSION, OWNER NET).
 *
 * Cleaning/repairs/tax_remittance are preserved when a statement already
 * exists (so the bank-CSV-per-property flow still works on top of this).
 * Properties not in the CSV for this month are left alone.
 */

const NICKNAME_HINTS: Record<string, string> = {
  '3_south_st':    'old garden beach',
  '21_horton':     'rocky neck',
  '53_rocky_neck': 'the neck',
  '4_brier_neck':  'brier neck',
  '30_woodward':   'little river',
  '20_hammond':    'east gloucester',
  '20_enon':       'beverly shops',
  '73_rocky_neck': 'smith cove',
  '17_beach_rd':   'niles beach',
  '65_calderwood': 'black rock harbor',
  '3_locust':      'niles beach',
  '3246_ne_27th':  'lighthouse point',
};

// Ryan's personal properties -- statements never run for these.
const EXCLUDED_PROPERTIES = new Set(['65_calderwood', '3246_ne_27th']);

function matchProperty(listing: string): string | null {
  const h = listing.toLowerCase();
  for (const [pid, p] of Object.entries(PROPERTIES)) {
    if (h.includes(p.listing_match)) return pid;
  }
  for (const [pid, hint] of Object.entries(NICKNAME_HINTS)) {
    if (h.includes(hint)) return pid;
  }
  return null;
}

function channelLabel(platform: string): string {
  const p = platform.toLowerCase();
  if (p.includes('airbnb')) return 'Airbnb';
  if (p.includes('homeaway') || p === 'vrbo') return 'VRBO';
  if (p.includes('booking')) return 'Booking.com';
  return 'Direct';
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === ',' && !inQ) { fields.push(cur); cur = ''; }
    else cur += c;
  }
  fields.push(cur);
  return fields;
}

function parseMoney(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const s = String(raw).replace(/[,$"\s]/g, '').trim();
  if (!s) return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function nightsBetween(a: string, b: string): number {
  const d1 = new Date(a + 'T00:00:00');
  const d2 = new Date(b + 'T00:00:00');
  return Math.max(0, Math.round((d2.getTime() - d1.getTime()) / 86_400_000));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

type CsvRow = {
  property_id: string;
  confirmation_code: string;
  guest_name: string;
  check_in: string;
  check_out: string;
  nights: number;
  platform_raw: string;
  channel_label: string;
  total_paid: number | null;
  total_taxes: number | null;
  commission: number | null;
  owner_net: number | null;
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const formData = await request.formData();
    const month = ((formData.get('month') as string) || '').trim();
    const file = formData.get('file') as File | null;
    // dry_run computes the per-property roll-up and returns it without writing
    // anything to Supabase. Used to preview / verify math before mutating
    // statements that may already be in flight.
    const dryRun = ((formData.get('dry_run') as string) || '').toLowerCase() === 'true';
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'month required (YYYY-MM)' }, { status: 400 });
    }
    if (!file || file.size === 0) {
      return NextResponse.json({ error: 'file required (Guesty reservations CSV)' }, { status: 400 });
    }
    const csvText = await file.text();

    // Parse the CSV (same shape /api/ingest-guesty-csv expects).
    const normalized = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    if (lines.length < 2) {
      return NextResponse.json({ error: 'CSV has no rows' }, { status: 400 });
    }
    const headers = parseCSVLine(lines[0]).map(h => h.trim().replace(/^"|"$/g, '').toUpperCase());
    const col = (name: string) => headers.indexOf(name.toUpperCase());
    const iCheckIn = col('CHECK-IN');
    const iCheckOut = col('CHECK-OUT');
    const iCode = col('CONFIRMATION CODE');
    const iListing = col('LISTING');
    const iGuest = col('GUEST');
    const iPlatform = col('PLATFORM');
    const iTotalPaid = col('TOTAL PAID');
    const iTaxes = col('TOTAL TAXES');
    const iCommission = col('CHANNEL COMMISSION INCL TAX');
    const iOwnerNet = col('OWNER NET REVENUE (ACCOUNTING)');
    if (iCheckIn < 0 || iCheckOut < 0 || iListing < 0) {
      return NextResponse.json(
        { error: `CSV missing required headers (CHECK-IN, CHECK-OUT, LISTING). Got: ${headers.join(', ')}` },
        { status: 400 },
      );
    }

    const rows: CsvRow[] = [];
    let unmatched = 0;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const f = parseCSVLine(line);
      if (f.length < Math.max(iListing, iCheckIn, iCheckOut) + 1) continue;
      const checkIn = (f[iCheckIn] || '').split(' ')[0];
      const checkOut = (f[iCheckOut] || '').split(' ')[0];
      const listing = (f[iListing] || '').trim();
      if (!checkIn || !checkOut || !listing) continue;
      const propertyId = matchProperty(listing);
      if (!propertyId) { unmatched++; continue; }
      if (EXCLUDED_PROPERTIES.has(propertyId)) continue;
      const platformRaw = iPlatform >= 0 ? (f[iPlatform] || '').trim() : '';
      rows.push({
        property_id: propertyId,
        confirmation_code: iCode >= 0 ? (f[iCode] || '').trim() : '',
        guest_name: iGuest >= 0 ? (f[iGuest] || '').trim() : '',
        check_in: checkIn,
        check_out: checkOut,
        nights: nightsBetween(checkIn, checkOut),
        platform_raw: platformRaw,
        channel_label: channelLabel(platformRaw),
        total_paid: iTotalPaid >= 0 ? parseMoney(f[iTotalPaid]) : null,
        total_taxes: iTaxes >= 0 ? parseMoney(f[iTaxes]) : null,
        commission: iCommission >= 0 ? parseMoney(f[iCommission]) : null,
        owner_net: iOwnerNet >= 0 ? parseMoney(f[iOwnerNet]) : null,
      });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    );

    // 1. Upsert ALL rows into guesty_reservations (same writes as /api/ingest-guesty-csv).
    //    Skip rows that already have an API-sourced version (Guesty API is richer).
    let cacheUpserted = 0;
    if (!dryRun && rows.length > 0) {
      const codes = rows.map(r => r.confirmation_code).filter(Boolean);
      const { data: apiExisting } = codes.length
        ? await supabase.from('guesty_reservations').select('confirmation_code').eq('source', 'guesty-api').in('confirmation_code', codes)
        : { data: [] as { confirmation_code: string }[] };
      const apiCodes = new Set((apiExisting || []).map(r => r.confirmation_code));
      const cacheRows = rows
        .filter(r => !r.confirmation_code || !apiCodes.has(r.confirmation_code))
        .map(r => ({
          guesty_reservation_id: `csv:${r.confirmation_code || `${r.property_id}:${r.check_in}`}`,
          property_id: r.property_id,
          guest_name: r.guest_name || null,
          confirmation_code: r.confirmation_code || null,
          check_in: r.check_in,
          check_out: r.check_out,
          nights: r.nights,
          channel: r.channel_label,
          guesty_channel_id: r.platform_raw || null,
          status: 'confirmed',
          source: 'csv-fallback',
          synced_at: new Date().toISOString(),
          total_paid: r.total_paid,
          total_taxes: r.total_taxes,
          channel_commission: r.commission,
          owner_net_revenue_guesty: r.owner_net,
        }));
      if (cacheRows.length > 0) {
        const { error } = await supabase.from('guesty_reservations').upsert(cacheRows, { onConflict: 'guesty_reservation_id' });
        if (error) throw new Error(`guesty_reservations upsert failed: ${error.message}`);
        cacheUpserted = cacheRows.length;
      }
    }

    // 2. Group target-month rows by property and roll up to property_statements.
    const monthRows = rows.filter(r => r.check_out.slice(0, 7) === month);
    const byProperty = new Map<string, CsvRow[]>();
    for (const r of monthRows) {
      const list = byProperty.get(r.property_id) || [];
      list.push(r);
      byProperty.set(r.property_id, list);
    }

    // Get/create period for the month. Dry-run skips the create -- if no period
    // yet, the existing-statement lookups below just return nothing (every
    // property would be created fresh on a real run).
    let { data: period } = await supabase.from('statement_periods').select('*').eq('month', month).maybeSingle();
    if (!period && !dryRun) {
      const { data: created, error } = await supabase.from('statement_periods').insert({ month, status: 'draft' }).select().single();
      if (error) throw error;
      period = created;
    }

    const perProperty: Record<string, unknown>[] = [];

    for (const [propertyId, propRows] of byProperty) {
      const propConfig = PROPERTIES[propertyId];
      if (!propConfig) continue;

      // Per-reservation revenue math -- identical formula to /api/ingest.
      //
      // Important: the CSV's OWNER NET REVENUE (ACCOUNTING) column is
      // post-management-fee (Guesty multiplies by 1 - fee_pct under the
      // hood), so we DON'T use it as the per-stay rental_income. The PDF's
      // "rental income" is the pre-mgmt-fee, channel-net amount, which we
      // reconstruct from TOTAL_PAID - TAXES - effective_commission. The mgmt
      // fee is then applied once at the property_statement level below.
      const processed = propRows.map(r => {
        const platform = normalizePlatform(r.platform_raw) || 'Unknown';
        const pu = platform.toUpperCase();
        const isStripeChannel = pu.includes('HOMEAWAY') || pu === 'VRBO' || pu === 'MANUAL';
        const totalPaid = r.total_paid ?? 0;
        const totalTaxes = r.total_taxes ?? 0;
        const rawCommission = r.commission ?? 0;
        const { effective: effCommission } = stripLegacyCommissionKludge({
          platform, totalPaid, totalTaxes, commission: rawCommission,
        });
        const preStripeRevenue = round2(totalPaid - totalTaxes - effCommission);
        const isHomeownerStay = pu === 'MANUAL' && totalPaid === 0 && preStripeRevenue === 0;

        let stripeFee = 0;
        let rentalIncome = preStripeRevenue;
        let adjustedRevenue = preStripeRevenue;

        if (isHomeownerStay) {
          rentalIncome = 0;
          adjustedRevenue = 0;
        } else if (isStripeChannel && totalPaid > 0) {
          stripeFee = calcStripeFee(totalPaid);
          adjustedRevenue = round2(preStripeRevenue - stripeFee);
        }
        // Airbnb / Booking.com: channel processes payment + nets its commission,
        // so adjustedRevenue == preStripeRevenue (no Stripe fee on our side).

        return {
          guest_name: r.guest_name,
          confirmation_code: r.confirmation_code,
          check_in: r.check_in,
          check_out: r.check_out,
          nights: r.nights,
          platform,
          guesty_rental_income: rentalIncome,
          stripe_fee: stripeFee,
          adjusted_revenue: adjustedRevenue,
          bank_deposit_amount: null,
          bank_match_status: 'unmatched',
        };
      });

      const totalRevenue = round2(processed.reduce((s, p) => s + p.adjusted_revenue, 0));
      const managementFee = round2(totalRevenue * (propConfig.fee_pct / 100));
      const numStays = processed.filter(p => p.adjusted_revenue > 0).length;
      const nightsBooked = processed.reduce((s, p) => s + p.nights, 0);

      // Existing statement? Preserve cleaning / repairs / tax_remittance so the
      // bank-CSV-per-property flow keeps working on top of this.
      type ExistingStmt = { id: string; cleaning_total: number; repairs_total: number };
      let existing: ExistingStmt | null = null;
      if (period) {
        const { data } = await supabase
          .from('property_statements')
          .select('id, cleaning_total, repairs_total, tax_remittance, has_bank_csv')
          .eq('period_id', period.id)
          .eq('property_id', propertyId)
          .maybeSingle();
        existing = (data as ExistingStmt | null) ?? null;
      }

      const cleaningTotal = Number(existing?.cleaning_total) || 0;
      const repairsTotal = Number(existing?.repairs_total) || 0;
      const ownerPayout = round2(totalRevenue - managementFee - cleaningTotal - repairsTotal);

      if (!dryRun && period) {
        let stmtId: string;
        if (existing) {
          const { error } = await supabase.from('property_statements').update({
            property_name: propConfig.name,
            owner_name: propConfig.owner_last,
            management_fee_pct: propConfig.fee_pct,
            rental_revenue: totalRevenue,
            management_fee: managementFee,
            owner_payout: ownerPayout,
            num_stays: numStays,
            nights_booked: nightsBooked,
            has_guesty_statement: true,
            has_platform_csv: true,
          }).eq('id', existing.id);
          if (error) throw error;
          stmtId = existing.id;
          await supabase.from('reservations').delete().eq('property_statement_id', stmtId);
        } else {
          const { data: stmt, error } = await supabase.from('property_statements').insert({
            period_id: period.id,
            property_id: propertyId,
            property_name: propConfig.name,
            owner_name: propConfig.owner_last,
            management_fee_pct: propConfig.fee_pct,
            rental_revenue: totalRevenue,
            management_fee: managementFee,
            cleaning_total: 0,
            repairs_total: 0,
            tax_remittance: 0,
            owner_payout: ownerPayout,
            num_stays: numStays,
            nights_booked: nightsBooked,
            has_guesty_statement: true,
            has_platform_csv: true,
            has_bank_csv: false,
            confidence: 'yellow',
          }).select('id').single();
          if (error) throw error;
          stmtId = stmt.id as string;
        }

        if (processed.length > 0) {
          const { error } = await supabase.from('reservations').insert(
            processed.map(p => ({ property_statement_id: stmtId, ...p })),
          );
          if (error) throw error;
        }
      }

      perProperty.push({
        property_id: propertyId,
        property_name: propConfig.name,
        action: existing ? 'updated' : 'created',
        num_stays: numStays,
        nights_booked: nightsBooked,
        rental_revenue: totalRevenue,
        management_fee: managementFee,
        cleaning_preserved: cleaningTotal,
        repairs_preserved: repairsTotal,
        owner_payout: ownerPayout,
      });
    }

    perProperty.sort((a, b) => String(a.property_name).localeCompare(String(b.property_name)));

    return NextResponse.json({
      success: true,
      month,
      dry_run: dryRun,
      rows_in_file: rows.length,
      reservations_in_month: monthRows.length,
      reservations_cached: cacheUpserted,
      unmatched_listings: unmatched,
      properties_processed: perProperty.length,
      by_property: perProperty,
    });
  } catch (err) {
    console.error('ingest-guesty-monthly error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
