// Pull one Guesty listing and its calendar into the seed file
// scripts/seed_calderwood.mts reads (runbook step 2).
//
//   node --env-file=.env.local scripts/pull_guesty_seed.mts \
//     --property 65_calderwood --listing 66797ba7f51d72001388bc29 --out ./calderwood_guesty_seed.json
//
// Required env: GUESTY_CLIENT_ID, GUESTY_CLIENT_SECRET, NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY (the Guesty token cache lives in Supabase).
//
// Writes { "<property>.listing": ..., "<property>.calendar": ... } and nothing
// else, both reduced before they touch disk (src/lib/pricing-seed.ts):
//   - the listing loses every door code, lock code, wifi detail and check-in
//     instruction by key, and every line that mentions a code from its
//     free-text fields (the check-in blurb the seed reads is one of them);
//   - the calendar keeps only what the seed reads per day (date, price,
//     minimum nights, status, the rule flags and block refs): Guesty embeds
//     each booked day's reservation (guest name, confirmation code, payout),
//     and none of it is written.
// Reservations themselves are never pulled. *_guesty_seed.json is gitignored.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { guestyGet } from '../src/lib/guesty.ts';
import { scrubSeedListing, seedCalendarDays, type GuestySeedCalendar } from '../src/lib/pricing-seed.ts';

function fail(msg: string): never {
  console.error(`pull_guesty_seed: ${msg}`);
  process.exit(1);
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

const property = arg('property');
const listingId = arg('listing');
const out = arg('out');
if (!property || !/^[a-z0-9_]+$/.test(property)) fail('--property <helm property id> is required');
if (!listingId || !/^[0-9a-f]{24}$/.test(listingId)) fail('--listing <guesty listing id> is required');
if (!out) fail('--out <path> is required');

const today = new Date().toISOString().slice(0, 10);
const end = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
const listing = await guestyGet<Record<string, unknown>>(`/v1/listings/${listingId}`);
const calendar = await guestyGet<GuestySeedCalendar>(`/v1/availability-pricing/api/calendar/listings/${listingId}`, { startDate: today, endDate: end });
const path = resolve(out!);
writeFileSync(path, JSON.stringify({ [`${property}.listing`]: scrubSeedListing(listing), [`${property}.calendar`]: seedCalendarDays(calendar) }, null, 2));
console.log(`wrote ${path}: listing "${String(listing.title ?? '')}", calendar ${today} to ${end}`);
