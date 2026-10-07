#!/usr/bin/env node
/**
 * Scope parity: proves the registry column gate (properties.region) returns
 * the same Cape Ann ops fleet the literal exclusion sets used to.
 *
 * Before 2026-09-26 four files each carried
 *   new Set(['65_calderwood', '3246_ne_27th'])
 * to keep Ryan's out-of-region homes off the turnover rail, the cleaner
 * digest, Field packets and the turnovers dropdown. Those sets are gone;
 * the gate is `properties.region = 'cape_ann'` read through
 * src/lib/property-scope.ts. This harness prints both rules over the live
 * registry and exits non-zero if they disagree.
 *
 * Read-only. Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or
 * pass --via-cli to use the linked Supabase CLI from the parent checkout).
 *
 *   node scripts/scope_parity.mjs
 *   node scripts/scope_parity.mjs --via-cli
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const LEGACY_EXCLUDED = new Set(['65_calderwood', '3246_ne_27th']);

function loadEnv() {
  for (const f of ['.env.local', '.env']) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  }
}

async function readRegistryViaRest() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const res = await fetch(`${url}/rest/v1/properties?select=id,name,is_active,kind,region,calendar_authority&order=id.asc&limit=1000`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`properties read failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function readRegistryViaCli() {
  const dir = mkdtempSync(join(tmpdir(), 'scope-parity-'));
  const sql = join(dir, 'q.sql');
  writeFileSync(sql, "select id, name, is_active, kind, region, calendar_authority from properties order by id;");
  const workdir = process.env.SUPABASE_WORKDIR ?? process.cwd();
  const out = execFileSync('supabase', ['db', 'query', '--linked', '--workdir', workdir, '--file', sql], { encoding: 'utf8' });
  const i = out.indexOf('{');
  const obj = JSON.parse(out.slice(i, out.lastIndexOf('}') + 1));
  return obj.rows;
}

function legacyRule(rows) {
  return rows.filter((r) => r.is_active !== false && !LEGACY_EXCLUDED.has(r.id)).map((r) => r.id).sort();
}
function regionRule(rows) {
  return rows.filter((r) => r.is_active !== false && (r.region ?? 'cape_ann') === 'cape_ann').map((r) => r.id).sort();
}

loadEnv();
const viaCli = process.argv.includes('--via-cli');
const rows = viaCli ? readRegistryViaCli() : (await readRegistryViaRest()) ?? readRegistryViaCli();

const a = legacyRule(rows);
const b = regionRule(rows);
const onlyLegacy = a.filter((id) => !b.includes(id));
const onlyRegion = b.filter((id) => !a.includes(id));

console.log(`registry rows: ${rows.length}`);
console.log(`legacy rule (active minus literal set): ${a.length} -> ${a.join(', ')}`);
console.log(`region rule  (active and region=cape_ann): ${b.length} -> ${b.join(', ')}`);
const nonCapeAnn = rows.filter((r) => (r.region ?? 'cape_ann') !== 'cape_ann');
console.log(`out-of-region rows: ${nonCapeAnn.map((r) => `${r.id} (${r.region}, ${r.calendar_authority ?? 'guesty'})`).join(', ') || 'none'}`);

if (onlyLegacy.length || onlyRegion.length) {
  console.error(`MISMATCH. only legacy: [${onlyLegacy.join(', ')}] only region: [${onlyRegion.join(', ')}]`);
  process.exit(1);
}
console.log('PARITY OK: the region gate returns exactly the fleet the literal sets did.');
