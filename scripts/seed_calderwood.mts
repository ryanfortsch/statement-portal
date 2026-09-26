// Seed 65 Calderwood's Helm-native listing record from the Guesty export.
//
//   node --env-file=.env.local scripts/seed_calderwood.mts --dry
//   node --env-file=.env.local scripts/seed_calderwood.mts
//   node --env-file=.env.local scripts/seed_calderwood.mts --seed /path/to/calderwood_guesty_seed.json
//   node --env-file=.env.local scripts/seed_calderwood.mts --force-plan   # overwrite an operator-edited plan / tax row
//
// Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Optional:     BLOB_READ_WRITE_TOKEN. With it, every Guesty original is copied to
//               Vercel Blob at listings/65_calderwood/<guesty picture _id>.jpg and the
//               gallery never depends on Guesty's CDN. Without it the Guesty URL is
//               stored as the photo url with a warning, and a later run with the token
//               does NOT re-copy (re-runs skip photos whose external_id exists).
//
// What it does, in order, all idempotent:
//   0. refuses to run unless public.properties has the 65_calderwood row
//      (migration 20260926210000_calderwood_registry.sql), and reports registry drift
//      against the export (bedrooms, bathrooms, square_feet, title, lat/lng, times)
//   1. property_listing_content       upsert on property_id
//   2. property_rooms                 idempotent on (property_id, name), beds only
//   3. property_listing_photos        skip existing external_id, else fetch + Blob + insert
//   4. property_rate_plans            upsert to confirm the migration's row
//   5. property_rate_days             395 rows, source 'seed', never closed; operator rows win
//   6. property_tax_config            upsert to confirm
//   7. property_notes                 'Arrival and parking', guest_facing, Keycode line removed
//   8. properties.parking             filled only when empty
//   9. a verification report
//
// Never printed, never written: door codes, lock codes, wifi. The mapper in
// src/lib/pricing-seed.ts does not read doorCode / lockCode / checkInInstructions,
// this script never logs the raw listing, and the arrival note is scanned for a
// code line before it is written.
//
// Built on the pure mapper mapGuestyListingToHelm (src/lib/pricing-seed.ts), which
// has its own node:test fixtures. Runs under Node's native TypeScript stripping
// (type-only imports, no enums). tsconfig includes **/*.mts, so `npx tsc --noEmit`
// covers it; `node --check scripts/seed_calderwood.mts` is the quick syntax gate.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { put as blobPut } from '@vercel/blob';
import {
  mapGuestyListingToHelm,
  type GuestySeedCalendar,
  type GuestySeedListing,
  type HelmSeed,
} from '../src/lib/pricing-seed.ts';

// ── Constants ───────────────────────────────────────────────────────────────

const PROPERTY_ID = '65_calderwood';
const LISTING_KEY = `${PROPERTY_ID}.listing`;
const CALENDAR_KEY = `${PROPERTY_ID}.calendar`;
const SEED_BY = 'seed:guesty-2026-09-25';
const RATE_DAY_NOTE = 'PriceLabs via Guesty 2026-09-25';
const NOTE_TITLE = 'Arrival and parking';
const PARKING_TEXT = 'Driveway in the back of the house; use the back door.';
const DEFAULT_SEED_PATH =
  '/private/tmp/claude-501/-Users-maguire-Developer-statement-portal--claude-worktrees-guesty-migration-planning-7b6df3/a4a1ac57-c323-448d-b9db-4f301594cc2d/scratchpad/calderwood_guesty_seed.json';
const BLOB_PREFIX = `listings/${PROPERTY_ID}`;
const RATE_DAY_CHUNK = 200;

/** Any line that talks about a code is dropped from guest-facing copy, whatever the spelling. */
const CODE_LINE = /\b(key\s*code|keycode|door\s*code|lock\s*code|access\s*code|pin)\b/i;

// ── Args ────────────────────────────────────────────────────────────────────

type Args = { dry: boolean; forcePlan: boolean; seedPath: string };

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { dry: false, forcePlan: false, seedPath: DEFAULT_SEED_PATH };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry' || a === '--dry-run') args.dry = true;
    else if (a === '--force-plan') args.forcePlan = true;
    else if (a === '--seed') {
      const v = argv[i + 1];
      if (!v) fail('--seed needs a path');
      args.seedPath = resolve(v);
      i++;
    } else if (a.startsWith('--seed=')) args.seedPath = resolve(a.slice('--seed='.length));
    else fail(`unknown argument ${a}`);
  }
  return args;
}

function fail(msg: string): never {
  console.error(`seed_calderwood: ${msg}`);
  process.exit(1);
}

// ── Supabase ────────────────────────────────────────────────────────────────

function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) fail('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (run with --env-file=.env.local)');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type Row = Record<string, unknown>;
type BlobPut = typeof blobPut;

function unwrap<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) fail(`${what}: ${res.error.message}`);
  return res.data as T;
}

async function countRows(sb: SupabaseClient, table: string, extra?: (q: any) => any): Promise<number> {
  let q: any = sb.from(table).select('*', { count: 'exact', head: true }).eq('property_id', PROPERTY_ID);
  if (extra) q = extra(q);
  const { count, error } = await q;
  if (error) fail(`count ${table}: ${error.message}`);
  return count ?? 0;
}

// ── Seed file ───────────────────────────────────────────────────────────────

function loadSeed(path: string): { listing: GuestySeedListing; calendar: GuestySeedCalendar; customFieldText: string | null } {
  let raw: Row;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as Row;
  } catch (e) {
    return fail(`cannot read seed JSON at ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const listing = raw[LISTING_KEY] as GuestySeedListing | undefined;
  if (!listing || typeof listing !== 'object') fail(`seed JSON has no '${LISTING_KEY}' key`);
  const calendar = (raw[CALENDAR_KEY] ?? null) as GuestySeedCalendar;
  // customFields is the only key read outside the mapper: the check-in blurb.
  const cf = (listing as Row).customFields;
  let customFieldText: string | null = null;
  if (Array.isArray(cf)) {
    for (const f of cf as Row[]) {
      const v = f?.value;
      if (typeof v === 'string' && /check-?in/i.test(v)) {
        customFieldText = v;
        break;
      }
    }
  }
  return { listing: listing as GuestySeedListing, calendar, customFieldText };
}

/** The customFields blurb minus every line that mentions a code, retitled for guests. */
function arrivalNoteBody(blurb: string | null): string | null {
  if (!blurb) return null;
  const lines = blurb
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => !CODE_LINE.test(l));
  // Collapse runs of blank lines and trailing headers with nothing under them.
  const out: string[] = [];
  for (const l of lines) {
    if (l.trim() === '' && (out.length === 0 || out[out.length - 1].trim() === '')) continue;
    out.push(l);
  }
  while (out.length && (out[out.length - 1].trim() === '' || /^\*.*\*$/.test(out[out.length - 1].trim()))) out.pop();
  const body = out.join('\n').trim();
  if (!body) return null;
  if (body.split('\n').some((l) => CODE_LINE.test(l))) fail('arrival note still carries a code line after stripping; refusing to write it');
  return body;
}

// ── Image header sizes (JPEG SOF, PNG IHDR, WebP VP8/VP8L/VP8X) ─────────────

function imageSize(buf: Uint8Array): { width: number | null; height: number | null } {
  const none = { width: null, height: null };
  if (buf.length < 24) return none;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = (buf[i + 2] << 8) | buf[i + 3];
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        const height = (buf[i + 5] << 8) | buf[i + 6];
        const width = (buf[i + 7] << 8) | buf[i + 8];
        return { width, height };
      }
      if (len < 2) break;
      i += 2 + len;
    }
    return none;
  }
  // WebP
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45) {
    const tag = String.fromCharCode(buf[12], buf[13], buf[14], buf[15]);
    if (tag === 'VP8 ' && buf.length >= 30) {
      return { width: (buf[26] | (buf[27] << 8)) & 0x3fff, height: (buf[28] | (buf[29] << 8)) & 0x3fff };
    }
    if (tag === 'VP8L' && buf.length >= 25) {
      const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
      return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
    }
    if (tag === 'VP8X' && buf.length >= 30) {
      return { width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)), height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)) };
    }
  }
  return none;
}

// ── Step 0: the registry row ────────────────────────────────────────────────

type RegistryRow = {
  id: string;
  name: string | null;
  title: string | null;
  region: string | null;
  calendar_authority: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  square_feet: number | null;
  latitude: number | null;
  longitude: number | null;
  default_checkin_time: string | null;
  default_checkout_time: string | null;
  parking: string | null;
};

async function requireRegistryRow(sb: SupabaseClient): Promise<RegistryRow> {
  const { data, error } = await sb
    .from('properties')
    .select(
      'id, name, title, region, calendar_authority, bedrooms, bathrooms, square_feet, latitude, longitude, default_checkin_time, default_checkout_time, parking',
    )
    .eq('id', PROPERTY_ID)
    .maybeSingle();
  if (error) fail(`reading public.properties: ${error.message}`);
  if (!data) {
    fail(
      `public.properties has no '${PROPERTY_ID}' row. Apply supabase/migrations/20260926210000_calderwood_registry.sql first; this script never creates the registry row.`,
    );
  }
  return data as RegistryRow;
}

function reportDrift(row: RegistryRow, listing: GuestySeedListing, seed: HelmSeed): string[] {
  const drift: string[] = [];
  const cmp = (label: string, helm: unknown, guesty: unknown) => {
    if (helm == null && guesty == null) return;
    if (String(helm) !== String(guesty)) drift.push(`${label}: registry ${String(helm)} vs Guesty ${String(guesty)}`);
  };
  cmp('bedrooms', row.bedrooms, listing.bedrooms);
  cmp('bathrooms', row.bathrooms, listing.bathrooms);
  cmp('square_feet', row.square_feet, (listing as Row).areaSquareFeet);
  cmp('title', row.title, listing.title);
  cmp('latitude', row.latitude, listing.address?.lat);
  cmp('longitude', row.longitude, listing.address?.lng);
  cmp('default_checkout_time (cleaner guidance)', row.default_checkout_time, listing.defaultCheckOutTime);
  // Expected and fine: the registry's 15:00 is cleaner guidance, the plan's 16:00 is what the guest is told.
  if (row.default_checkin_time !== seed.ratePlan.checkin_time) {
    drift.push(
      `default_checkin_time ${row.default_checkin_time} (cleaner guidance) vs plan.checkin_time ${seed.ratePlan.checkin_time} (guest-facing): expected, two different meanings`,
    );
  }
  if (row.region !== 'bridgeport_ct') drift.push(`region is '${row.region}', expected 'bridgeport_ct'`);
  return drift;
}

// ── Steps 1..8 ──────────────────────────────────────────────────────────────

type StepLog = { table: string; action: string; detail?: string };

async function upsertContent(sb: SupabaseClient, seed: HelmSeed, dry: boolean, log: StepLog[]) {
  const row = { ...seed.content, updated_by: SEED_BY, updated_at: new Date().toISOString() };
  if (dry) {
    log.push({ table: 'property_listing_content', action: 'would upsert', detail: `${seed.amenities.length} amenities` });
    return;
  }
  const { error } = await sb.from('property_listing_content').upsert(row, { onConflict: 'property_id' });
  if (error) fail(`property_listing_content upsert: ${error.message}`);
  log.push({ table: 'property_listing_content', action: 'upserted', detail: `${seed.amenities.length} amenities` });
}

async function upsertRooms(sb: SupabaseClient, seed: HelmSeed, dry: boolean, log: StepLog[]) {
  const existing = unwrap(
    await sb.from('property_rooms').select('id, name, sort_order, details').eq('property_id', PROPERTY_ID),
    'property_rooms read',
  ) as Array<{ id: string; name: string; sort_order: number; details: Row }>;
  const byName = new Map(existing.map((r) => [r.name.trim().toLowerCase(), r]));
  let inserted = 0;
  let updated = 0;
  for (const room of seed.rooms) {
    const hit = byName.get(room.name.trim().toLowerCase());
    if (dry) {
      hit ? updated++ : inserted++;
      continue;
    }
    if (hit) {
      const { error } = await sb
        .from('property_rooms')
        .update({
          room_type: room.room_type,
          sort_order: room.sort_order,
          details: { ...(hit.details ?? {}), beds: room.details.beds },
          updated_at: new Date().toISOString(),
        })
        .eq('id', hit.id);
      if (error) fail(`property_rooms update ${room.name}: ${error.message}`);
      updated++;
    } else {
      const { error } = await sb.from('property_rooms').insert({
        property_id: PROPERTY_ID,
        room_type: room.room_type,
        name: room.name,
        sort_order: room.sort_order,
        details: room.details,
        created_by_email: null,
      });
      if (error) fail(`property_rooms insert ${room.name}: ${error.message}`);
      inserted++;
    }
  }
  log.push({ table: 'property_rooms', action: dry ? 'would write' : 'written', detail: `${inserted} inserted, ${updated} updated` });
}

type PhotoOutcome = { blob: number; guestyHosted: number; skipped: number; failed: string[] };

async function seedPhotos(sb: SupabaseClient, seed: HelmSeed, dry: boolean, log: StepLog[]): Promise<PhotoOutcome> {
  const out: PhotoOutcome = { blob: 0, guestyHosted: 0, skipped: 0, failed: [] };
  const existing = unwrap(
    await sb.from('property_listing_photos').select('id, external_id, is_hero').eq('property_id', PROPERTY_ID),
    'property_listing_photos read',
  ) as Array<{ id: string; external_id: string | null; is_hero: boolean }>;
  const have = new Set(existing.map((p) => p.external_id).filter((x): x is string => !!x));
  let heroTaken = existing.some((p) => p.is_hero);

  const token = process.env.BLOB_READ_WRITE_TOKEN || '';
  if (!token) {
    console.warn(
      'seed_calderwood: BLOB_READ_WRITE_TOKEN is not set. Photos will be stored with the Guesty URL as url; the gallery will depend on Guesty\'s CDN until they are re-hosted.',
    );
  }
  let put: BlobPut | null = null;
  if (token && !dry) {
    const blob = await import('@vercel/blob');
    put = blob.put;
  }

  for (const photo of seed.photoManifest) {
    if (photo.external_id && have.has(photo.external_id)) {
      out.skipped++;
      continue;
    }
    if (dry) {
      token ? out.blob++ : out.guestyHosted++;
      continue;
    }
    try {
      const res = await fetch(photo.source_url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.arrayBuffer();
      const bytes = new Uint8Array(body);
      const { width, height } = imageSize(bytes);
      let url = photo.source_url;
      if (put && photo.external_id) {
        const contentType = res.headers.get('content-type') || 'image/jpeg';
        const uploaded = await put(`${BLOB_PREFIX}/${photo.external_id}.jpg`, body, {
          access: 'public',
          addRandomSuffix: false,
          contentType,
          token,
        });
        url = uploaded.url;
        out.blob++;
      } else {
        out.guestyHosted++;
      }
      const isHero = photo.is_hero && !heroTaken;
      const { error } = await sb.from('property_listing_photos').insert({
        property_id: PROPERTY_ID,
        url,
        source_url: photo.source_url,
        thumbnail_url: photo.thumbnail_url,
        caption: photo.caption,
        sort_order: photo.sort_order,
        is_hero: isHero,
        source: 'guesty_seed',
        external_id: photo.external_id,
        width,
        height,
      });
      if (error) throw new Error(error.message);
      if (isHero) heroTaken = true;
    } catch (e) {
      out.failed.push(`${photo.external_id ?? photo.sort_order}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Point the content row at the hero.
  if (!dry) {
    const hero = unwrap(
      await sb.from('property_listing_photos').select('id').eq('property_id', PROPERTY_ID).eq('is_hero', true).maybeSingle(),
      'hero read',
    ) as { id: string } | null;
    if (hero) {
      const { error } = await sb.from('property_listing_content').update({ hero_photo_id: hero.id }).eq('property_id', PROPERTY_ID);
      if (error) fail(`hero_photo_id update: ${error.message}`);
    }
  }
  log.push({
    table: 'property_listing_photos',
    action: dry ? 'would write' : 'written',
    detail: `${out.blob} to Blob, ${out.guestyHosted} Guesty-hosted, ${out.skipped} already present, ${out.failed.length} failed`,
  });
  return out;
}

/** Upsert a single-row config table unless the operator has edited it since the seed. */
async function confirmSeedRow(
  sb: SupabaseClient,
  table: 'property_rate_plans' | 'property_tax_config',
  row: Row,
  dry: boolean,
  forcePlan: boolean,
  log: StepLog[],
) {
  const existing = unwrap(
    await sb.from(table).select('property_id, updated_by').eq('property_id', PROPERTY_ID).maybeSingle(),
    `${table} read`,
  ) as { property_id: string; updated_by: string | null } | null;
  const operatorEdited = !!existing && !!existing.updated_by && !existing.updated_by.startsWith('seed:');
  if (operatorEdited && !forcePlan) {
    log.push({ table, action: 'left alone', detail: `updated_by ${existing!.updated_by}; pass --force-plan to overwrite` });
    return;
  }
  if (dry) {
    log.push({ table, action: existing ? 'would upsert (confirm)' : 'would insert', detail: 'from the Guesty export' });
    return;
  }
  const { error } = await sb.from(table).upsert({ ...row, updated_by: SEED_BY, updated_at: new Date().toISOString() }, { onConflict: 'property_id' });
  if (error) fail(`${table} upsert: ${error.message}`);
  log.push({ table, action: existing ? 'upserted (confirmed)' : 'inserted' });
}

async function upsertRateDays(sb: SupabaseClient, seed: HelmSeed, dry: boolean, log: StepLog[]) {
  const operatorDays = unwrap(
    await sb.from('property_rate_days').select('date').eq('property_id', PROPERTY_ID).eq('source', 'operator'),
    'property_rate_days operator read',
  ) as Array<{ date: string }>;
  const keep = new Set(operatorDays.map((d) => d.date));
  const rows = seed.rateDays
    .filter((d) => !keep.has(d.date))
    .map((d) => ({
      ...d,
      closed: false,
      source: 'seed',
      note: RATE_DAY_NOTE,
      updated_by: SEED_BY,
      updated_at: new Date().toISOString(),
    }));
  if (dry) {
    log.push({ table: 'property_rate_days', action: 'would upsert', detail: `${rows.length} rows (${keep.size} operator days kept)` });
    return;
  }
  for (let i = 0; i < rows.length; i += RATE_DAY_CHUNK) {
    const chunk = rows.slice(i, i + RATE_DAY_CHUNK);
    const { error } = await sb.from('property_rate_days').upsert(chunk, { onConflict: 'property_id,date' });
    if (error) fail(`property_rate_days upsert (chunk ${i / RATE_DAY_CHUNK}): ${error.message}`);
  }
  log.push({ table: 'property_rate_days', action: 'upserted', detail: `${rows.length} rows (${keep.size} operator days kept)` });
}

async function upsertArrivalNote(sb: SupabaseClient, body: string | null, dry: boolean, log: StepLog[]) {
  if (!body) {
    log.push({ table: 'property_notes', action: 'skipped', detail: 'no check-in blurb in customFields' });
    return;
  }
  const existing = unwrap(
    await sb.from('property_notes').select('id').eq('property_id', PROPERTY_ID).eq('title', NOTE_TITLE).is('resolved_at', null).limit(1),
    'property_notes read',
  ) as Array<{ id: string }>;
  if (dry) {
    log.push({ table: 'property_notes', action: existing.length ? 'would update' : 'would insert', detail: `'${NOTE_TITLE}', ${body.length} chars, guest_facing` });
    return;
  }
  if (existing.length) {
    const { error } = await sb
      .from('property_notes')
      .update({ body, guest_facing: true, tag: 'arrival', updated_at: new Date().toISOString() })
      .eq('id', existing[0].id);
    if (error) fail(`property_notes update: ${error.message}`);
    log.push({ table: 'property_notes', action: 'updated', detail: `'${NOTE_TITLE}', ${body.length} chars` });
  } else {
    const { error } = await sb.from('property_notes').insert({
      property_id: PROPERTY_ID,
      title: NOTE_TITLE,
      body,
      tag: 'arrival',
      guest_facing: true,
      author_email: null,
    });
    if (error) fail(`property_notes insert: ${error.message}`);
    log.push({ table: 'property_notes', action: 'inserted', detail: `'${NOTE_TITLE}', ${body.length} chars` });
  }
}

async function fillParking(sb: SupabaseClient, row: RegistryRow, dry: boolean, log: StepLog[]) {
  if (row.parking && row.parking.trim()) {
    log.push({ table: 'properties.parking', action: 'left alone', detail: 'already set' });
    return;
  }
  if (dry) {
    log.push({ table: 'properties.parking', action: 'would set', detail: PARKING_TEXT });
    return;
  }
  const { error } = await sb.from('properties').update({ parking: PARKING_TEXT }).eq('id', PROPERTY_ID);
  if (error) fail(`properties.parking update: ${error.message}`);
  log.push({ table: 'properties.parking', action: 'set', detail: PARKING_TEXT });
}

// ── Step 9: verification report ─────────────────────────────────────────────

function isoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function dollars(cents: number | null | undefined): string {
  return cents == null ? '-' : `$${(cents / 100).toFixed(2)}`;
}

async function report(sb: SupabaseClient, seed: HelmSeed, dry: boolean, photos: PhotoOutcome, drift: string[], log: StepLog[]) {
  const line = (s = '') => console.log(s);
  line();
  line(`65 Calderwood seed ${dry ? '(DRY RUN, nothing written)' : ''}`.trim());
  line('='.repeat(60));

  line();
  line('Steps');
  for (const l of log) line(`  ${l.table.padEnd(28)} ${l.action}${l.detail ? `  (${l.detail})` : ''}`);

  line();
  line('Registry drift vs the Guesty export');
  if (drift.length === 0) line('  none');
  for (const d of drift) line(`  ${d}`);

  line();
  line('Live counts');
  const tables = ['property_listing_content', 'property_rooms', 'property_listing_photos', 'property_rate_plans', 'property_rate_days', 'property_tax_config', 'channel_listings'];
  for (const t of tables) line(`  ${t.padEnd(28)} ${await countRows(sb, t)}`);
  line(`  ${'property_notes (guest_facing)'.padEnd(28)} ${await countRows(sb, 'property_notes', (q) => q.eq('guest_facing', true).is('resolved_at', null))}`);
  line(`  ${'property_access'.padEnd(28)} ${await countRows(sb, 'property_access')}  (row exists; codes are never read or printed)`);

  line();
  line(`Amenities (${seed.amenities.length}, deduped from the export)`);
  line(`  ${seed.amenities.join(', ')}`);

  line();
  line(`Rooms (${seed.rooms.length}, beds only)`);
  for (const r of seed.rooms) line(`  ${r.name.padEnd(12)} ${r.details.beds.map((b) => `${b.count}x ${b.size}`).join(', ')}`);

  line();
  line(`Photos (${seed.photoManifest.length} in the export)`);
  line(`  ${photos.blob} copied to Blob, ${photos.guestyHosted} Guesty-hosted, ${photos.skipped} already present, ${photos.failed.length} failed`);
  for (const f of photos.failed) line(`  FAILED ${f}`);
  if (!dry) {
    const rows = unwrap(
      await sb.from('property_listing_photos').select('url, is_hero, width, height').eq('property_id', PROPERTY_ID).order('sort_order'),
      'photos report',
    ) as Array<{ url: string; is_hero: boolean; width: number | null; height: number | null }>;
    const hosted = rows.filter((r) => /blob\.vercel-storage\.com/.test(r.url)).length;
    line(`  in the table: ${rows.length} rows, ${hosted} on Blob, hero ${rows.find((r) => r.is_hero) ? 'set' : 'MISSING'}`);
  }

  line();
  const priced = seed.rateDays.filter((d) => d.nightly_cents != null);
  const minDay = priced.reduce((a, b) => (b.nightly_cents! < a.nightly_cents! ? b : a), priced[0]);
  const maxDay = priced.reduce((a, b) => (b.nightly_cents! > a.nightly_cents! ? b : a), priced[0]);
  line(`Rate days (${seed.rateDays.length} in the export, ${seed.rateDays[0]?.date} to ${seed.rateDays[seed.rateDays.length - 1]?.date})`);
  if (priced.length) {
    line(`  min ${dollars(minDay.nightly_cents)} on ${minDay.date}, max ${dollars(maxDay.nightly_cents)} on ${maxDay.date}`);
  }
  line(`  closed days written: 0 (booked / unavailable are occupancy, never closed)`);
  const today = isoToday();
  const horizon = addDays(today, 60);
  const source = dry ? seed.rateDays.filter((d) => d.date >= today && d.date < horizon).map((d) => d.nightly_cents) : await liveNightly(sb, today, horizon);
  const distinct = new Set(source.filter((c): c is number => c != null));
  line(`  distinct nightly_cents ${today} to ${horizon}: ${distinct.size}${distinct.size >= 2 ? '' : '  (pricing_flowing needs >= 2)'}`);
  if (seed.operatorBlocks.length) {
    line(`  Guesty manual / owner blocks (NOT written; the operator confirms each on /channels):`);
    for (const b of seed.operatorBlocks) line(`    ${b.date}  ${b.kind}`);
  } else {
    line('  Guesty manual / owner blocks: none');
  }

  line();
  const tax = seed.taxConfig;
  line(
    tax
      ? `Tax config: ${tax.jurisdiction} ${(tax.state_rate * 100).toFixed(2)}% state + ${(tax.local_rate * 100).toFixed(2)}% local on ${tax.applies_to.join(' + ')}, exempt over ${tax.long_stay_exempt_over_nights ?? '-'} nights, collected by ${tax.collected_by_channels.join(', ') || 'no channel'}`
      : 'Tax config: none in the export',
  );
  const plan = seed.ratePlan;
  line(
    `Rate plan: base ${dollars(plan.base_nightly_cents)}, weekend ${dollars(plan.weekend_nightly_cents)} on ${plan.weekend_days.join(',')}, ${plan.guests_included} incl + ${dollars(plan.extra_guest_cents_per_night)}/extra, cleaning ${dollars(plan.cleaning_fee_cents)}, deposit ${dollars(plan.security_deposit_cents)}, min ${plan.min_nights_default} / max ${plan.max_nights ?? '-'} nights, check-in ${plan.checkin_time}, checkout ${plan.checkout_time}, direct markup ${plan.direct_markup_pct}%`,
  );
  line();
}

async function liveNightly(sb: SupabaseClient, from: string, to: string): Promise<Array<number | null>> {
  const rows = unwrap(
    await sb.from('property_rate_days').select('nightly_cents').eq('property_id', PROPERTY_ID).gte('date', from).lt('date', to).order('date'),
    'rate days report',
  ) as Array<{ nightly_cents: number | null }>;
  return rows.map((r) => r.nightly_cents);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { listing, calendar, customFieldText } = loadSeed(args.seedPath);
  const seed = mapGuestyListingToHelm(listing, calendar, { propertyId: PROPERTY_ID, rateDayNote: RATE_DAY_NOTE });
  if (seed.propertyId !== PROPERTY_ID) fail(`mapper produced property id ${seed.propertyId}`);
  if (!seed.taxConfig) fail('the export carries no percentage tax; a CT home cannot be quoted without property_tax_config');

  const sb = serviceClient();
  const registry = await requireRegistryRow(sb);
  const drift = reportDrift(registry, listing, seed);
  const log: StepLog[] = [];

  console.log(`seed_calderwood: ${args.dry ? 'dry run' : 'writing'} for ${registry.name ?? PROPERTY_ID} (region ${registry.region}, calendar ${registry.calendar_authority}) from ${args.seedPath}`);

  await upsertContent(sb, seed, args.dry, log);
  await upsertRooms(sb, seed, args.dry, log);
  const photos = await seedPhotos(sb, seed, args.dry, log);
  await confirmSeedRow(sb, 'property_rate_plans', seed.ratePlan as unknown as Row, args.dry, args.forcePlan, log);
  await upsertRateDays(sb, seed, args.dry, log);
  await confirmSeedRow(sb, 'property_tax_config', seed.taxConfig as unknown as Row, args.dry, args.forcePlan, log);
  await upsertArrivalNote(sb, arrivalNoteBody(customFieldText), args.dry, log);
  await fillParking(sb, registry, args.dry, log);
  await report(sb, seed, args.dry, photos, drift, log);

  if (photos.failed.length) process.exit(2);
}

main().catch((e) => fail(e instanceof Error ? e.stack ?? e.message : String(e)));
