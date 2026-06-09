import { NextRequest, NextResponse } from "next/server";
import {
  detectAirDnaCsvFormat,
  parseAirDnaCsv,
  parseOccupancyByBedroomsCsv,
  parseOccupancyOnlyCsv,
  parseRevenueOnlyCsv,
  type AirDnaCsvFormat,
} from "@/lib/airdna-csv";
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
 * Accepts either of two body shapes:
 *
 *   Legacy: { csv: string }
 *     The full text of AirDNA's "Market Metrics Monthly" export
 *     (semicolon or comma delimited). The market(s) come from the
 *     CSV's market column. Filters down to PUBLIC_MARKETS.
 *
 *   Multi-format: { uploads: [{ name, text, market? }] }
 *     One entry per CSV file. Each file's format is detected from
 *     its header. The legacy "Market Metrics Monthly" format
 *     ignores `market` (it comes from the CSV). The three single-
 *     metric formats (revenue_only, occupancy_only, occupancy_by_
 *     bedrooms) require `market` to be one of PUBLIC_MARKETS,
 *     since the CSV itself doesn't carry market context.
 *
 * Routing:
 *   - market_metrics_monthly + revenue_only + occupancy_only
 *     upsert into market_metrics_monthly. revenue_only and
 *     occupancy_only fill only the metric they carry; other
 *     metric columns stay whatever was there from previous uploads.
 *   - occupancy_by_bedrooms upserts into
 *     market_occupancy_by_bedroom_monthly.
 *
 * This route uses the service-role key (writeClient).
 */

type UploadEntry = { name?: string; text?: string; market?: string };
type IngestBody = { csv?: string; uploads?: UploadEntry[] };

type SummaryEntry = {
  market: string;
  months_in_upload: number;
  latest_month: string;
  latest_month_pretty: string;
};

type IngestSuccess = {
  ok: true;
  accepted: number;
  skipped_off_market: number;
  bedroom_rows: number;
  summary: SummaryEntry[];
  warnings: string[];
};

type IngestError = { error: string; warnings?: string[] };

export async function POST(request: NextRequest) {
  let body: IngestBody;
  try {
    body = (await request.json()) as IngestBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // Normalize the two body shapes into a uniform list of uploads.
  const uploads: UploadEntry[] = [];
  if (typeof body.csv === "string" && body.csv.trim().length > 0) {
    uploads.push({ name: "legacy", text: body.csv });
  }
  if (Array.isArray(body.uploads)) {
    for (const u of body.uploads) {
      if (u && typeof u.text === "string" && u.text.trim().length > 0) {
        uploads.push(u);
      }
    }
  }
  if (uploads.length === 0) {
    return NextResponse.json({ error: "no CSV uploads provided" }, { status: 400 });
  }

  const publicSet = new Set<string>(PUBLIC_MARKETS);
  const warnings: string[] = [];
  let skippedOffMarket = 0;

  // Aggregate by (market_slug, month) for market_metrics_monthly so a
  // revenue-only CSV + an occupancy-only CSV for the same market+month
  // collapse into one upsert with both fields populated.
  const headlineByKey = new Map<
    string,
    {
      market_slug: string;
      month: string;
      active_listings: number | null;
      occupancy_rate: number | null;
      avg_listing_revenue: number | null;
      source: string;
    }
  >();
  const headlineKey = (market: string, month: string) => `${market}|${month}|airdna`;
  const upsertHeadline = (
    market: string,
    month: string,
    field: "active_listings" | "occupancy_rate" | "avg_listing_revenue",
    value: number | null,
  ) => {
    const k = headlineKey(market, month);
    const cur = headlineByKey.get(k) ?? {
      market_slug: market,
      month,
      active_listings: null,
      occupancy_rate: null,
      avg_listing_revenue: null,
      source: "airdna",
    };
    if (value !== null) cur[field] = value;
    headlineByKey.set(k, cur);
  };

  const bedroomRows: Array<{
    market_slug: string;
    month: string;
    bedrooms: string;
    occupancy_rate: number | null;
    source: string;
  }> = [];

  for (const upload of uploads) {
    const text = upload.text!;
    const fileLabel = upload.name ?? "(unnamed file)";
    const format: AirDnaCsvFormat | null = detectAirDnaCsvFormat(text);
    if (!format) {
      return NextResponse.json(
        {
          error: `${fileLabel}: could not recognize CSV format. Expected one of: Market Metrics Monthly, Date+Revenue, Date+Occupancy, Date+per-bedroom occupancy.`,
        },
        { status: 400 },
      );
    }

    if (format === "market_metrics_monthly") {
      let parsed;
      try {
        parsed = parseAirDnaCsv(text);
      } catch (err) {
        return NextResponse.json(
          { error: `${fileLabel}: ${err instanceof Error ? err.message : String(err)}` },
          { status: 400 },
        );
      }
      warnings.push(...parsed.warnings.map((w) => `${fileLabel}: ${w}`));
      for (const r of parsed.rows) {
        if (!publicSet.has(r.market_slug)) {
          skippedOffMarket++;
          continue;
        }
        upsertHeadline(r.market_slug, r.month, "active_listings", r.active_listings);
        upsertHeadline(r.market_slug, r.month, "occupancy_rate", r.occupancy_rate);
        upsertHeadline(r.market_slug, r.month, "avg_listing_revenue", r.avg_listing_revenue);
      }
      continue;
    }

    // Three single-metric formats: caller must specify which market the
    // CSV belongs to, and it has to be one we publish.
    const market = (upload.market ?? "").trim().toLowerCase();
    if (!publicSet.has(market)) {
      return NextResponse.json(
        {
          error: `${fileLabel}: this CSV is a "${format}" export which doesn't carry a market column. Pick one of (${PUBLIC_MARKETS.join(", ")}) for it before uploading.`,
        },
        { status: 400 },
      );
    }

    try {
      if (format === "revenue_only") {
        const parsed = parseRevenueOnlyCsv(text);
        warnings.push(...parsed.warnings.map((w) => `${fileLabel}: ${w}`));
        for (const r of parsed.rows) {
          upsertHeadline(market, r.month, "avg_listing_revenue", r.avg_listing_revenue);
        }
      } else if (format === "occupancy_only") {
        const parsed = parseOccupancyOnlyCsv(text);
        warnings.push(...parsed.warnings.map((w) => `${fileLabel}: ${w}`));
        for (const r of parsed.rows) {
          upsertHeadline(market, r.month, "occupancy_rate", r.occupancy_rate);
        }
      } else if (format === "occupancy_by_bedrooms") {
        const parsed = parseOccupancyByBedroomsCsv(text);
        warnings.push(...parsed.warnings.map((w) => `${fileLabel}: ${w}`));
        for (const r of parsed.rows) {
          bedroomRows.push({
            market_slug: market,
            month: r.month,
            bedrooms: r.bedrooms,
            occupancy_rate: r.occupancy_rate,
            source: "airdna",
          });
        }
      }
    } catch (err) {
      return NextResponse.json(
        { error: `${fileLabel}: ${err instanceof Error ? err.message : String(err)}` },
        { status: 400 },
      );
    }
  }

  const headlineRows = [...headlineByKey.values()];
  if (headlineRows.length === 0 && bedroomRows.length === 0) {
    const payload: IngestError = {
      error: `no rows matched the markets we publish (${PUBLIC_MARKETS.join(", ")}). Check the CSVs and the market selector.`,
      warnings,
    };
    return NextResponse.json(payload, { status: 400 });
  }

  const supa = writeClient();

  if (headlineRows.length > 0) {
    // Don't blow away pre-existing metric columns. If a revenue-only
    // CSV has only avg_listing_revenue filled, we need to merge it
    // into the existing row's other columns. Read first, then upsert
    // a merged object.
    const monthsByMarket = new Map<string, Set<string>>();
    for (const r of headlineRows) {
      const set = monthsByMarket.get(r.market_slug) ?? new Set<string>();
      set.add(r.month);
      monthsByMarket.set(r.market_slug, set);
    }

    for (const [market, months] of monthsByMarket) {
      const monthList = [...months];
      const { data: existing } = await supa
        .from("market_metrics_monthly")
        .select("market_slug, month, active_listings, occupancy_rate, avg_listing_revenue, source")
        .eq("market_slug", market)
        .eq("source", "airdna")
        .in("month", monthList);
      const existingByMonth = new Map<string, Record<string, unknown>>();
      for (const row of (existing ?? []) as Array<{ month: string } & Record<string, unknown>>) {
        // Supabase serialises `date` as YYYY-MM-DD; the upsert key uses
        // the same shape so no normalisation needed here.
        existingByMonth.set(row.month, row);
      }
      const merged = headlineRows
        .filter((r) => r.market_slug === market)
        .map((r) => {
          const prev = existingByMonth.get(r.month) ?? {};
          return {
            market_slug: market,
            month: r.month,
            source: "airdna",
            active_listings:
              r.active_listings !== null ? r.active_listings : (prev.active_listings ?? null),
            occupancy_rate:
              r.occupancy_rate !== null ? r.occupancy_rate : (prev.occupancy_rate ?? null),
            avg_listing_revenue:
              r.avg_listing_revenue !== null
                ? r.avg_listing_revenue
                : (prev.avg_listing_revenue ?? null),
          };
        });
      const { error } = await supa
        .from("market_metrics_monthly")
        .upsert(merged, { onConflict: "market_slug,month,source" });
      if (error) {
        return NextResponse.json({ error: error.message } satisfies IngestError, { status: 500 });
      }
    }
  }

  if (bedroomRows.length > 0) {
    const { error } = await supa
      .from("market_occupancy_by_bedroom_monthly")
      .upsert(bedroomRows, { onConflict: "market_slug,month,bedrooms,source" });
    if (error) {
      return NextResponse.json({ error: error.message } satisfies IngestError, { status: 500 });
    }
  }

  // Per-market headline summary -- bedroom uploads don't surface here
  // since they're a separate data dimension; the response field
  // bedroom_rows reports the count.
  const byMarket: Record<string, { months: string[]; latest: string }> = {};
  for (const r of headlineRows) {
    if (!byMarket[r.market_slug]) byMarket[r.market_slug] = { months: [], latest: r.month };
    byMarket[r.market_slug].months.push(r.month);
    if (r.month > byMarket[r.market_slug].latest)
      byMarket[r.market_slug].latest = r.month;
  }
  const summary: SummaryEntry[] = Object.entries(byMarket).map(([market, info]) => ({
    market,
    months_in_upload: info.months.length,
    latest_month: info.latest,
    latest_month_pretty: formatMonthLong(info.latest),
  }));

  const response: IngestSuccess = {
    ok: true,
    accepted: headlineRows.length,
    skipped_off_market: skippedOffMarket,
    bedroom_rows: bedroomRows.length,
    summary,
    warnings,
  };
  return NextResponse.json(response);
}
