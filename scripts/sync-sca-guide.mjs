#!/usr/bin/env node
/**
 * Refresh src/data/sca-guide.json from the sister-repo stay-cape-ann.
 *
 * The guest app's "Around Cape Ann" section shows the same places, the same
 * words and the same walk and drive times as the home's listing page on
 * staycapeann.com. Those are Stay Cape Ann's editorial data, so they are
 * copied here rather than written twice:
 *
 *   data/attractions.json        the curated, safe-to-name places (public
 *                                beaches, parks, lighthouses, museums)
 *   data/nearby-distances.json   real road routing (OSRM) from each listing
 *                                to each place, walking and driving
 *   data/ical-urls.json          per listing: the internal name, the one
 *                                hand-picked restaurant (stayFavorite), any
 *                                extra picks, and the walks Dotti confirmed
 *                                by foot (nearbyOverrides), which win over
 *                                OSRM's road-only route
 *
 * Only names from those files ever reach a guest, which keeps the app inside
 * Stay Cape Ann's verified-businesses rule.
 *
 * Run from the Helm repo root:
 *
 *   npm run sync-sca-guide
 *   node scripts/sync-sca-guide.mjs --src=/path/to/stay-cape-ann
 *
 * Rerun when a listing is added on staycapeann.com or its picks change.
 */

import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const src = args.src || '/Users/maguire/Developer/stay-cape-ann';
const dest = path.resolve('src/data/sca-guide.json');

function readJson(rel) {
  const file = path.join(src, rel);
  if (!fs.existsSync(file)) {
    console.error(`missing ${file}; clone stay-cape-ann or pass --src=PATH`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const attractionsFile = readJson('data/attractions.json');
const distancesFile = readJson('data/nearby-distances.json');
const registry = readJson('data/ical-urls.json');

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const leg = (l) => (l && Number.isFinite(l.minutes) && Number.isFinite(l.miles) ? [Math.round(l.minutes), round2(l.miles)] : null);

function place(p) {
  return {
    name: String(p.name),
    category: String(p.category),
    town: String(p.town ?? ''),
    lat: Number(p.lat),
    lng: Number(p.lng),
    blurb: String(p.blurb ?? ''),
    ...(p.anchor ? { anchor: true } : {}),
  };
}

const attractions = (attractionsFile.attractions ?? []).map(place);

const listings = {};
for (const [id, entry] of Object.entries(registry.listings ?? {})) {
  const routed = distancesFile.listings?.[id] ?? {};
  const overrides = entry.nearbyOverrides ?? {};
  const legs = {};
  for (const name of new Set([...Object.keys(routed), ...Object.keys(overrides)])) {
    const r = routed[name] ?? {};
    const o = overrides[name] ?? {};
    const w = leg(o.walking ?? r.walking);
    const d = leg(o.driving ?? r.driving);
    if (!w && !d) continue;
    legs[name] = { ...(w ? { w } : {}), ...(d ? { d } : {}), ...(o.note ? { confirmed: true } : {}) };
  }
  const favorites = [
    ...(entry.stayFavorite ? [{ ...place(entry.stayFavorite), primary: true }] : []),
    ...(entry.extraFavorites ?? []).map(place),
  ];
  listings[id] = {
    internalName: entry.internalName ?? null,
    publicName: entry.publicName ?? null,
    favorites,
    legs,
  };
}

const out = {
  refreshedAt: new Date().toISOString(),
  source: 'stay-cape-ann data/attractions.json + data/nearby-distances.json + data/ical-urls.json',
  distancesGeneratedAt: distancesFile.generatedAt ?? null,
  attractions,
  listings,
};

fs.writeFileSync(dest, JSON.stringify(out) + '\n');
console.log(`wrote ${dest}: ${attractions.length} places, ${Object.keys(listings).length} listings`);
