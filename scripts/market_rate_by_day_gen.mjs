#!/usr/bin/env node
/**
 * Regenerate the market rate-by-day table in src/lib/market-rate-by-day.ts
 * from an AirDNA "Rate by day" CSV export (columns: Date, Average Daily Rate).
 *
 *   node scripts/market_rate_by_day_gen.mjs ~/Downloads/rateByDay_last_12_month.csv
 *
 * Rewrites only the region between the BEGIN/END GENERATED markers, so the
 * helpers above it are untouched. Pure text; no database, no network.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('usage: node scripts/market_rate_by_day_gen.mjs <rateByDay.csv>');
  process.exit(1);
}

const raw = readFileSync(csvPath, 'utf8').replace(/^﻿/, '');
const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
const header = lines.shift();
if (!/date/i.test(header) || !/rate/i.test(header)) {
  console.error(`unexpected header: ${header}`);
  process.exit(1);
}
const rows = [];
for (const line of lines) {
  const [date, rate] = line.split(',').map((c) => c.replace(/^"|"$/g, '').trim());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) continue;
  rows.push([date, n]);
}
rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
if (rows.length === 0) {
  console.error('no rows parsed');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../src/lib/market-rate-by-day.ts');
const src = readFileSync(target, 'utf8');
const begin = '// BEGIN GENERATED';
const end = '// END GENERATED';
const bi = src.indexOf(begin);
const ei = src.indexOf(end);
if (bi < 0 || ei < 0 || ei < bi) {
  console.error(`markers not found in ${target}`);
  process.exit(1);
}

const body = [
  `${begin} (${rows[0][0]} to ${rows[rows.length - 1][0]}, ${rows.length} days; regenerate with scripts/market_rate_by_day_gen.mjs)`,
  `export const MARKET_RATE_FIRST_DAY = '${rows[0][0]}';`,
  `export const MARKET_RATE_LAST_DAY = '${rows[rows.length - 1][0]}';`,
  'export const MARKET_RATE_BY_DAY: Record<string, number> = {',
  ...rows.map(([d, n]) => `  '${d}': ${n},`),
  '};',
].join('\n');

writeFileSync(target, src.slice(0, bi) + body + '\n' + src.slice(ei));
console.log(`wrote ${rows.length} days (${rows[0][0]} to ${rows[rows.length - 1][0]}) into ${target}`);
