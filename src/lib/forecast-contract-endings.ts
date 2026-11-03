/**
 * Contracts that may end: the prospects pipeline in reverse.
 *
 * A prospect adds its projected fee times the chance it signs. A home already
 * under management can carry the chance its contract ends and the first month
 * it would no longer earn (properties.contract_end_pct / contract_end_month,
 * set on /forecast). From that month the forecast expects the home to stay
 * with the remaining share:
 *
 *   keep(home, month) = 1 - pct / 100   from contract_end_month on
 *                     = 1               before it, or with no chance entered
 *
 * The smart forecast's per-property table keeps printing what each home earns
 * if it stays, so its rows still tie to Guesty. The expected loss is ONE line
 * in Monthly Detail ("Contracts that may end"), the mirror of the Prospects
 * line, and the card and the bench scale on keep() so a home half expected to
 * leave costs half (calcYear's `endings` input).
 *
 * Pure, type imports only, so the tests load it under plain Node.
 */

import type { SmartForecast } from './forecast-smart';

export type ContractEnding = {
  propertyId: string;
  /** Chance the contract ends, a whole number from 1 to 100. */
  pct: number;
  /** YYYY-MM: the first month the home would no longer earn. */
  fromMonth: string;
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The last month the forecast models, so the month picker stops there. */
export const FORECAST_LAST_MONTH = '2028-12';

/**
 * Read a chance and a month as an operator typed them. A blank or 0 chance
 * clears the home (forecast to stay). Otherwise the chance must be 1 to 100
 * and the month a YYYY-MM inside the forecast.
 */
export function parseEnding(
  pctRaw: unknown,
  monthRaw: unknown,
): { ok: true; pct: number | null; month: string | null } | { ok: false; error: string } {
  const text = pctRaw == null ? '' : String(pctRaw).trim().replace(/%$/, '').trim();
  if (text === '') return { ok: true, pct: null, month: null };
  const n = Number(text);
  if (!Number.isFinite(n)) return { ok: false, error: 'Enter the chance as a number from 1 to 100.' };
  const pct = Math.round(n);
  if (pct === 0) return { ok: true, pct: null, month: null };
  if (pct < 0 || pct > 100) return { ok: false, error: 'Enter the chance as a number from 1 to 100.' };
  const month = monthRaw == null ? '' : String(monthRaw).trim();
  if (!MONTH_RE.test(month)) return { ok: false, error: 'Pick the first month it would be gone.' };
  if (month > FORECAST_LAST_MONTH) return { ok: false, error: 'Pick a month inside the forecast, through December 2028.' };
  return { ok: true, pct, month };
}

/** Rows from the properties table, dropping any that do not read cleanly. */
export function endingsFromRows(
  rows: ReadonlyArray<{ id: string; contract_end_pct: number | null; contract_end_month: string | null }>,
): ContractEnding[] {
  const out: ContractEnding[] = [];
  for (const r of rows) {
    const parsed = parseEnding(r.contract_end_pct, r.contract_end_month);
    if (parsed.ok && parsed.pct != null && parsed.month != null) {
      out.push({ propertyId: r.id, pct: parsed.pct, fromMonth: parsed.month });
    }
  }
  return out;
}

/** The share of `ym` a home is expected to stay, 0 to 1. */
export function keepShare(endings: readonly ContractEnding[], propertyId: string, ym: string): number {
  const e = endings.find((x) => x.propertyId === propertyId);
  if (!e || ym < e.fromMonth) return 1;
  return Math.max(0, Math.min(1, 1 - e.pct / 100));
}

/** keepShare in the shape calcYear takes (KeepShare in forecast-model.ts). */
export function keepFn(endings: readonly ContractEnding[]): (propertyId: string, year: number, month: number) => number {
  const byId = new Map(endings.map((e) => [e.propertyId, e]));
  return (propertyId, year, month) => {
    const e = byId.get(propertyId);
    if (!e) return 1;
    return keepShare([e], propertyId, `${year}-${String(month).padStart(2, '0')}`);
  };
}

export type EndingRow = ContractEnding & {
  name: string;
  /** Management fee the home is projected to earn in the year from its month on, if it stays. */
  ifStays: number;
  /** ifStays times the chance it ends: what the year expects to lose. */
  expectedLoss: number;
};

export type EndingYear = {
  /** One row per home with a chance entered, in the order the forecast lists homes. */
  rows: EndingRow[];
  /** Expected management fee lost per month of the year, index month - 1, positive. */
  lossByMonth: number[];
  totalLoss: number;
  /** Homes whose month falls in or before this year, so they weigh on it. */
  count: number;
};

/**
 * The year's expected loss from the smart forecast (that year's months
 * only, as page.tsx filters it), home by home and month by month. A home with
 * a chance entered but no row in the smart feed (inactive, or the feed did
 * not load) is listed with no loss.
 */
export function endingsForYear(
  smart: SmartForecast | null,
  endings: readonly ContractEnding[],
  year: number,
  names: ReadonlyMap<string, string> = new Map(),
): EndingYear {
  const lossByMonth = Array(12).fill(0) as number[];
  const byId = new Map((smart?.properties ?? []).map((p) => [p.property.id, p]));
  const order = new Map((smart?.properties ?? []).map((p, i) => [p.property.id, i]));
  const rows: EndingRow[] = endings.map((e) => {
    const p = byId.get(e.propertyId);
    let ifStays = 0;
    let expectedLoss = 0;
    for (const cell of p?.monthly ?? []) {
      const [y, m] = cell.month.split('-').map((s) => parseInt(s, 10));
      if (y !== year || cell.month < e.fromMonth) continue;
      const loss = cell.projectedMgmtFee * (1 - keepShare([e], e.propertyId, cell.month));
      ifStays += cell.projectedMgmtFee;
      expectedLoss += loss;
      lossByMonth[m - 1] += loss;
    }
    return { ...e, name: p?.property.name ?? names.get(e.propertyId) ?? e.propertyId, ifStays, expectedLoss };
  });
  rows.sort(
    (a, b) =>
      (order.get(a.propertyId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.propertyId) ?? Number.MAX_SAFE_INTEGER) ||
      a.name.localeCompare(b.name),
  );
  const yearEnd = `${year}-12`;
  return {
    rows,
    lossByMonth,
    totalLoss: lossByMonth.reduce((s, v) => s + v, 0),
    count: endings.filter((e) => e.fromMonth <= yearEnd).length,
  };
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2027-01" -> "Jan 2027". */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MONTH_NAMES[parseInt(m, 10) - 1] ?? m} ${y}`;
}

/**
 * The months an operator can pick: from the month after `today` through the
 * end of the forecast. A select rather than a month input, which Safari and
 * Firefox on the desktop render as a bare text box.
 */
export function monthChoices(today: Date, last: string = FORECAST_LAST_MONTH): string[] {
  const out: string[] = [];
  let y = today.getFullYear();
  let m = today.getMonth() + 2;
  if (m > 12) { m -= 12; y += 1; }
  for (;;) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    if (ym > last) break;
    out.push(ym);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** The month a new entry starts on: January of next year, the usual renewal. */
export function defaultEndingMonth(today: Date): string {
  return `${today.getFullYear() + 1}-01`;
}
