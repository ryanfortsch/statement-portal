import { NextRequest, NextResponse } from 'next/server';
import { LLC_ENTITIES } from '@/lib/books';
import { parsePnlYear, pnlFileBase, pnlSheetRows, rowsToCsv } from '@/lib/books-pnl';
import { loadPnl } from '@/lib/books-pnl-db';
import { pnlWorkbook } from '@/lib/books-pnl-xlsx';

/**
 * The P&L for the CPA, as a download.
 *
 * GET ?entity=goose_astoria&year=2026&format=xlsx|csv
 *
 *   xlsx (default): the "Profit and Loss" sheet (months and a Total
 *   column) and "Transactions", every row of the year with the category it
 *   was filed under and whether it counts in net income.
 *   csv: the Profit and Loss sheet alone.
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

  const load = await loadPnl(entityId, year);
  if (!load.ready) {
    return load.reason === 'tables_missing'
      ? NextResponse.json({ error: 'The ledger is not set up yet.' }, { status: 503 })
      : NextResponse.json({ error: load.message }, { status: 500 });
  }

  const base = pnlFileBase(load.report);
  if (format === 'csv') {
    return new NextResponse(rowsToCsv(pnlSheetRows(load.report)), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${base}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }
  return new NextResponse(pnlWorkbook(load.report, load.txns) as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${base}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
