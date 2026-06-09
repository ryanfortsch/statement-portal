/**
 * Parsers for AirDNA CSV exports.
 *
 * AirDNA's UI lets you export several different shapes from the same
 * market view. Helm now accepts four of them:
 *
 *   1. "Market Metrics Monthly" combined export
 *        id;market;month;active_listings;occupancy_rate;avg_listing_revenue;...
 *      Original format. Has a `market` column so no UI selector needed.
 *
 *   2. "Average Revenue, last N years"
 *        Date,Revenue
 *      Per-month average listing revenue for a single market (the one
 *      selected in AirDNA before export). The market has to come from
 *      the UI dropdown -- it isn't in the CSV.
 *
 *   3. "Occupancy, since 2018" (or any single-metric occupancy export)
 *        Date,Occupancy
 *      Per-month overall occupancy for a single market.
 *
 *   4. "Occupancy by Bedrooms, last N years"
 *        Date,1 bedroom,2 bedroom,3 bedroom,4 bedroom,5 bedroom,6+ bedroom
 *      Per-month occupancy split by bedroom count. Stored in a separate
 *      table (market_occupancy_by_bedroom_monthly) because the shape
 *      doesn't fit market_metrics_monthly.
 *
 * detectAirDnaCsvFormat() sniffs the header line and dispatches; the
 * server route then routes each row to the appropriate table.
 *
 * We map by column NAME, not position, so a different export profile
 * (or AirDNA switching delimiter) doesn't silently corrupt the ingest.
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

// ────────────────────────────────────────────────────────────────────
// Format detection
// ────────────────────────────────────────────────────────────────────

export type AirDnaCsvFormat =
  | "market_metrics_monthly"   // 1) combined export with a market column
  | "revenue_only"             // 2) Date,Revenue
  | "occupancy_only"           // 3) Date,Occupancy
  | "occupancy_by_bedrooms";   // 4) Date,1 bedroom,...

/** Sniff the header line and return which export shape this is. */
export function detectAirDnaCsvFormat(text: string): AirDnaCsvFormat | null {
  const clean = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const firstLine = clean.split("\n").find((l) => l.trim().length > 0);
  if (!firstLine) return null;
  const delim = detectDelimiter(firstLine);
  const headers = splitCsvLine(firstLine, delim).map((h) => h.toLowerCase());

  if (REQUIRED_COLUMNS.every((c) => headers.includes(c))) return "market_metrics_monthly";

  const hasDate = headers.includes("date");
  if (hasDate && headers.some((h) => /^\d+\+?\s*bedroom/.test(h))) return "occupancy_by_bedrooms";
  if (hasDate && headers.includes("occupancy")) return "occupancy_only";
  if (hasDate && headers.includes("revenue")) return "revenue_only";

  return null;
}

// ────────────────────────────────────────────────────────────────────
// New-format parsers (market_slug supplied by caller)
// ────────────────────────────────────────────────────────────────────

export type RevenueOnlyRow = { month: string; avg_listing_revenue: number | null; lineNumber: number };
export type OccupancyOnlyRow = { month: string; occupancy_rate: number | null; lineNumber: number };
export type OccupancyByBedroomRow = {
  month: string;
  bedrooms: string; // '1', '2', '3', '4', '5', '6+'
  occupancy_rate: number | null;
  lineNumber: number;
};

export type RevenueOnlyResult = { rows: RevenueOnlyRow[]; warnings: string[] };
export type OccupancyOnlyResult = { rows: OccupancyOnlyRow[]; warnings: string[] };
export type OccupancyByBedroomResult = { rows: OccupancyByBedroomRow[]; warnings: string[] };

function readHeaders(text: string): { headers: string[]; lines: string[]; delim: "," | ";" } {
  const clean = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const lines = clean.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error("CSV is empty");
  const delim = detectDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delim).map((h) => h.toLowerCase());
  return { headers, lines, delim };
}

export function parseRevenueOnlyCsv(text: string): RevenueOnlyResult {
  const { headers, lines, delim } = readHeaders(text);
  const iDate = headers.indexOf("date");
  const iRevenue = headers.indexOf("revenue");
  if (iDate < 0 || iRevenue < 0) {
    throw new Error(`Revenue CSV needs Date + Revenue columns. Found: ${headers.join(", ")}`);
  }

  const rows: RevenueOnlyRow[] = [];
  const warnings: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], delim);
    const month = normalizeMonth(cells[iDate]);
    if (!month) {
      warnings.push(`Line ${i}: could not parse date "${cells[iDate]}" — skipped`);
      continue;
    }
    rows.push({ month, avg_listing_revenue: parseNum(cells[iRevenue]), lineNumber: i });
  }
  return { rows, warnings };
}

export function parseOccupancyOnlyCsv(text: string): OccupancyOnlyResult {
  const { headers, lines, delim } = readHeaders(text);
  const iDate = headers.indexOf("date");
  const iOcc = headers.indexOf("occupancy");
  if (iDate < 0 || iOcc < 0) {
    throw new Error(`Occupancy CSV needs Date + Occupancy columns. Found: ${headers.join(", ")}`);
  }

  const rows: OccupancyOnlyRow[] = [];
  const warnings: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], delim);
    const month = normalizeMonth(cells[iDate]);
    if (!month) {
      warnings.push(`Line ${i}: could not parse date "${cells[iDate]}" — skipped`);
      continue;
    }
    rows.push({ month, occupancy_rate: parseNum(cells[iOcc]), lineNumber: i });
  }
  return { rows, warnings };
}

export function parseOccupancyByBedroomsCsv(text: string): OccupancyByBedroomResult {
  const { headers, lines, delim } = readHeaders(text);
  const iDate = headers.indexOf("date");
  if (iDate < 0) {
    throw new Error(`Bedroom occupancy CSV needs a Date column. Found: ${headers.join(", ")}`);
  }
  // Bedroom columns look like "1 bedroom", "2 bedroom", ..., "6+ bedroom".
  // Map column index -> bucket label.
  const bedroomCols: Array<{ idx: number; bucket: string }> = [];
  headers.forEach((h, idx) => {
    const m = h.match(/^(\d+\+?)\s*bedroom/);
    if (m) bedroomCols.push({ idx, bucket: m[1] });
  });
  if (bedroomCols.length === 0) {
    throw new Error(`No bedroom columns found. Headers: ${headers.join(", ")}`);
  }

  const rows: OccupancyByBedroomRow[] = [];
  const warnings: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], delim);
    const month = normalizeMonth(cells[iDate]);
    if (!month) {
      warnings.push(`Line ${i}: could not parse date "${cells[iDate]}" — skipped`);
      continue;
    }
    for (const { idx, bucket } of bedroomCols) {
      rows.push({
        month,
        bedrooms: bucket,
        occupancy_rate: parseNum(cells[idx]),
        lineNumber: i,
      });
    }
  }
  return { rows, warnings };
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
