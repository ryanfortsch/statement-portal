/**
 * The workbook /api/books/pnl-export sends the CPA: a "Profit and Loss"
 * sheet (the month grid and a Total column, then what is not in net
 * income) and a "Transactions" sheet (every row of the year with the
 * category it was filed under and whether it counts).
 *
 * Kept out of the route so the test can write it and read it back.
 */

import * as XLSX from 'xlsx';
import { pnlSheetRows, transactionSheetRows, type Cell, type DetailTxn, type JournalEntry, type PnlReport } from './books-pnl.ts';

const MONEY_FORMAT = '#,##0.00;-#,##0.00';

export function sheetFrom(rows: Cell[][], widths: number[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  for (const addr of Object.keys(ws)) {
    if (addr.startsWith('!')) continue;
    // Every number on these sheets is dollars (counts are written as text).
    const cell = ws[addr] as XLSX.CellObject;
    if (cell.t === 'n') cell.z = MONEY_FORMAT;
  }
  ws['!cols'] = widths.map((wch) => ({ wch }));
  return ws;
}

export const PNL_SHEET = 'Profit and Loss';
export const TRANSACTIONS_SHEET = 'Transactions';

export function pnlWorkbook(report: PnlReport, txns: DetailTxn[], journal: JournalEntry[] = []): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFrom(pnlSheetRows(report), [44, ...Array(13).fill(12)]), PNL_SHEET);
  XLSX.utils.book_append_sheet(
    wb,
    sheetFrom(transactionSheetRows(report.entity_id, report.year, txns, journal), [11, 26, 48, 12, 34, 22, 13]),
    TRANSACTIONS_SHEET,
  );
  return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayLike<number>);
}
