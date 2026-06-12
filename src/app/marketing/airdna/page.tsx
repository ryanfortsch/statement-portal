"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { HelmMasthead } from "@/components/HelmMasthead";
import { HelmHero } from "@/components/HelmHero";
import {
  detectAirDnaCsvFormat,
  parseAirDnaCsv,
  parseOccupancyByBedroomsCsv,
  parseOccupancyOnlyCsv,
  parseRevenueOnlyCsv,
  type AirDnaCsvFormat,
} from "@/lib/airdna-csv";

/**
 * Helm · Marketing · AirDNA upload
 *
 * Workflow:
 *   1. User picks (or drops) one or more AirDNA CSVs. Each file's
 *      format is sniffed from its header:
 *        - "Market Metrics Monthly" combined export (has a market
 *          column, no UI selector needed).
 *        - Single-metric exports (Date+Revenue, Date+Occupancy,
 *          Date+per-bedroom occupancy). These don't carry a market
 *          column, so the page exposes a market selector that
 *          applies to all single-metric files in the batch.
 *   2. Browser parses each file locally so the preview reflects
 *      exactly what the server will store.
 *   3. User clicks "Save" → POST /api/airdna/ingest with
 *      { uploads: [{name, text, market}] } → tables upserted.
 *   4. The public /api/markets/airdna/[slug] endpoint starts
 *      returning the merged month within the cache TTL.
 *
 * Below the upload card we show the latest month currently in the DB
 * per market so the user can tell at a glance whether they're adding
 * new data or just re-uploading what's there.
 */

const PUBLIC_MARKETS = ["gloucester", "rockport"] as const;
type PublicMarket = (typeof PUBLIC_MARKETS)[number];

type LatestByMarket = Record<
  string,
  { latest_month: string; latest_month_pretty: string; months_count: number } | undefined
>;

type IngestResponse = {
  ok?: true;
  accepted?: number;
  skipped_off_market?: number;
  bedroom_rows?: number;
  summary?: {
    market: string;
    months_in_upload: number;
    latest_month: string;
    latest_month_pretty: string;
  }[];
  warnings?: string[];
  error?: string;
};

type ParsedFile = {
  name: string;
  text: string;
  format: AirDnaCsvFormat | null;
  // Summary stats for the preview, format-dependent.
  summary:
    | { kind: "market_metrics"; rowsByMarket: Record<string, number>; offMarket: number; latestByMarket: Record<string, string> }
    | { kind: "revenue_only"; months: number; latest: string | null; latestRevenue: number | null }
    | { kind: "occupancy_only"; months: number; latest: string | null; latestOccupancy: number | null }
    | { kind: "occupancy_by_bedrooms"; months: number; bedroomBuckets: string[]; latest: string | null }
    | { kind: "error"; message: string };
  warnings: string[];
};

function readableFormat(format: AirDnaCsvFormat | null): string {
  if (format === "market_metrics_monthly") return "Market Metrics Monthly";
  if (format === "revenue_only") return "Average Revenue";
  if (format === "occupancy_only") return "Occupancy";
  if (format === "occupancy_by_bedrooms") return "Occupancy by Bedrooms";
  return "Unrecognized";
}

function needsMarketSelector(format: AirDnaCsvFormat | null): boolean {
  return (
    format === "revenue_only" ||
    format === "occupancy_only" ||
    format === "occupancy_by_bedrooms"
  );
}

function parseFile(name: string, text: string): ParsedFile {
  const format = detectAirDnaCsvFormat(text);
  if (!format) {
    return {
      name,
      text,
      format: null,
      summary: { kind: "error", message: "Header didn't match any known AirDNA export shape." },
      warnings: [],
    };
  }
  try {
    if (format === "market_metrics_monthly") {
      const parsed = parseAirDnaCsv(text);
      const rowsByMarket: Record<string, number> = {};
      const latestByMarket: Record<string, string> = {};
      let offMarket = 0;
      for (const r of parsed.rows) {
        if (!(PUBLIC_MARKETS as readonly string[]).includes(r.market_slug)) {
          offMarket++;
          continue;
        }
        rowsByMarket[r.market_slug] = (rowsByMarket[r.market_slug] ?? 0) + 1;
        if (!latestByMarket[r.market_slug] || r.month > latestByMarket[r.market_slug]) {
          latestByMarket[r.market_slug] = r.month;
        }
      }
      return {
        name,
        text,
        format,
        summary: { kind: "market_metrics", rowsByMarket, offMarket, latestByMarket },
        warnings: parsed.warnings,
      };
    }
    if (format === "revenue_only") {
      const parsed = parseRevenueOnlyCsv(text);
      const latest = parsed.rows.reduce<{ month: string; revenue: number | null } | null>(
        (acc, r) => (acc === null || r.month > acc.month ? { month: r.month, revenue: r.avg_listing_revenue } : acc),
        null,
      );
      return {
        name,
        text,
        format,
        summary: {
          kind: "revenue_only",
          months: parsed.rows.length,
          latest: latest?.month ?? null,
          latestRevenue: latest?.revenue ?? null,
        },
        warnings: parsed.warnings,
      };
    }
    if (format === "occupancy_only") {
      const parsed = parseOccupancyOnlyCsv(text);
      const latest = parsed.rows.reduce<{ month: string; occ: number | null } | null>(
        (acc, r) => (acc === null || r.month > acc.month ? { month: r.month, occ: r.occupancy_rate } : acc),
        null,
      );
      return {
        name,
        text,
        format,
        summary: {
          kind: "occupancy_only",
          months: parsed.rows.length,
          latest: latest?.month ?? null,
          latestOccupancy: latest?.occ ?? null,
        },
        warnings: parsed.warnings,
      };
    }
    // occupancy_by_bedrooms
    const parsed = parseOccupancyByBedroomsCsv(text);
    const monthSet = new Set<string>();
    const buckets = new Set<string>();
    let latest: string | null = null;
    for (const r of parsed.rows) {
      monthSet.add(r.month);
      buckets.add(r.bedrooms);
      if (latest === null || r.month > latest) latest = r.month;
    }
    return {
      name,
      text,
      format,
      summary: {
        kind: "occupancy_by_bedrooms",
        months: monthSet.size,
        bedroomBuckets: [...buckets].sort(),
        latest,
      },
      warnings: parsed.warnings,
    };
  } catch (err) {
    return {
      name,
      text,
      format,
      summary: { kind: "error", message: err instanceof Error ? err.message : String(err) },
      warnings: [],
    };
  }
}

export default function AirDnaPage() {
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [market, setMarket] = useState<PublicMarket>("gloucester");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<IngestResponse | null>(null);
  const [latestByMarket, setLatestByMarket] = useState<LatestByMarket>({});
  const [isDragOver, setIsDragOver] = useState(false);

  const loadLatest = useCallback(async () => {
    const out: LatestByMarket = {};
    for (const slug of PUBLIC_MARKETS) {
      try {
        const res = await fetch(`/api/markets/airdna/${slug}`, { cache: "no-store" });
        if (!res.ok) {
          out[slug] = undefined;
          continue;
        }
        const data = await res.json();
        const monthsCount = Array.isArray(data?.chart?.points) ? data.chart.points.length : 0;
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

  function handleFiles(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    setResult(null);
    const next: ParsedFile[] = [];
    let pending = picked.length;
    Array.from(picked).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        next.push(parseFile(file.name, String(reader.result ?? "")));
        if (--pending === 0) setFiles(next);
      };
      reader.onerror = () => {
        next.push({
          name: file.name,
          text: "",
          format: null,
          summary: { kind: "error", message: "Could not read file" },
          warnings: [],
        });
        if (--pending === 0) setFiles(next);
      };
      reader.readAsText(file);
    });
  }

  const hasError = files.some((f) => f.summary.kind === "error");
  const anyNeedsMarket = files.some((f) => needsMarketSelector(f.format));
  const canSubmit = files.length > 0 && !hasError && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setResult(null);
    try {
      const uploads = files.map((f) => ({
        name: f.name,
        text: f.text,
        market: needsMarketSelector(f.format) ? market : undefined,
      }));
      const res = await fetch("/api/airdna/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploads }),
      });
      const data = (await res.json()) as IngestResponse;
      setResult(data);
      if (res.ok) await loadLatest();
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  const totalParsedRows = useMemo(
    () =>
      files.reduce((sum, f) => {
        if (f.summary.kind === "market_metrics") {
          return sum + Object.values(f.summary.rowsByMarket).reduce((a, b) => a + b, 0);
        }
        if (f.summary.kind === "revenue_only" || f.summary.kind === "occupancy_only") {
          return sum + f.summary.months;
        }
        if (f.summary.kind === "occupancy_by_bedrooms") {
          return sum + f.summary.months * f.summary.bedroomBuckets.length;
        }
        return sum;
      }, 0),
    [files],
  );

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--paper)", color: "var(--ink)" }}>
      <HelmMasthead current="marketing" />

      <HelmHero
        eyebrow="Helm · Marketing · AirDNA"
        title="Update the"
        emphasis="market data"
        titleSuffix="for the towns."
        description="Upload AirDNA CSVs. The combined Market Metrics Monthly export carries its own market column. The single-metric exports (Average Revenue, Occupancy, Occupancy by Bedrooms) need you to pick the market. The charts on risingtidestr.com/markets pull from this within the hour."
      />

      <section className="max-w-[1100px] mx-auto px-10 grid gap-6 md:grid-cols-3" style={{ width: "100%", paddingBottom: 40 }}>
        {/* LEFT: upload + preview */}
        <div className="md:col-span-2">
          <div
            className="rt-card"
            style={{ border: "1px solid var(--ink)", padding: 24, borderRadius: 8, background: "var(--paper-elevated, #fffdf8)" }}
          >
            <h2 style={{ fontFamily: "var(--font-fraunces), serif", fontSize: 22, marginBottom: 8 }}>
              Pick the AirDNA CSV(s)
            </h2>
            <p style={{ marginBottom: 16, color: "var(--ink-muted, #4a5760)" }}>
              In AirDNA, export from the market you want. The page recognises four shapes:
              <strong> Market Metrics Monthly</strong> (combined), <strong>Average Revenue</strong>,
              <strong> Occupancy</strong>, and <strong>Occupancy by Bedrooms</strong>. You can drop multiple
              files at once.
            </p>

            <label
              htmlFor="airdna-file"
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer.types.includes("Files")) setIsDragOver(true);
              }}
              onDragOver={(e) => {
                // Required so the browser fires onDrop. Default is "block drop."
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "copy";
              }}
              onDragLeave={(e) => {
                // Only clear when the cursor actually leaves the label (not when
                // it crosses a child element). Comparing relatedTarget to the
                // label rules out internal moves.
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                setIsDragOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragOver(false);
                handleFiles(e.dataTransfer.files);
              }}
              style={{
                display: "block",
                padding: "24px 16px",
                border: isDragOver ? "2px solid var(--ink)" : "1px dashed var(--ink)",
                borderRadius: 6,
                textAlign: "center",
                cursor: "pointer",
                background: isDragOver ? "var(--paper-elevated, #fffdf8)" : "transparent",
                transition: "background 0.12s, border 0.12s",
              }}
            >
              {files.length > 0 ? (
                <>
                  <div style={{ fontWeight: 600 }}>
                    {files.length} file{files.length === 1 ? "" : "s"} loaded
                  </div>
                  <div style={{ fontSize: 13, color: "var(--ink-muted, #4a5760)", marginTop: 4 }}>
                    Click to pick different files
                  </div>
                </>
              ) : isDragOver ? (
                <div style={{ fontWeight: 600 }}>Drop CSV file(s) to load</div>
              ) : (
                <>
                  <div style={{ fontWeight: 600 }}>Drop CSV file(s) here</div>
                  <div style={{ fontSize: 13, color: "var(--ink-muted, #4a5760)", marginTop: 4 }}>
                    or click to choose
                  </div>
                </>
              )}
              <input
                id="airdna-file"
                type="file"
                accept=".csv,text/csv"
                multiple
                style={{ display: "none" }}
                onChange={(e) => handleFiles(e.target.files)}
              />
            </label>

            {anyNeedsMarket && (
              <div style={{ marginTop: 16 }}>
                <label
                  htmlFor="airdna-market"
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 600,
                    marginBottom: 6,
                  }}
                >
                  Market for single-metric CSVs
                </label>
                <select
                  id="airdna-market"
                  value={market}
                  onChange={(e) => setMarket(e.target.value as PublicMarket)}
                  style={{
                    padding: "8px 10px",
                    border: "1px solid var(--ink)",
                    borderRadius: 6,
                    background: "var(--paper)",
                    color: "var(--ink)",
                    fontSize: 14,
                  }}
                >
                  {PUBLIC_MARKETS.map((m) => (
                    <option key={m} value={m} style={{ textTransform: "capitalize" }}>
                      {m[0].toUpperCase() + m.slice(1)}
                    </option>
                  ))}
                </select>
                <p style={{ fontSize: 12, color: "var(--ink-muted, #4a5760)", marginTop: 6 }}>
                  Single-metric CSVs (Revenue, Occupancy, Occupancy by Bedrooms) don't carry the
                  market in the file. Pick which one this batch belongs to.
                </p>
              </div>
            )}

            {files.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <h3 style={{ fontFamily: "var(--font-fraunces), serif", fontSize: 18, marginBottom: 12 }}>
                  Preview &mdash; {totalParsedRows} row{totalParsedRows === 1 ? "" : "s"} across {files.length} file
                  {files.length === 1 ? "" : "s"}
                </h3>

                {files.map((f) => (
                  <FilePreview key={f.name} file={f} market={market} />
                ))}

                <button
                  type="button"
                  disabled={!canSubmit}
                  onClick={submit}
                  style={{
                    padding: "10px 18px",
                    background: canSubmit ? "var(--ink)" : "var(--ink-muted, #999)",
                    color: "var(--paper)",
                    border: "none",
                    borderRadius: 6,
                    cursor: submitting ? "wait" : canSubmit ? "pointer" : "not-allowed",
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
                  border: result.ok ? "1px solid #2f7a3e" : "1px solid var(--signal, #c85a3a)",
                }}
              >
                {result.ok ? (
                  <>
                    <strong>Saved.</strong> {result.accepted ?? 0} headline rows upserted
                    {result.skipped_off_market ? `, ${result.skipped_off_market} off-market rows ignored` : ""}
                    {result.bedroom_rows ? `, ${result.bedroom_rows} bedroom-occupancy rows stored` : ""}
                    .
                    {result.summary && result.summary.length > 0 && (
                      <ul style={{ marginTop: 8, paddingLeft: 18 }}>
                        {result.summary.map((s) => (
                          <li key={s.market}>
                            <span style={{ textTransform: "capitalize" }}>{s.market}</span> now current
                            through <strong>{s.latest_month_pretty}</strong>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p style={{ marginTop: 10, fontSize: 13, color: "var(--ink-muted, #4a5760)" }}>
                      The risingtidestr.com market pages refresh within an hour.
                    </p>
                  </>
                ) : (
                  <strong style={{ color: "var(--signal, #c85a3a)" }}>{result.error ?? "Upload failed"}</strong>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: what's already in the DB */}
        <div>
          <div
            className="rt-card"
            style={{ border: "1px solid var(--ink)", padding: 20, borderRadius: 8, background: "var(--paper-elevated, #fffdf8)" }}
          >
            <h2 style={{ fontFamily: "var(--font-fraunces), serif", fontSize: 18, marginBottom: 12 }}>
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
                  <div style={{ textTransform: "capitalize", fontWeight: 600, marginBottom: 2 }}>{slug}</div>
                  {info ? (
                    <div style={{ fontSize: 13, color: "var(--ink-muted, #4a5760)" }}>
                      Through <strong>{info.latest_month_pretty}</strong>
                      <br />
                      {info.months_count} months on file
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: "var(--ink-muted, #4a5760)" }}>No data</div>
                  )}
                  <div style={{ marginTop: 6, fontSize: 13 }}>
                    <Link
                      href={`https://risingtidestr.com/markets/${slug}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "var(--signal, #c85a3a)", textDecoration: "underline" }}
                    >
                      View public page &rarr;
                    </Link>
                  </div>
                </div>
              );
            })}

            <p style={{ fontSize: 12, color: "var(--ink-muted, #4a5760)", marginTop: 4, lineHeight: 1.5 }}>
              AirDNA publishes the previous month around the 15th. If a market is missing the
              previous month past the 20th, Helm will text you.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function FilePreview({ file, market }: { file: ParsedFile; market: PublicMarket }) {
  const errorBox = (msg: string) => (
    <div
      style={{
        marginBottom: 16,
        padding: 12,
        background: "#fbece8",
        border: "1px solid var(--signal, #c85a3a)",
        borderRadius: 6,
      }}
    >
      <strong>{file.name}</strong>
      <div style={{ fontSize: 13, color: "var(--signal, #c85a3a)", marginTop: 4 }}>{msg}</div>
    </div>
  );

  if (file.summary.kind === "error") return errorBox(file.summary.message);

  const card = (children: React.ReactNode) => (
    <div
      style={{
        marginBottom: 16,
        padding: 12,
        background: "var(--paper)",
        border: "1px solid var(--ink)",
        borderRadius: 6,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, gap: 12 }}>
        <strong>{file.name}</strong>
        <span
          style={{
            fontSize: 12,
            color: "var(--ink-muted, #4a5760)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          {readableFormat(file.format)}
        </span>
      </div>
      <div style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: 13, color: "var(--ink-muted, #4a5760)" }}>
        {children}
      </div>
      {file.warnings.length > 0 && (
        <ul style={{ marginTop: 8, fontSize: 12, color: "var(--signal, #c85a3a)", paddingLeft: 16 }}>
          {file.warnings.slice(0, 3).map((w, i) => (
            <li key={i}>{w}</li>
          ))}
          {file.warnings.length > 3 && <li>(+{file.warnings.length - 3} more)</li>}
        </ul>
      )}
    </div>
  );

  if (file.summary.kind === "market_metrics") {
    const s = file.summary;
    return card(
      <>
        {PUBLIC_MARKETS.map((m) => {
          const rows = s.rowsByMarket[m] ?? 0;
          const latest = s.latestByMarket[m];
          return (
            <div key={m}>
              <span style={{ textTransform: "capitalize" }}>{m}</span>: {rows} month
              {rows === 1 ? "" : "s"}
              {latest ? ` · latest ${latest}` : ""}
            </div>
          );
        })}
        {s.offMarket > 0 && <div>{s.offMarket} rows for other markets will be skipped</div>}
      </>,
    );
  }

  if (file.summary.kind === "revenue_only") {
    const s = file.summary;
    return card(
      <>
        Market <span style={{ textTransform: "capitalize" }}>{market}</span> · {s.months} month
        {s.months === 1 ? "" : "s"} · latest {s.latest ?? "—"} · revenue $
        {s.latestRevenue?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? "—"}
      </>,
    );
  }

  if (file.summary.kind === "occupancy_only") {
    const s = file.summary;
    return card(
      <>
        Market <span style={{ textTransform: "capitalize" }}>{market}</span> · {s.months} month
        {s.months === 1 ? "" : "s"} · latest {s.latest ?? "—"} · occupancy {s.latestOccupancy ?? "—"}%
      </>,
    );
  }

  // occupancy_by_bedrooms
  const s = file.summary;
  return card(
    <>
      Market <span style={{ textTransform: "capitalize" }}>{market}</span> · {s.months} month
      {s.months === 1 ? "" : "s"} · buckets {s.bedroomBuckets.join(", ") || "—"} · latest{" "}
      {s.latest ?? "—"}
    </>,
  );
}
