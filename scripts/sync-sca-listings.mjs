#!/usr/bin/env node
/**
 * Refresh src/data/sca-listings.json from the sister-repo stay-cape-ann
 * Guesty snapshot. Reads /Users/maguire/Developer/stay-cape-ann/data/
 * guesty-snapshot.json (override with --src=PATH) and writes a slim
 * subset (no calendars, photos, descriptions) into Helm so the property-
 * page backfill action can pull beds/baths/lat-lng without an API call.
 *
 * Run from the Helm repo root:
 *
 *   node scripts/sync-sca-listings.mjs
 *
 * Or wire the npm script:
 *
 *   npm run sync-sca-listings
 *
 * Stay Cape Ann auto-refreshes its snapshot daily via a cron + commit.
 * Helm doesn't auto-refresh today; rerun this script when you want fresh
 * beds/baths data baked into the next deploy.
 */

import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const DEFAULT_SRC = '/Users/maguire/Developer/stay-cape-ann/data/guesty-snapshot.json';
const src = args.src || DEFAULT_SRC;
const dest = path.resolve('src/data/sca-listings.json');

if (!fs.existsSync(src)) {
  console.error(`source snapshot not found at ${src}`);
  console.error('clone stay-cape-ann at /Users/maguire/Developer/stay-cape-ann or pass --src=PATH');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(src, 'utf8'));

const slim = {
  refreshedAt: raw.refreshedAt,
  source: raw.source,
  listings: (raw.listings || []).map((l) => ({
    id: l.id,
    title: l.title,
    bedrooms: l.bedrooms,
    bathrooms: l.bathrooms,
    accommodates: l.accommodates,
    address: l.address
      ? {
          city: l.address.city,
          state: l.address.state,
          full: l.address.full,
          lat: l.address.lat,
          lng: l.address.lng,
        }
      : undefined,
    town: l.town,
    propertyType: l.propertyType,
  })),
};

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(slim, null, 2) + '\n');

const sizeKb = (JSON.stringify(slim).length / 1024).toFixed(1);
console.log(`wrote ${slim.listings.length} listings to src/data/sca-listings.json (${sizeKb} KB)`);
console.log(`source refreshedAt: ${slim.refreshedAt} (${slim.source})`);
