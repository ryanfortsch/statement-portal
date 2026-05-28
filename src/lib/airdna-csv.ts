/**
 * Parser for AirDNA's "Market Metrics Monthly" CSV export.
 *
 * Real-world sample header (semicolon-delimited):
 *   id;market;month;active_listings;occupancy_rate;avg_listing_revenue;source;created_at
 *
 * We map by column NAME, not position, so a different export profile
 * (or AirDNA switching to comma-delimited) doesn't silently corrupt
 * the ingest. Required columns are market + month + the three metric
 * columns; id/source/created_at are tolerated but ignored.
 *
 * Returned rows are normalized into the shape the
 * `market_metrics_monthly` table expects.
 */

export type ParsedRow = {
  market_slug: string;
  month: string; // YYYY-MM-DD (first of month)
  active_listings: number | null;
  occupancy_rate: number | null;
  avg_listing_revenue: number | null;
  source: string; // always 'airdna' for this parser
  /** Original row index in the CSV (1-based, excluding header) — for error messages */
  lineNumber: number;
};

export type ParseResult = {
  rows: ParsedRow[];
  /** Row-level warnings that didn't stop parsing (skipped/clamped). */
  warnings: string[];
};

const REQUIRED_COLUMNS = [
  "market",
  "month",
  "active_listings",
  "occupancy_rate",
  "avg_listing_revenue",
] as const;

/** Detect the delimiter from the header line. AirDNA's export is
 *  semicolon-delimited; many CSV viewers re-save as comma. */
function detectDelimiter(headerLine: string): "," | ";" {
  const semis = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  return semis > commas ? ";" : ",";
}

/** Minimal CSV splitter that handles quoted values containing the
 *  delimiter. AirDNA's export doesn't use quoted values today, but
 *  this keeps us safe if it changes. */
function splitCsvLine(line: string, delim: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delim && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

/** Normalize a month value to YYYY-MM-DD (first of month). Accepts
 *  '2026-04-01', '2026-04', '4/1/2026', '04/01/2026'. */
function normalizeMonth(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  // YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS...
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (isoMatch) {
    const [, y, m] = isoMatch;
    return `${y}-${m}-01`;
  }

  // M/D/YYYY or MM/DD/YYYY
  const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const [, m, , y] = usMatch;
    return `${y}-${m.padStart(2, "0")}-01`;
  }

  return null;
}

function parseNum(raw: string | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  const stripped = raw.replace(/[$,%\s]/g, "");
  if (stripped === "") return null;
  const n = Number(stripped);
  return Number.isFinite(n) ? n : null;
}

export function parseAirDnaCsv(text: string): ParseResult {
  // Strip BOM if present.
  const clean = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const lines = clean.split("\n").filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    throw new Error("CSV is empty");
  }

  const delim = detectDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delim).map((h) => h.toLowerCase());

  const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length) {
    throw new Error(
      `CSV missing required column(s): ${missing.join(", ")}. ` +
        `Found columns: ${headers.join(", ")}`,
    );
  }

  const idx = (col: string) => headers.indexOf(col);
  const iMarket = idx("market");
  const iMonth = idx("month");
  const iListings = idx("active_listings");
  const iOcc = idx("occupancy_rate");
  const iRevenue = idx("avg_listing_revenue");

  const rows: ParsedRow[] = [];
  const warnings: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], delim);
    const lineNumber = i; // 1-based, excluding header

    const market = cells[iMarket]?.trim().toLowerCase();
    if (!market) {
      warnings.push(`Line ${lineNumber}: missing market — skipped`);
      continue;
    }

    const month = normalizeMonth(cells[iMonth]);
    if (!month) {
      warnings.push(
        `Line ${lineNumber} (${market}): could not parse month "${cells[iMonth]}" — skipped`,
      );
      continue;
    }

    rows.push({
      market_slug: market,
      month,
      active_listings: parseNum(cells[iListings]),
      occupancy_rate: parseNum(cells[iOcc]),
      avg_listing_revenue: parseNum(cells[iRevenue]),
      source: "airdna",
      lineNumber,
    });
  }

  return { rows, warnings };
}
