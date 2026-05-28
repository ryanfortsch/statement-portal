"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { HelmMasthead } from "@/components/HelmMasthead";
import { HelmHero } from "@/components/HelmHero";
import { parseAirDnaCsv, type ParsedRow } from "@/lib/airdna-csv";

/**
 * Helm · Marketing · AirDNA upload
 *
 * Workflow:
 *   1. User picks (or drops) the AirDNA "Market Metrics Monthly" CSV.
 *   2. Browser parses it locally with parseAirDnaCsv so we can
 *      preview the rows before hitting the server.
 *   3. Preview shows the rows that will be written (gloucester +
 *      rockport, the markets the public site renders), separately
 *      from rows that will be skipped (other AirDNA markets).
 *   4. User clicks "Save" → POST /api/airdna/ingest → table is
 *      upserted, and the public /api/markets/airdna/[slug] endpoint
 *      starts returning the new month within the cache TTL.
 *
 * Below the upload card we show the latest month currently in the
 * DB per market so the user can tell at a glance whether they're
 * actually adding new data or just re-uploading what's there.
 */

const PUBLIC_MARKETS = ["gloucester", "rockport"] as const;

type LatestByMarket = Record<
  string,
  { latest_month: string; latest_month_pretty: string; months_count: number } | undefined
>;

type IngestResponse = {
  ok?: true;
  accepted?: number;
  skipped_off_market?: number;
  summary?: {
    market: string;
    months_in_upload: number;
    latest_month: string;
    latest_month_pretty: string;
  }[];
  warnings?: string[];
  error?: string;
};

export default function AirDnaPage() {
  const [csvText, setCsvText] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [parsed, setParsed] = useState<ParsedRow[] | null>(null);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<IngestResponse | null>(null);
  const [latestByMarket, setLatestByMarket] = useState<LatestByMarket>({});

  // Load "what's already in the DB per market" for the right-hand
  // status card. Refresh after a successful upload.
  const loadLatest = useCallback(async () => {
    const out: LatestByMarket = {};
    for (const slug of PUBLIC_MARKETS) {
      try {
        const res = await fetch(`/api/markets/airdna/${slug}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          out[slug] = undefined;
          continue;
        }
        const data = await res.json();
        const monthsCount = Array.isArray(data?.chart?.points)
          ? data.chart.points.length
          : 0;
        out[slug] = {
          latest_month: data?.asOf ?? "",
          latest_month_pretty: data?.asOf?.replace("Data through ", "") ?? "",
          months_count: monthsCount,
        };
      } catch {
        out[slug] = undefined;
      }
    }
    setLatestByMarket(out);
  }, []);

  useEffect(() => {
    void loadLatest();
  }, [loadLatest]);

  function handleFile(file: File) {
    setFileName(file.name);
    setResult(null);
    setParseError(null);
    setParseWarnings([]);
    setParsed(null);

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setCsvText(text);
      try {
        const out = parseAirDnaCsv(text);
        setParsed(out.rows);
        setParseWarnings(out.warnings);
      } catch (err) {
        setParseError(err instanceof Error ? err.message : String(err));
      }
    };
    reader.onerror = () => setParseError("Could not read file");
    reader.readAsText(file);
  }

  const grouped = useMemo(() => {
    if (!parsed) return null;
    const buckets: Record<string, ParsedRow[]> = {};
    for (const row of parsed) {
      if (!buckets[row.market_slug]) buckets[row.market_slug] = [];
      buckets[row.market_slug].push(row);
    }
    const publicRows = parsed.filter((r) =>
      (PUBLIC_MARKETS as readonly string[]).includes(r.market_slug),
    );
    const offMarketCount = parsed.length - publicRows.length;
    const publicByMarket = Object.fromEntries(
      PUBLIC_MARKETS.map((m) => [m, buckets[m] ?? []]),
    ) as Record<(typeof PUBLIC_MARKETS)[number], ParsedRow[]>;
    return { publicByMarket, offMarketCount, totalRows: parsed.length };
  }, [parsed]);

  async function submit() {
    if (!csvText) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/airdna/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText }),
      });
      const data = (await res.json()) as IngestResponse;
      setResult(data);
      if (res.ok) {
        // Refresh "what's in the DB" so the right-hand card moves
        // up to the just-uploaded month.
        await loadLatest();
      }
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--paper)", color: "var(--ink)" }}
    >
      <HelmMasthead current="marketing" />

      <HelmHero
        eyebrow="Helm · Marketing · AirDNA"
        title="Update the"
        emphasis="market data"
        titleSuffix="for the towns."
        description="Upload AirDNA's monthly Market Metrics Monthly CSV. We keep Gloucester and Rockport rows; everything else in the export is ignored. The charts on risingtidestr.com/markets pull from this within the hour."
      />

      <section
        className="max-w-[1100px] mx-auto px-10 grid gap-6 md:grid-cols-3"
        style={{ width: "100%", paddingBottom: 40 }}
      >
        {/* LEFT: upload + preview */}
        <div className="md:col-span-2">
          <div
            className="rt-card"
            style={{
              border: "1px solid var(--ink)",
              padding: 24,
              borderRadius: 8,
              background: "var(--paper-elevated, #fffdf8)",
            }}
          >
            <h2
              style={{
                fontFamily: "var(--font-fraunces), serif",
                fontSize: 22,
                marginBottom: 8,
              }}
            >
              Pick the AirDNA CSV
            </h2>
            <p style={{ marginBottom: 16, color: "var(--ink-muted, #4a5760)" }}>
              In AirDNA, export <strong>Market Metrics &rarr; Monthly</strong> for
              Gloucester and Rockport (or "All markets" — we'll filter). The
              file looks like{" "}
              <code>market_metrics_monthly-export-YYYY-MM-DD.csv</code>.
            </p>

            <label
              htmlFor="airdna-file"
              style={{
                display: "block",
                padding: "16px",
                border: "1px dashed var(--ink)",
                borderRadius: 6,
                textAlign: "center",
                cursor: "pointer",
                background: "transparent",
              }}
            >
              {fileName ? (
                <>
                  <div style={{ fontWeight: 600 }}>{fileName}</div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--ink-muted, #4a5760)",
                      marginTop: 4,
                    }}
                  >
                    Click to pick a different file
                  </div>
                </>
              ) : (
                <>Click to choose a CSV</>
              )}
              <input
                id="airdna-file"
                type="file"
                accept=".csv,text/csv"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
            </label>

            {parseError && (
              <p
                style={{
                  marginTop: 16,
                  color: "var(--signal, #c85a3a)",
                  fontWeight: 500,
                }}
              >
                {parseError}
              </p>
            )}

            {grouped && (
              <div style={{ marginTop: 24 }}>
                <h3
                  style={{
                    fontFamily: "var(--font-fraunces), serif",
                    fontSize: 18,
                    marginBottom: 12,
                  }}
                >
                  Preview &mdash; {grouped.totalRows} row
                  {grouped.totalRows === 1 ? "" : "s"} parsed
                </h3>

                {PUBLIC_MARKETS.map((slug) => {
                  const rows = grouped.publicByMarket[slug];
                  if (rows.length === 0) {
                    return (
                      <div
                        key={slug}
                        style={{
                          marginBottom: 16,
                          padding: 12,
                          background: "var(--paper)",
                          border: "1px solid var(--ink-muted, #d4d0c4)",
                          borderRadius: 6,
                        }}
                      >
                        <strong style={{ textTransform: "capitalize" }}>
                          {slug}
                        </strong>{" "}
                        &mdash; no rows in this CSV
                      </div>
                    );
                  }
                  const latest = rows.reduce((max, r) =>
                    r.month > max.month ? r : max,
                  );
                  return (
                    <div
                      key={slug}
                      style={{
                        marginBottom: 16,
                        padding: 12,
                        background: "var(--paper)",
                        border: "1px solid var(--ink)",
                        borderRadius: 6,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: 8,
                        }}
                      >
                        <strong style={{ textTransform: "capitalize" }}>
                          {slug}
                        </strong>
                        <span style={{ color: "var(--ink-muted, #4a5760)" }}>
                          {rows.length} month{rows.length === 1 ? "" : "s"} &middot;
                          latest {latest.month}
                        </span>
                      </div>
                      <div
                        style={{
                          fontFamily:
                            "var(--font-mono, 'JetBrains Mono', monospace)",
                          fontSize: 13,
                          color: "var(--ink-muted, #4a5760)",
                        }}
                      >
                        {latest.month} &middot; revenue $
                        {latest.avg_listing_revenue?.toLocaleString() ?? "—"}{" "}
                        &middot; occupancy {latest.occupancy_rate ?? "—"}% &middot;
                        listings {latest.active_listings ?? "—"}
                      </div>
                    </div>
                  );
                })}

                {grouped.offMarketCount > 0 && (
                  <p
                    style={{
                      fontSize: 13,
                      color: "var(--ink-muted, #4a5760)",
                      marginBottom: 16,
                    }}
                  >
                    {grouped.offMarketCount} rows for other AirDNA markets will
                    be skipped.
                  </p>
                )}

                {parseWarnings.length > 0 && (
                  <ul
                    style={{
                      fontSize: 13,
                      color: "var(--signal, #c85a3a)",
                      marginBottom: 16,
                      paddingLeft: 18,
                    }}
                  >
                    {parseWarnings.slice(0, 5).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                    {parseWarnings.length > 5 && (
                      <li>(+{parseWarnings.length - 5} more)</li>
                    )}
                  </ul>
                )}

                <button
                  type="button"
                  disabled={submitting}
                  onClick={submit}
                  style={{
                    padding: "10px 18px",
                    background: "var(--ink)",
                    color: "var(--paper)",
                    border: "none",
                    borderRadius: 6,
                    cursor: submitting ? "wait" : "pointer",
                    fontWeight: 600,
                  }}
                >
                  {submitting ? "Saving..." : "Save to database"}
                </button>
              </div>
            )}

            {result && (
              <div
                style={{
                  marginTop: 24,
                  padding: 14,
                  borderRadius: 6,
                  background: result.ok ? "#eef7ed" : "#fbece8",
                  border: result.ok
                    ? "1px solid #2f7a3e"
                    : "1px solid var(--signal, #c85a3a)",
                }}
              >
                {result.ok ? (
                  <>
                    <strong>Saved.</strong> {result.accepted} rows upserted
                    {result.skipped_off_market
                      ? `, ${result.skipped_off_market} off-market rows ignored.`
                      : "."}
                    <ul style={{ marginTop: 8, paddingLeft: 18 }}>
                      {result.summary?.map((s) => (
                        <li key={s.market}>
                          <span style={{ textTransform: "capitalize" }}>
                            {s.market}
                          </span>{" "}
                          now current through{" "}
                          <strong>{s.latest_month_pretty}</strong>
                        </li>
                      ))}
                    </ul>
                    <p
                      style={{
                        marginTop: 10,
                        fontSize: 13,
                        color: "var(--ink-muted, #4a5760)",
                      }}
                    >
                      The risingtidestr.com market pages refresh within an
                      hour.
                    </p>
                  </>
                ) : (
                  <strong style={{ color: "var(--signal, #c85a3a)" }}>
                    {result.error ?? "Upload failed"}
                  </strong>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: what's already in the DB */}
        <div>
          <div
            className="rt-card"
            style={{
              border: "1px solid var(--ink)",
              padding: 20,
              borderRadius: 8,
              background: "var(--paper-elevated, #fffdf8)",
            }}
          >
            <h2
              style={{
                fontFamily: "var(--font-fraunces), serif",
                fontSize: 18,
                marginBottom: 12,
              }}
            >
              Current data
            </h2>
            {PUBLIC_MARKETS.map((slug) => {
              const info = latestByMarket[slug];
              return (
                <div
                  key={slug}
                  style={{
                    paddingBottom: 12,
                    marginBottom: 12,
                    borderBottom: "1px solid var(--ink-muted, #e6e1d2)",
                  }}
                >
                  <div
                    style={{
                      textTransform: "capitalize",
                      fontWeight: 600,
                      marginBottom: 2,
                    }}
                  >
                    {slug}
                  </div>
                  {info ? (
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--ink-muted, #4a5760)",
                      }}
                    >
                      Through <strong>{info.latest_month_pretty}</strong>
                      <br />
                      {info.months_count} months on file
                    </div>
                  ) : (
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--ink-muted, #4a5760)",
                      }}
                    >
                      No data
                    </div>
                  )}
                  <div style={{ marginTop: 6, fontSize: 13 }}>
                    <Link
                      href={`https://risingtidestr.com/markets/${slug}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        color: "var(--signal, #c85a3a)",
                        textDecoration: "underline",
                      }}
                    >
                      View public page &rarr;
                    </Link>
                  </div>
                </div>
              );
            })}

            <p
              style={{
                fontSize: 12,
                color: "var(--ink-muted, #4a5760)",
                marginTop: 4,
                lineHeight: 1.5,
              }}
            >
              AirDNA publishes the previous month around the 15th. If a market
              is missing the previous month past the 20th, Helm will text you.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
