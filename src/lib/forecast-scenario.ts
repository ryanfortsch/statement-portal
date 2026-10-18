/**
 * The Forecast page's scenario as a link, and the line that says which of
 * the year's columns are measured.
 *
 * A scenario is the viewed year plus the three "New in {year}" sliders:
 * `/forecast?year=2027&new=3,2,0`. The defaults (2026, three new homes in
 * each year) print as a bare `/forecast`, so the page opens where it always
 * has and an old link keeps its numbers.
 *
 * Presentation only. Nothing here feeds calcYear beyond the slider counts
 * the operator already chose, and those are clamped to the same 0..max
 * range the slider itself allows.
 *
 * No imports, so the test runner can load it directly.
 */

export const FORECAST_YEARS = [2026, 2027, 2028] as const;
export type ScenarioYear = (typeof FORECAST_YEARS)[number];

export type ForecastScenario = {
  year: ScenarioYear;
  /** New homes on the 2026, 2027 and 2028 sliders, in that order. */
  numNew: [number, number, number];
};

export const DEFAULT_SCENARIO: ForecastScenario = { year: 2026, numNew: [3, 3, 3] };

type RawParam = string | string[] | undefined;

function first(v: RawParam): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Read `?year=` and `?new=` into a scenario. Anything unreadable falls back
 * to the default for that slot; counts clamp to 0..maxNew(year), the
 * slider's own range.
 */
export function parseScenario(
  params: { year?: RawParam; new?: RawParam },
  maxNew: (year: ScenarioYear) => number,
): ForecastScenario {
  const y = Number(first(params.year));
  const year = (FORECAST_YEARS as readonly number[]).includes(y)
    ? (y as ScenarioYear)
    : DEFAULT_SCENARIO.year;
  const parts = (first(params.new) ?? '').split(',');
  const numNew = FORECAST_YEARS.map((fy, i) => {
    const raw = parts[i]?.trim() ?? '';
    const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : DEFAULT_SCENARIO.numNew[i];
    return Math.max(0, Math.min(maxNew(fy), n));
  }) as [number, number, number];
  return { year, numNew };
}

/** The query string for a scenario: '' for the defaults, else `?year=..&new=..`. */
export function scenarioQuery(s: ForecastScenario): string {
  const parts: string[] = [];
  if (s.year !== DEFAULT_SCENARIO.year) parts.push(`year=${s.year}`);
  if (s.numNew.some((n, i) => n !== DEFAULT_SCENARIO.numNew[i])) parts.push(`new=${s.numNew.join(',')}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type MonthFlags = { is_actual: boolean; actual_card_only: boolean };

function span(from: number, to: number): string {
  return from === to ? MONTHS[from] : `${MONTHS[from]} to ${MONTHS[to]}`;
}

/**
 * "Jan to Sep measured (Sep card only), Oct to Dec projected" for the
 * Monthly Detail title, plus the column indexes that open a new run, where
 * the table draws its rule. Measured is the model's own `is_actual`, the
 * same flag the old ACT badge read; card only is `actual_card_only`.
 */
export function describeMeasured(months: readonly MonthFlags[]): { line: string; ruleBefore: number[] } {
  const runs: Array<{ measured: boolean; from: number; to: number }> = [];
  months.forEach((m, i) => {
    const last = runs[runs.length - 1];
    if (last && last.measured === m.is_actual) last.to = i;
    else runs.push({ measured: m.is_actual, from: i, to: i });
  });
  const cardOnly: Array<{ from: number; to: number }> = [];
  months.forEach((m, i) => {
    if (!(m.is_actual && m.actual_card_only)) return;
    const last = cardOnly[cardOnly.length - 1];
    if (last && last.to === i - 1) last.to = i;
    else cardOnly.push({ from: i, to: i });
  });
  const line = runs
    .map((r) => {
      const notes = r.measured
        ? cardOnly.filter((c) => c.from >= r.from && c.to <= r.to).map((c) => `${span(c.from, c.to)} card only`)
        : [];
      return `${span(r.from, r.to)} ${r.measured ? 'measured' : 'projected'}${notes.length ? ` (${notes.join(', ')})` : ''}`;
    })
    .join(', ');
  return { line, ruleBefore: runs.slice(1).map((r) => r.from) };
}
