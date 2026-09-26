#!/usr/bin/env node
/**
 * How many OTA holds the old iCal sync stored as confirmed stays.
 *
 * Before 2026-09-26 the direct-feed branch of src/lib/ical-sync.ts wrote
 * every surviving event as status 'confirmed', so a VRBO "Blocked" (and any
 * other hold the "available" filter let through) sits in `bookings` as a
 * guest who never existed. The classifier (classifyIcalEvent) now stores
 * such events as blocks, and the cancel pass (ical-cancel-policy.ts)
 * reclassifies the legacy rows: a confirmed ical_import row whose
 * raw_summary is a hold is cancelled with cancel_reason 'reclassified_hold'
 * the first run it is missing from its feed. This harness counts what that
 * pass will touch, before and after, so the number can be checked against
 * the run log.
 *
 * Read-only. Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in
 * the environment or .env.local (or pass --via-cli to use the linked
 * Supabase CLI, as scripts/scope_parity.mjs does).
 *
 *   node scripts/ical_block_reclass_count.mjs
 *   node scripts/ical_block_reclass_count.mjs --via-cli
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mirror of HOLD_KEYWORD in src/lib/ical.ts (isBlockSummary).
const HOLD_KEYWORD = /\b(not\s*available|unavailable|block(?:ed)?|closed)\b/i;
const isBlockSummary = (raw) => !!raw && HOLD_KEYWORD.test(raw);

const SELECT = 'id,property_id,channel,channel_listing_id,status,check_in,check_out,raw_summary,last_seen_at,duplicate_of';

function loadEnv() {
  for (const f of ['.env.local', '.env']) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  }
}

async function readViaRest() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  // Coarse server-side filter (any hold word anywhere), exact test below.
  const or = 'or=(raw_summary.ilike.*available*,raw_summary.ilike.*block*,raw_summary.ilike.*closed*)';
  const out = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const res = await fetch(
      `${url}/rest/v1/bookings?select=${SELECT}&source=eq.ical_import&status=eq.confirmed&${or}&order=id.asc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + page - 1}` } },
    );
    if (!res.ok && res.status !== 206) throw new Error(`bookings read failed: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

function readViaCli() {
  const dir = mkdtempSync(join(tmpdir(), 'ical-reclass-'));
  const sql = join(dir, 'q.sql');
  writeFileSync(
    sql,
    `select ${SELECT.split(',').join(', ')} from bookings
      where source = 'ical_import' and status = 'confirmed'
        and raw_summary ~* '\\m(not\\s*available|unavailable|block(ed)?|closed)\\M'
      order by id;`,
  );
  const workdir = process.env.SUPABASE_WORKDIR ?? process.cwd();
  const out = execFileSync('supabase', ['db', 'query', '--linked', '--workdir', workdir, '--file', sql], { encoding: 'utf8' });
  const i = out.indexOf('{');
  const obj = JSON.parse(out.slice(i, out.lastIndexOf('}') + 1));
  return obj.rows;
}

loadEnv();
const viaCli = process.argv.includes('--via-cli');
let raw;
try {
  raw = viaCli ? readViaCli() : (await readViaRest()) ?? readViaCli();
} catch (err) {
  console.error(String(err instanceof Error ? err.message : err).split('\n')[0]);
  console.error(
    'Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment, or a linked Supabase CLI ' +
      '(set SUPABASE_WORKDIR to the linked checkout when running from a worktree).',
  );
  process.exit(2);
}
const rows = raw.filter((r) => isBlockSummary(r.raw_summary));

const today = new Date().toISOString().slice(0, 10);
const upcoming = rows.filter((r) => String(r.check_out) >= today);
const canonical = rows.filter((r) => r.duplicate_of == null);

console.log(`confirmed ical_import rows whose SUMMARY is a hold: ${rows.length}`);
console.log(`  upcoming (check_out >= ${today}): ${upcoming.length}`);
console.log(`  standing canonical (duplicate_of null): ${canonical.length}`);

const by = (key) => {
  const m = new Map();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
console.log('\nby SUMMARY:');
for (const [k, n] of by((r) => r.raw_summary)) console.log(`  ${String(n).padStart(5)}  ${k}`);
console.log('\nby property / channel:');
for (const [k, n] of by((r) => `${r.property_id} (${r.channel})`)) console.log(`  ${String(n).padStart(5)}  ${k}`);

if (upcoming.length > 0) {
  console.log('\nupcoming rows (each will be cancelled as reclassified_hold on its next sync):');
  for (const r of upcoming.sort((a, b) => String(a.check_in).localeCompare(String(b.check_in)))) {
    console.log(`  ${r.check_in} to ${r.check_out}  ${r.property_id.padEnd(18)} ${r.channel.padEnd(11)} ${r.raw_summary}  ${r.id}`);
  }
}
