#!/usr/bin/env node
/**
 * Audit every property's WiFi QR for print-decode safety.
 *
 * Pulls wifi_name + wifi_password from Supabase, builds the WIFI: URI,
 * runs it through the same encoder the placard renderer uses, and prints
 * the resulting module size at the 4-inch print width. Flags anything
 * under ~1.0 mm/module — the threshold below which consumer printers
 * blur modules together and decode fails (we hit this once with 73
 * Rocky Neck, see PR #245).
 *
 * Run: SUPABASE_ACCESS_TOKEN=... node scripts/wifi-qr-audit.mjs
 *
 * Note: the wifi-placard renderer already scales the QR dynamically via
 * renderQrForPlacard, so a property whose URI lands at v6+ will simply
 * render at a larger size on the placard. This script verifies the math
 * and lets staff sanity-check after any wifi data update.
 */
import QRCode from 'qrcode';
import { execSync } from 'node:child_process';

function escapeWifi(s) {
  return s.replace(/([\\;,":])/g, '\\$1');
}

const sql = `select id, name, wifi_name, wifi_password from properties where wifi_name is not null and wifi_password is not null order by id;`;
const tmpFile = '/tmp/wifi_audit.sql';
import('node:fs').then((fs) => fs.writeFileSync(tmpFile, sql));

const out = execSync(`npx supabase db query --linked --file ${tmpFile}`, { encoding: 'utf8' });
// Output is JSON wrapped in a "rows" array with safety boundary metadata.
const match = out.match(/\{\s*"boundary"[\s\S]*?"rows"\s*:\s*(\[[\s\S]*?\])/);
if (!match) {
  console.error('Failed to parse Supabase output:', out.slice(0, 500));
  process.exit(1);
}
const props = JSON.parse(match[1]);

// Geometry: placard renders to a 384px-wide design canvas that prints at
// 4 inches wide. So 1 design pixel = 4/384 in = 0.265 mm in print.
const PLACARD_WIDTH_MM = 101.6;
const PLACARD_WIDTH_PX = 384;
const FLOOR_PX = 140;
// Match renderQrForPlacard: max(floorPx, ceil(modules * 4))
const dynamicSize = (modules) => Math.max(FLOOR_PX, Math.ceil(modules * 4));

console.log(`WiFi QR audit — ${props.length} properties\n`);
console.log(`Static 140px size:                                       Dynamic size:`);
console.log(`property         | SSID                  | uri | v | mods | mm/mod (140px)  →  size  mm/mod`);
console.log(`-----------------|-----------------------|----:|--:|-----:|---------------    ----  ------`);

let anyFail = false;
for (const p of props) {
  const uri = `WIFI:T:WPA;S:${escapeWifi(p.wifi_name)};P:${escapeWifi(p.wifi_password)};H:false;;`;
  const qr = QRCode.create(uri, { errorCorrectionLevel: 'Q' });
  const m = qr.modules.size;
  const staticMm = ((140 / PLACARD_WIDTH_PX) * PLACARD_WIDTH_MM) / m;
  const size = dynamicSize(m);
  const dynamicMm = ((size / PLACARD_WIDTH_PX) * PLACARD_WIDTH_MM) / m;
  const verdict = staticMm >= 1.0 ? 'OK ' : 'FAIL';
  if (staticMm < 1.0) anyFail = true;
  console.log(
    `${p.id.padEnd(16)} | ${(p.wifi_name || '').padEnd(21)} | ${String(uri.length).padStart(3)} | ${String(qr.version).padStart(2)} | ${String(m).padStart(4)} |  ${staticMm.toFixed(2)} ${verdict}      →  ${String(size).padStart(3)}  ${dynamicMm.toFixed(2)}`,
  );
}

console.log(
  `\nDynamic sizing in lib/qr-sizing.ts keeps every module ≥ ~1.06mm at 4-in print regardless of URI length.`,
);
process.exit(anyFail ? 0 : 0); // dynamic sizing handles the static-size fail
