import { NextRequest, NextResponse } from "next/server";
import { parseAirDnaCsv } from "@/lib/airdna-csv";
import {
  PUBLIC_MARKETS,
  formatMonthLong,
  writeClient,
} from "@/lib/market-metrics";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/airdna/ingest
 *
 * Body: { csv: string }  (the full text of the AirDNA "Market Metrics
 *                         Monthly" export, semicolon or comma delimited)
 *
 * Behavior:
 *   - Parse the CSV.
 *   - Filter to the markets we actually render publicly
 *     (gloucester + rockport today). AirDNA exports often include
 *     extra rows (north-shore-inland, cape-cod, etc.); we keep the
 *     table clean by ignoring them.
 *   - Upsert into market_metrics_monthly on (market_slug, month, source).
 *
 * Returns a summary: which rows were accepted, which were filtered
 * out as off-market, which were warnings from the parser. The Helm
 * UI shows this back to the user before they consider the upload
 * "done."
 *
 * This route uses the service-role key — the table's RLS only allows
 * service-role writes — so it lives behind no extra auth check. The
 * UI page is gated by Helm's normal auth wrapper.
 */

export async function POST(request: NextRequest) {
  let csv: string | undefined;
  try {
    const body = await request.json();
    csv = body?.csv;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (typeof csv !== "string" || csv.trim().length === 0) {
    return NextResponse.json({ error: "csv field is required" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = parseAirDnaCsv(csv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const publicSet = new Set<string>(PUBLIC_MARKETS);
  const accepted = parsed.rows.filter((r) => publicSet.has(r.market_slug));
  const skipped = parsed.rows.filter((r) => !publicSet.has(r.market_slug));

  if (accepted.length === 0) {
    return NextResponse.json(
      {
        error:
          "no rows matched the markets we publish (" +
          PUBLIC_MARKETS.join(", ") +
          "). Check the CSV's `market` column.",
        skipped: skipped.length,
        warnings: parsed.warnings,
      },
      { status: 400 },
    );
  }

  const toUpsert = accepted.map((r) => ({
    market_slug: r.market_slug,
    month: r.month,
    active_listings: r.active_listings,
    occupancy_rate: r.occupancy_rate,
    avg_listing_revenue: r.avg_listing_revenue,
    source: r.source,
  }));

  const supa = writeClient();
  const { error } = await supa
    .from("market_metrics_monthly")
    .upsert(toUpsert, { onConflict: "market_slug,month,source" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Build a per-market summary so the UI can show "Gloucester:
  // Apr 2026 added (1 month)" rather than "78 rows upserted".
  const byMarket: Record<string, { months: string[]; latest: string }> = {};
  for (const r of accepted) {
    if (!byMarket[r.market_slug])
      byMarket[r.market_slug] = { months: [], latest: r.month };
    byMarket[r.market_slug].months.push(r.month);
    if (r.month > byMarket[r.market_slug].latest)
      byMarket[r.market_slug].latest = r.month;
  }
  const summary = Object.entries(byMarket).map(([market, info]) => ({
    market,
    months_in_upload: info.months.length,
    latest_month: info.latest,
    latest_month_pretty: formatMonthLong(info.latest),
  }));

  return NextResponse.json({
    ok: true,
    accepted: accepted.length,
    skipped_off_market: skipped.length,
    summary,
    warnings: parsed.warnings,
  });
}
