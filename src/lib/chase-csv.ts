/**
 * Chase CSV parsers for the Books module. Two formats to handle:
 *
 *   Chase Bank (Checking) CSV
 *     Details, Posting Date, Description, Amount, Type, Balance, Check or Slip #
 *
 *   Chase Credit Card CSV
 *     Transaction Date, Post Date, Description, Category, Type, Amount, Memo
 *
 * Both export from chase.com → Account → Activity → Download. Same CSV-
 * quoting conventions (CRLF line endings, double-quote escapes for
 * embedded commas), but different column shapes.
 *
 * The output type is unified across both formats so /api/books/ingest
 * can persist to ledger_transactions without caring about the source.
 * The CC's "Category" column is preserved on `raw_category` because it's
 * Chase's own first-pass classification (Shopping / Food & Drink / Travel
 * / etc.) -- not the same as Rising Tide's chart of accounts but valuable
 * context for the AI categorizer in Phase 1b-ii.
 */

import { createHash } from 'crypto';

export type ParsedTransaction = {
  /** ISO YYYY-MM-DD. For bank: Posting Date. For CC: Transaction Date. */
  txn_date: string;
  /** ISO YYYY-MM-DD; for CC equals Post Date, for bank equals txn_date. */
  posting_date: string;
  description: string;
  /** Signed dollars: positive = money in, negative = money out. */
  amount: number;
  /** Chase's pre-classification on CC rows ("Shopping", "Travel", etc.). */
  raw_category: string | null;
  /** Chase's "Type" column (DEBIT_CARD / ACH_DEBIT / SALE / RETURN / etc.). */
  raw_type: string | null;
  /** 'chase_bank_csv' | 'chase_cc_csv' */
  source: 'chase_bank_csv' | 'chase_cc_csv';
  /** Raw row preserved so the operator can drill into the original CSV cell. */
  raw_row: Record<string, string>;
};

// ── Generic CSV plumbing (RFC 4180-ish, handles quoted commas + escapes) ─

function parseCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      out.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseCsvRows(text: string): Record<string, string>[] {
  // Chase emits CRLF; normalize.
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.every((v) => v.trim() === '')) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = (values[idx] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

// ── Date helpers ─────────────────────────────────────────────────────────

function isoDateFromUSDate(s: string): string | null {
  // Chase exports "MM/DD/YYYY". Accept "M/D/YYYY" too.
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function parseAmount(s: string): number {
  // Strip $, commas, surrounding quotes. Allow negatives via leading '-'
  // or parens (Chase doesn't use parens, but defensive).
  const cleaned = s.replace(/[$,"\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// ── Chase Bank (Checking) parser ─────────────────────────────────────────

export function parseChaseBankCsv(text: string): ParsedTransaction[] {
  const rows = parseCsvRows(text);
  const out: ParsedTransaction[] = [];
  for (const row of rows) {
    const postingRaw = row['Posting Date'] || row['Post Date'] || row['Date'] || '';
    const iso = isoDateFromUSDate(postingRaw);
    if (!iso) continue; // skip non-data rows (Chase appends a "Totals" footer sometimes)
    const description = row['Description'] || row['DESCRIPTION'] || '';
    const amount = parseAmount(row['Amount'] || row['AMOUNT'] || '0');
    out.push({
      txn_date: iso,
      posting_date: iso,
      description,
      amount,
      raw_category: null,
      raw_type: (row['Type'] || row['Details'] || '').trim() || null,
      source: 'chase_bank_csv',
      raw_row: row,
    });
  }
  return out;
}

// ── Chase Credit Card parser ─────────────────────────────────────────────

export function parseChaseCreditCardCsv(text: string): ParsedTransaction[] {
  const rows = parseCsvRows(text);
  const out: ParsedTransaction[] = [];
  for (const row of rows) {
    const txnRaw = row['Transaction Date'] || row['Date'] || '';
    const postRaw = row['Post Date'] || row['Posting Date'] || txnRaw;
    const txnIso = isoDateFromUSDate(txnRaw);
    const postIso = isoDateFromUSDate(postRaw) || txnIso;
    if (!txnIso) continue;
    const description = row['Description'] || '';
    // CC amounts: Chase reports purchases as NEGATIVE (money out) and
    // payments/returns as POSITIVE. Same sign convention as the bank
    // export, so no flipping needed -- pass through.
    const amount = parseAmount(row['Amount'] || '0');
    out.push({
      txn_date: txnIso,
      posting_date: postIso || txnIso,
      description,
      amount,
      raw_category: (row['Category'] || '').trim() || null,
      raw_type: (row['Type'] || '').trim() || null,
      source: 'chase_cc_csv',
      raw_row: row,
    });
  }
  return out;
}

// ── Dedupe hash ──────────────────────────────────────────────────────────

/**
 * Stable hash over the fields that uniquely identify a transaction within
 * an account+entity. Re-uploading the same CSV (or overlapping CSVs --
 * common when the operator covers a quarter via month-by-month exports)
 * lands the same hash, and the unique constraint on ledger_transactions
 * .dedupe_hash silently skips re-inserts.
 *
 * The hash deliberately INCLUDES the entity_id and account_id so the same
 * dollar amount on the same day in two different accounts isn't collapsed
 * into one row.
 */
export function computeDedupeHash(args: {
  entity_id: string;
  account_id: string;
  txn_date: string;
  amount: number;
  description: string;
}): string {
  const normalizedDesc = args.description.replace(/\s+/g, ' ').trim().toLowerCase();
  const payload = [
    args.entity_id,
    args.account_id,
    args.txn_date,
    args.amount.toFixed(2),
    normalizedDesc,
  ].join('|');
  return createHash('sha256').update(payload).digest('hex');
}
