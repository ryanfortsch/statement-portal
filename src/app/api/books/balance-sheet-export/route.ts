import { NextRequest, NextResponse } from 'next/server';
import { LLC_ENTITIES } from '@/lib/books';
import { parsePnlYear, rowsToCsv } from '@/lib/books-pnl';
import { bsFileBase, bsSheetRows, openingLinesFor } from '@/lib/books-balance-sheet';
import { loadBalanceSheet } from '@/lib/books-balance-sheet-db';
import { balanceSheetWorkbook } from '@/lib/books-balance-sheet-xlsx';

/**
 * The balance sheet for the CPA, as a download.
 *
 * GET ?entity=goose_calderwood&year=2026&format=xlsx|csv
 *
 *   xlsx (default): "Balance Sheet" (December 31 of the year and the one
 *   before, the year's equity, each bank account against Chase), "Opening
 *   Balances" and the year's "Journal Entries".
 *   csv: the Balance Sheet sheet alone.
 *
 * Refuses until the entity's opening date is saved: a sheet built on no
 * opening figures is a preview, not something to send.
 *
 * Owners only: /api/books is an owner prefix in helm-access.ts, so the
 * proxy turns a staff session away before this runs.
 */

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const entityId = params.get('entity') || '';
  if (!LLC_ENTITIES[entityId]) {
    return NextResponse.json({ error: `Unknown entity: ${entityId}` }, { status: 400 });
  }
  const year = parsePnlYear(params.get('year') ?? undefined, new Date().getUTCFullYear());
  const format = params.get('format') === 'csv' ? 'csv' : 'xlsx';

  const load = await loadBalanceSheet(entityId, year);
  if (!load.ready) {
    return load.reason === 'tables_missing'
      ? NextResponse.json({ error: 'The ledger is not set up yet.' }, { status: 503 })
      : NextResponse.json({ error: load.message }, { status: 500 });
  }
  if (!load.openingSaved) {
    return NextResponse.json({ error: 'Save the opening balances first.' }, { status: 409 });
  }
  if (!load.sheet) {
    return NextResponse.json({ error: `The books open on ${load.openingDate}, after December 31, ${year}.` }, { status: 409 });
  }

  const base = bsFileBase(load.sheet);
  if (format === 'csv') {
    return new NextResponse(rowsToCsv(bsSheetRows(load.sheet)), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${base}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }
  const workbook = balanceSheetWorkbook(load.sheet, openingLinesFor(entityId, load.accounts), load.openings, load.journal);
  return new NextResponse(workbook as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${base}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
