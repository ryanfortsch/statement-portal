import { NextRequest, NextResponse } from "next/server";
import {
  PUBLIC_MARKETS,
  formatMonthLong,
  previousMonthKey,
  readLatestMonthByMarket,
} from "@/lib/market-metrics";
import { helmBaseUrl } from "@/lib/daily-brief";
import { listPhoneNumbers, normalizePhone, sendMessage } from "@/lib/quo";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/cron/airdna-reminder
 *
 * AirDNA publishes the prior month's data around the 15th. This cron
 * fires on the 15th and again on the 20th (configured in
 * vercel.json). If any publicly-rendered market is missing the
 * previous month's reading by then, we text Dotti via Quo with a
 * link to /marketing/airdna so she can upload the CSV.
 *
 * No-op when all markets are current: a missing-month list of zero
 * returns ok: true, sent: false. That keeps the cron quiet so the
 * absence of a text means "we're in good shape."
 *
 * Env (same pattern as cron/daily-brief):
 *   DOTTI_PHONE     - E.164 recipient. Required.
 *   QUO_FROM_NUMBER - E.164 of the Quo line to send from. Optional.
 *   CRON_SECRET     - Optional bearer token check.
 *
 * Manual smoke test:
 *   curl 'https://<helm>/api/cron/airdna-reminder?dry=1' \
 *     -H "Authorization: Bearer $CRON_SECRET"
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dry = url.searchParams.get("dry") === "1";

  try {
    const latest = await readLatestMonthByMarket();
    const expected = previousMonthKey(new Date());
    const expectedPretty = formatMonthLong(expected);

    const missing = PUBLIC_MARKETS.filter((slug) => {
      const have = latest[slug];
      return !have || have < expected;
    });

    if (missing.length === 0) {
      return NextResponse.json({
        ok: true,
        sent: false,
        reason: "all public markets current",
        expected,
        latest,
      });
    }

    const link = `${helmBaseUrl()}/marketing/airdna`;
    const subjects = missing
      .map((m) => m.charAt(0).toUpperCase() + m.slice(1))
      .join(" + ");
    const body = `Helm · AirDNA reminder\n${subjects} missing ${expectedPretty}. Upload at ${link}`;

    if (dry) {
      return NextResponse.json({
        ok: true,
        dry: true,
        missing,
        expected,
        body,
        latest,
      });
    }

    const to = process.env.DOTTI_PHONE;
    if (!to) {
      return NextResponse.json(
        {
          error: "DOTTI_PHONE not set; add the E.164 recipient to Vercel env",
          missing,
          expected,
        },
        { status: 500 },
      );
    }

    let from = process.env.QUO_FROM_NUMBER;
    if (!from) {
      const phones = await listPhoneNumbers();
      if (!phones.length) {
        return NextResponse.json(
          {
            error:
              "No Quo phone numbers available; set QUO_FROM_NUMBER or check Quo config",
          },
          { status: 500 },
        );
      }
      from = phones[0].number;
    }

    const toNorm = to.startsWith("+") ? to : `+1${normalizePhone(to)}`;
    const fromNorm = from.startsWith("+") ? from : `+1${normalizePhone(from)}`;

    const sent = await sendMessage({
      from: fromNorm,
      to: toNorm,
      content: body,
    });

    return NextResponse.json({
      ok: true,
      sent: true,
      sent_id: sent.id,
      to: toNorm,
      missing,
      expected,
    });
  } catch (err) {
    console.error("[cron/airdna-reminder]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
