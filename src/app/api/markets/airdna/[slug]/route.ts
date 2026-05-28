import { NextRequest, NextResponse } from "next/server";
import { buildSnapshot, readAllMonths } from "@/lib/market-metrics";

export const runtime = "nodejs";

/**
 * GET /api/markets/airdna/[slug]
 *
 * Public endpoint consumed by the rising-tide-str marketing site
 * (/markets/[town] pages). Returns the full <MarketSnapshot /> data
 * shape derived from `market_metrics_monthly`.
 *
 * - No auth, no rate limit beyond Vercel defaults: the data is
 *   already public-facing on the marketing site.
 * - CORS: allow risingtidestr.com origins so the marketing site
 *   server-fetches without a proxy. (Server fetches don't actually
 *   require CORS, but leaving the headers in case anyone moves the
 *   fetch client-side later.)
 * - Cache: revalidate hourly. AirDNA only drops monthly data, so
 *   shorter than that is wasted; longer makes the post-upload
 *   "new month is live" moment slower.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json(
      { error: "invalid market slug" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  try {
    const rows = await readAllMonths(slug);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "market not found", slug },
        { status: 404, headers: CORS_HEADERS },
      );
    }

    const snapshot = buildSnapshot(rows);
    if (!snapshot) {
      return NextResponse.json(
        { error: "unable to build snapshot", slug },
        { status: 500, headers: CORS_HEADERS },
      );
    }

    return NextResponse.json(snapshot, {
      headers: {
        ...CORS_HEADERS,
        // Public cache hint: edge can serve the same response for
        // an hour, stale-while-revalidate for a day.
        "Cache-Control":
          "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message, slug },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
