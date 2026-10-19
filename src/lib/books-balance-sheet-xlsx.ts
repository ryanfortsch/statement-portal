/**
 * The workbook /api/books/balance-sheet-export sends the CPA: the
 * "Balance Sheet" sheet (two dated columns, the year's equity rollforward,
 * each bank account against Chase), the "Opening Balances" it starts from,
 * and the year's "Journal Entries".
 *
 * Kept out of the route so the test can write it and read it back.
 */

import * as XLSX from 'xlsx';
import { sheetFrom } from './books-pnl-xlsx.ts';
import type { JournalEntry } from './books-pnl.ts';
import {
  bsSheetRows,
  journalSheetRows,
  openingSheetRows,
  type BalanceSheet,
  type BsOpening,
  type OpeningLine,
} from './books-balance-sheet.ts';

export const BS_SHEET = 'Balance Sheet';
export const OPENING_SHEET = 'Opening Balances';
export const JOURNAL_SHEET = 'Journal Entries';

export function balanceSheetWorkbook(
  bs: BalanceSheet,
  lines: OpeningLine[],
  openings: BsOpening[],
  journal: JournalEntry[],
): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFrom(bsSheetRows(bs), [52, 14, 14, 14, 14, 26]), BS_SHEET);
  XLSX.utils.book_append_sheet(wb, sheetFrom(openingSheetRows(bs, lines, openings), [30, 34, 44, 14]), OPENING_SHEET);
  const yearStart = `${bs.year}-01-01`;
  XLSX.utils.book_append_sheet(
    wb,
    sheetFrom(journalSheetRows(bs.entity_id, journal.filter((e) => e.entry_date >= yearStart && e.entry_date <= bs.dates.current)), [11, 30, 30, 14, 60]),
    JOURNAL_SHEET,
  );
  return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayLike<number>);
}
