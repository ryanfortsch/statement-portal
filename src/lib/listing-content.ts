/**
 * The guest-facing listing record Helm owns: property_listing_content (title,
 * summary, space, access, interaction, neighborhood, house rules, notes,
 * type / room type / accommodates, amenities) plus property_listing_photos
 * (Blob-backed gallery, ordered, one hero) with rooms and beds read from
 * public.property_rooms, the table the onboarding walkthrough already fills.
 *
 * Guesty's Details & layout, Overview and Marketing screens collapse into
 * this one record, which Helm can feed forward: staycapeann.com through
 * /api/pms/properties (toScaListing), the guest AI through kb-facts, and
 * the message automations' merge fields. FIELD_CONSUMERS says, per field,
 * who reads it, so the editor can print a 'consumed by' line.
 *
 * Service role only: every table here is RLS-locked with no anon policy.
 * Relative imports and no 'server-only' marker on purpose, the same way
 * property-rates.ts is built: node:test loads the pure parts (bedSummary,
 * toScaListing, the consumer map) and this file is only ever imported from
 * server code.
 */

import { supabaseAdmin, isServiceConfigured } from './supabase-admin.ts';
import type { PropertyRoom, RoomBed } from './property-rooms-shared.ts';
import type { RatePlanRow } from './rate-plan.ts';
import { CAPE_ANN_REGION } from './property-scope.ts';

// ── Row shapes ──────────────────────────────────────────────────────────────

export type ListingContentSource = 'helm' | 'guesty_seed' | 'ai_draft';

export type ListingContentRow = {
  property_id: string;
  title: string | null;
  summary: string | null;
  space: string | null;
  access: string | null;
  interaction: string | null;
  neighborhood: string | null;
  house_rules: string | null;
  notes: string | null;
  property_type: string | null;
  room_type: string | null;
  accommodates: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  beds: number | null;
  amenities: string[];
  amenities_not_included: string[];
  hero_photo_id: string | null;
  source: ListingContentSource;
  source_ref: string | null;
  updated_by: string | null;
  created_at?: string;
  updated_at?: string;
};

export type ListingPhotoSource = 'helm' | 'guesty_seed' | 'drive';

export type ListingPhotoRow = {
  id: string;
  property_id: string;
  url: string;
  source_url: string | null;
  thumbnail_url: string | null;
  caption: string | null;
  room_hint: string | null;
  sort_order: number;
  is_hero: boolean;
  source: ListingPhotoSource;
  external_id: string | null;
  width: number | null;
  height: number | null;
  created_at?: string;
  updated_at?: string;
};

/** The registry facts the SCA shape needs beside the content row. */
export type ListingPropertyFacts = {
  id: string;
  name: string;
  title: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  calendar_authority: string | null;
};

export type ListingRecord = {
  property: ListingPropertyFacts;
  /** null when the property has no content row yet. */
  content: ListingContentRow | null;
  photos: ListingPhotoRow[];
  rooms: PropertyRoom[];
};

export const LISTING_CONTENT_COLS =
  'property_id, title, summary, space, access, interaction, neighborhood, house_rules, notes, property_type, room_type, accommodates, bedrooms, bathrooms, beds, amenities, amenities_not_included, hero_photo_id, source, source_ref, updated_by, created_at, updated_at';

export const LISTING_PHOTO_COLS =
  'id, property_id, url, source_url, thumbnail_url, caption, room_hint, sort_order, is_hero, source, external_id, width, height, created_at, updated_at';

const PROPERTY_FACT_COLS = 'id, name, title, address, city, region, latitude, longitude, bedrooms, bathrooms, calendar_authority';

// ── Who reads each field (the editor's 'consumed by' line) ──────────────────

export type ListingConsumer = 'staycapeann.com' | 'guest AI (kb-facts)' | 'automations' | 'OTA push (later)';

export const FIELD_CONSUMERS: Record<string, ListingConsumer[]> = {
  title: ['staycapeann.com', 'guest AI (kb-facts)', 'automations', 'OTA push (later)'],
  summary: ['staycapeann.com', 'OTA push (later)'],
  space: ['staycapeann.com', 'guest AI (kb-facts)', 'OTA push (later)'],
  access: ['guest AI (kb-facts)', 'OTA push (later)'],
  interaction: ['OTA push (later)'],
  neighborhood: ['staycapeann.com', 'guest AI (kb-facts)', 'OTA push (later)'],
  house_rules: ['staycapeann.com', 'guest AI (kb-facts)', 'OTA push (later)'],
  notes: ['staycapeann.com'],
  property_type: ['staycapeann.com', 'OTA push (later)'],
  room_type: ['OTA push (later)'],
  accommodates: ['staycapeann.com', 'guest AI (kb-facts)', 'OTA push (later)'],
  bedrooms: ['staycapeann.com', 'OTA push (later)'],
  bathrooms: ['staycapeann.com', 'OTA push (later)'],
  beds: ['staycapeann.com', 'OTA push (later)'],
  amenities: ['staycapeann.com', 'guest AI (kb-facts)', 'OTA push (later)'],
  rooms: ['staycapeann.com', 'guest AI (kb-facts)'],
  photos: ['staycapeann.com', 'OTA push (later)'],
  hero: ['staycapeann.com'],
};

export function consumersOf(field: string): ListingConsumer[] {
  return FIELD_CONSUMERS[field] ?? [];
}

/**
 * The amenity vocabulary the checklist offers. Guesty's Airbnb-flavoured
 * strings, so a seeded list matches without translation; anything a home
 * carries outside this list still renders as a checked extra.
 */
export const AMENITY_CATALOG: ReadonlyArray<{ group: string; items: string[] }> = [
  {
    group: 'Essentials',
    items: [
      'Wireless Internet',
      'TV',
      'Air conditioning',
      'Heating',
      'Hot water',
      'Essentials',
      'Bed linens',
      'Hangers',
      'Iron',
      'Hair dryer',
      'Clothing storage',
      'Room-darkening shades',
      'Laptop friendly workspace',
      'Washer',
      'Dryer',
    ],
  },
  {
    group: 'Kitchen',
    items: [
      'Kitchen',
      'Refrigerator',
      'Freezer',
      'Microwave',
      'Oven',
      'Stove',
      'Dishwasher',
      'Coffee maker',
      'Coffee',
      'Kettle',
      'Toaster',
      'Cookware',
      'Baking sheet',
      'Dishes and silverware',
      'Wine glasses',
      'Dining table',
    ],
  },
  {
    group: 'Outdoors and parking',
    items: [
      'Free parking on premises',
      'Free street parking',
      'EV charger',
      'Garden or backyard',
      'Patio or balcony',
      'BBQ grill',
      'Barbeque utensils',
      'Outdoor furniture',
      'Outdoor dining area',
      'Fire pit',
      'Beach access',
      'Beach essentials',
      'Waterfront',
      'Bikes',
      'Kayak',
    ],
  },
  {
    group: 'Family',
    items: [
      'Suitable for children (2-12 years)',
      'Suitable for infants (under 2 years)',
      'High chair',
      'Pack ’n Play/travel crib',
      'Children’s books and toys',
      'Board games',
    ],
  },
  {
    group: 'Safety',
    items: ['Smoke detector', 'Carbon monoxide detector', 'Fire extinguisher', 'First aid kit', 'Lock on bedroom door'],
  },
  {
    group: 'Bath and comfort',
    items: ['Bathtub', 'Shampoo', 'Body soap', 'Hot tub', 'Fireplace', 'Indoor fireplace', 'Pets allowed', 'Long term stays allowed'],
  },
];

/** Compare amenities the way pricing-seed does: case, curly quotes, spacing folded. */
export function amenityMatchKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Pure: beds ──────────────────────────────────────────────────────────────

const plural = (size: string, count: number): string => (count === 1 ? size : `${size}s`);

/**
 * '1 king, 1 queen, 2 singles' across every bedroom, plus the per-room
 * lines a "Where you'll sleep" card needs. Rooms without beds are ignored;
 * order follows sort_order then the room's creation.
 */
export function bedSummary(rooms: readonly Pick<PropertyRoom, 'name' | 'room_type' | 'sort_order' | 'details'>[]): {
  text: string;
  totalBeds: number;
  bedrooms: number;
  perRoom: Array<{ name: string; beds: string }>;
} {
  const sorted = [...rooms].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const totals = new Map<string, number>();
  const perRoom: Array<{ name: string; beds: string }> = [];
  let bedrooms = 0;
  for (const r of sorted) {
    const beds: RoomBed[] = (r.details?.beds ?? []).filter((b) => b && b.size && Number(b.count) > 0);
    if (beds.length === 0) continue;
    if (r.room_type === 'bedroom') bedrooms += 1;
    for (const b of beds) {
      const size = String(b.size).trim().toLowerCase();
      totals.set(size, (totals.get(size) ?? 0) + Math.round(Number(b.count)));
    }
    perRoom.push({
      name: r.name,
      beds: beds.map((b) => `${Math.round(Number(b.count))} ${plural(String(b.size).trim().toLowerCase(), Math.round(Number(b.count)))}`).join(', '),
    });
  }
  const order = ['king', 'queen', 'full', 'double', 'twin', 'single', 'bunk', 'sofa bed', 'couch', 'air mattress', 'crib'];
  const parts = [...totals.entries()]
    .sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a[0].localeCompare(b[0]);
    })
    .map(([size, n]) => `${n} ${plural(size, n)}`);
  const totalBeds = [...totals.values()].reduce((s, n) => s + n, 0);
  return { text: parts.join(', '), totalBeds, bedrooms, perRoom };
}

// ── Pure: the staycapeann.com Listing shape ─────────────────────────────────

/** Mirror of stay-cape-ann lib/types.ts DescriptionBlock. */
export type ScaDescriptionBlock =
  | { kind: 'prose'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'bullets'; items: string[] };

/**
 * Mirror of stay-cape-ann lib/types.ts Listing (the fields Helm can fill).
 * Kept byte-compatible by hand; the SCA repo is the other copy.
 */
export type ScaListing = {
  id: string;
  title: string;
  tagline: string;
  description: string;
  descriptionBlocks?: ScaDescriptionBlock[];
  photos: Array<{ url: string; caption: string }>;
  bedrooms: number;
  bathrooms: number;
  accommodates: number;
  amenities: string[];
  basePrice: number;
  cleaningFee: number;
  extraPersonFee: number;
  guestsIncludedInRegularFee: number;
  currency: string;
  address: { city: string; state: string; full: string; lat?: number; lng?: number };
  town: string;
  highlights: string[];
  sleepingArrangements?: Array<{ name?: string; beds?: string; photo?: string | string[] }>;
};

const REGION_STATE: Record<string, string> = {
  [CAPE_ANN_REGION]: 'MA',
  bridgeport_ct: 'CT',
  lighthouse_point_fl: 'FL',
};

/** Guesty's "The space" text into SCA's About blocks: ☆ headings, → bullets, prose. */
export function descriptionBlocksFrom(space: string | null | undefined): ScaDescriptionBlock[] {
  const blocks: ScaDescriptionBlock[] = [];
  if (!space) return blocks;
  let bullets: string[] = [];
  let prose: string[] = [];
  const flush = () => {
    if (bullets.length) {
      blocks.push({ kind: 'bullets', items: bullets });
      bullets = [];
    }
    if (prose.length) {
      blocks.push({ kind: 'prose', text: prose.join(' ') });
      prose = [];
    }
  };
  for (const raw of space.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const heading = /^[☆★✦✧*]+\s*(.+?)\s*[☆★✦✧*]*$/.exec(line);
    if (heading && /^[☆★✦✧*]/.test(line)) {
      flush();
      blocks.push({ kind: 'heading', text: heading[1].trim() });
      continue;
    }
    const bullet = /^(?:→|-|•|✓|\*)\s+(.+)$/.exec(line);
    if (bullet) {
      if (prose.length) flush();
      bullets.push(bullet[1].trim());
      continue;
    }
    if (bullets.length) flush();
    prose.push(line);
  }
  flush();
  return blocks;
}

/** The ✓ lines of a Guesty summary become SCA highlights; the rest is the tagline. */
export function splitSummary(summary: string | null | undefined): { tagline: string; highlights: string[] } {
  const highlights: string[] = [];
  const rest: string[] = [];
  for (const raw of (summary ?? '').replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(?:✓|✔|•|-|→)\s*(.+)$/.exec(line);
    if (m) highlights.push(m[1].trim());
    else rest.push(line);
  }
  return { tagline: rest.join(' ').trim(), highlights };
}

const dollars = (c: number | null | undefined): number => Math.round(Number(c ?? 0)) / 100;

/**
 * Assemble the SCA Listing from the Helm record and the rate plan. Photos
 * come hero-first then by sort_order; sleeping arrangements from
 * property_rooms; the town is the registry city. Nothing in property_access
 * is read, so nothing here can leak a code.
 */
export function toScaListing(record: ListingRecord, plan: RatePlanRow | null): ScaListing {
  const { property, content, photos, rooms } = record;
  const orderedPhotos = [...photos].sort((a, b) => Number(b.is_hero) - Number(a.is_hero) || a.sort_order - b.sort_order);
  const beds = bedSummary(rooms);
  const { tagline, highlights } = splitSummary(content?.summary);
  const blocks = descriptionBlocksFrom(content?.space);
  const description = [content?.space, content?.neighborhood].filter(Boolean).join('\n\n');
  const state = REGION_STATE[property.region ?? CAPE_ANN_REGION] ?? 'MA';
  const city = property.city ?? '';
  const full = [property.address, city, state].filter(Boolean).join(', ');
  const sleeping = beds.perRoom.map((r) => {
    const photo = photos.find((p) => p.room_hint && p.room_hint.toLowerCase() === r.name.toLowerCase());
    return { name: r.name, beds: r.beds, ...(photo ? { photo: photo.url } : {}) };
  });
  return {
    id: property.id,
    title: content?.title ?? property.title ?? property.name,
    tagline,
    description,
    ...(blocks.length ? { descriptionBlocks: blocks } : {}),
    photos: orderedPhotos.map((p) => ({ url: p.url, caption: p.caption ?? '' })),
    bedrooms: Number(content?.bedrooms ?? property.bedrooms ?? beds.bedrooms ?? 0),
    bathrooms: Number(content?.bathrooms ?? property.bathrooms ?? 0),
    accommodates: Number(content?.accommodates ?? plan?.max_occupancy ?? 0),
    amenities: content?.amenities ?? [],
    basePrice: dollars(plan?.base_nightly_cents),
    cleaningFee: dollars(plan?.cleaning_fee_cents),
    extraPersonFee: dollars(plan?.extra_guest_cents_per_night),
    guestsIncludedInRegularFee: Number(plan?.guests_included ?? 2),
    currency: plan?.currency ?? 'USD',
    address: {
      city,
      state,
      full,
      ...(property.latitude != null ? { lat: Number(property.latitude) } : {}),
      ...(property.longitude != null ? { lng: Number(property.longitude) } : {}),
    },
    town: city,
    highlights,
    ...(sleeping.length ? { sleepingArrangements: sleeping } : {}),
  };
}

// ── Shapers ─────────────────────────────────────────────────────────────────

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));

export function shapeListingContent(raw: Record<string, unknown>): ListingContentRow {
  return {
    property_id: String(raw.property_id),
    title: strOrNull(raw.title),
    summary: strOrNull(raw.summary),
    space: strOrNull(raw.space),
    access: strOrNull(raw.access),
    interaction: strOrNull(raw.interaction),
    neighborhood: strOrNull(raw.neighborhood),
    house_rules: strOrNull(raw.house_rules),
    notes: strOrNull(raw.notes),
    property_type: strOrNull(raw.property_type),
    room_type: strOrNull(raw.room_type),
    accommodates: num(raw.accommodates),
    bedrooms: num(raw.bedrooms),
    bathrooms: num(raw.bathrooms),
    beds: num(raw.beds),
    amenities: Array.isArray(raw.amenities) ? raw.amenities.map(String) : [],
    amenities_not_included: Array.isArray(raw.amenities_not_included) ? raw.amenities_not_included.map(String) : [],
    hero_photo_id: strOrNull(raw.hero_photo_id),
    source: (String(raw.source ?? 'helm') as ListingContentSource),
    source_ref: strOrNull(raw.source_ref),
    updated_by: strOrNull(raw.updated_by),
    created_at: raw.created_at ? String(raw.created_at) : undefined,
    updated_at: raw.updated_at ? String(raw.updated_at) : undefined,
  };
}

export function shapeListingPhoto(raw: Record<string, unknown>): ListingPhotoRow {
  return {
    id: String(raw.id),
    property_id: String(raw.property_id),
    url: String(raw.url ?? ''),
    source_url: strOrNull(raw.source_url),
    thumbnail_url: strOrNull(raw.thumbnail_url),
    caption: strOrNull(raw.caption),
    room_hint: strOrNull(raw.room_hint),
    sort_order: num(raw.sort_order) ?? 0,
    is_hero: !!raw.is_hero,
    source: (String(raw.source ?? 'helm') as ListingPhotoSource),
    external_id: strOrNull(raw.external_id),
    width: num(raw.width),
    height: num(raw.height),
    created_at: raw.created_at ? String(raw.created_at) : undefined,
    updated_at: raw.updated_at ? String(raw.updated_at) : undefined,
  };
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function getListingContent(propertyId: string): Promise<ListingContentRow | null> {
  if (!isServiceConfigured || !propertyId) return null;
  const { data, error } = await supabaseAdmin
    .from('property_listing_content')
    .select(LISTING_CONTENT_COLS)
    .eq('property_id', propertyId)
    .maybeSingle();
  if (error) throw new Error(`listing content read ${propertyId}: ${error.message}`);
  return data ? shapeListingContent(data as Record<string, unknown>) : null;
}

export async function getListingPhotos(propertyId: string): Promise<ListingPhotoRow[]> {
  if (!isServiceConfigured || !propertyId) return [];
  const { data, error } = await supabaseAdmin
    .from('property_listing_photos')
    .select(LISTING_PHOTO_COLS)
    .eq('property_id', propertyId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) throw new Error(`listing photos read ${propertyId}: ${error.message}`);
  return (data ?? []).map((r) => shapeListingPhoto(r as Record<string, unknown>));
}

async function readRooms(propertyId: string): Promise<PropertyRoom[]> {
  // property-rooms.ts carries the 'server-only' marker node:test cannot
  // load, so the read is repeated here against the same table.
  const { data, error } = await supabaseAdmin
    .from('property_rooms')
    .select('*')
    .eq('property_id', propertyId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(`property rooms read ${propertyId}: ${error.message}`);
  return (data ?? []) as PropertyRoom[];
}

async function readPropertyFacts(propertyId: string): Promise<ListingPropertyFacts | null> {
  const { data, error } = await supabaseAdmin.from('properties').select(PROPERTY_FACT_COLS).eq('id', propertyId).maybeSingle();
  if (error) throw new Error(`property facts read ${propertyId}: ${error.message}`);
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: String(r.id),
    name: String(r.name ?? r.id),
    title: strOrNull(r.title),
    address: strOrNull(r.address),
    city: strOrNull(r.city),
    region: strOrNull(r.region),
    latitude: num(r.latitude),
    longitude: num(r.longitude),
    bedrooms: num(r.bedrooms),
    bathrooms: num(r.bathrooms),
    calendar_authority: strOrNull(r.calendar_authority),
  };
}

/** The whole record, or null when the property does not exist (or no service role). */
export async function getListingRecord(propertyId: string): Promise<ListingRecord | null> {
  if (!isServiceConfigured || !propertyId) return null;
  const property = await readPropertyFacts(propertyId);
  if (!property) return null;
  const [content, photos, rooms] = await Promise.all([getListingContent(propertyId), getListingPhotos(propertyId), readRooms(propertyId)]);
  return { property, content, photos, rooms };
}

// ── Writes ──────────────────────────────────────────────────────────────────

export type ListingContentPatch = Partial<Omit<ListingContentRow, 'property_id' | 'created_at' | 'updated_at' | 'updated_by'>> & {
  property_id: string;
};

/** Create or update the property's one content row; only named columns move. */
export async function upsertListingContent(patch: ListingContentPatch, by: string): Promise<ListingContentRow> {
  if (!patch.property_id) throw new Error('upsertListingContent: property_id is required');
  const row: Record<string, unknown> = { ...patch, updated_by: by, updated_at: new Date().toISOString() };
  const { data, error } = await supabaseAdmin
    .from('property_listing_content')
    .upsert(row, { onConflict: 'property_id' })
    .select(LISTING_CONTENT_COLS)
    .single();
  if (error) throw new Error(`listing content upsert ${patch.property_id}: ${error.message}`);
  return shapeListingContent(data as Record<string, unknown>);
}

export type ListingPhotoInput = {
  id?: string;
  property_id: string;
  url: string;
  source_url?: string | null;
  thumbnail_url?: string | null;
  caption?: string | null;
  room_hint?: string | null;
  sort_order?: number;
  is_hero?: boolean;
  source?: ListingPhotoSource;
  external_id?: string | null;
  width?: number | null;
  height?: number | null;
};

/**
 * Insert or update one photo. With an id, the row is updated; with an
 * external_id (a seeded Guesty picture), the existing row for that id is
 * updated so re-runs are idempotent; otherwise a new row lands at the end
 * of the gallery. Setting is_hero here goes through setHero so the partial
 * unique index (one hero per property) never trips.
 */
export async function upsertPhoto(input: ListingPhotoInput): Promise<ListingPhotoRow> {
  if (!input.property_id || !input.url) throw new Error('upsertPhoto: property_id and url are required');
  const stamp = new Date().toISOString();
  const base: Record<string, unknown> = {
    property_id: input.property_id,
    url: input.url,
    source_url: input.source_url ?? null,
    thumbnail_url: input.thumbnail_url ?? null,
    caption: input.caption ?? null,
    room_hint: input.room_hint ?? null,
    source: input.source ?? 'helm',
    external_id: input.external_id ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    updated_at: stamp,
  };
  if (input.sort_order != null) base.sort_order = input.sort_order;

  let existingId = input.id ?? null;
  if (!existingId && input.external_id) {
    const { data } = await supabaseAdmin
      .from('property_listing_photos')
      .select('id')
      .eq('property_id', input.property_id)
      .eq('external_id', input.external_id)
      .maybeSingle();
    existingId = (data as { id: string } | null)?.id ?? null;
  }

  let saved: Record<string, unknown>;
  if (existingId) {
    const { data, error } = await supabaseAdmin
      .from('property_listing_photos')
      .update(base)
      .eq('id', existingId)
      .eq('property_id', input.property_id)
      .select(LISTING_PHOTO_COLS)
      .single();
    if (error) throw new Error(`listing photo update ${existingId}: ${error.message}`);
    saved = data as Record<string, unknown>;
  } else {
    if (base.sort_order == null) {
      const { data } = await supabaseAdmin
        .from('property_listing_photos')
        .select('sort_order')
        .eq('property_id', input.property_id)
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      base.sort_order = ((data as { sort_order: number } | null)?.sort_order ?? -1) + 1;
    }
    const { data, error } = await supabaseAdmin
      .from('property_listing_photos')
      .insert(base)
      .select(LISTING_PHOTO_COLS)
      .single();
    if (error) throw new Error(`listing photo insert ${input.property_id}: ${error.message}`);
    saved = data as Record<string, unknown>;
  }
  const row = shapeListingPhoto(saved);
  if (input.is_hero) return (await setHero(input.property_id, row.id)) ?? row;
  return row;
}

export async function deletePhoto(propertyId: string, photoId: string): Promise<void> {
  const { error } = await supabaseAdmin.from('property_listing_photos').delete().eq('id', photoId).eq('property_id', propertyId);
  if (error) throw new Error(`listing photo delete ${photoId}: ${error.message}`);
}

/**
 * Apply a full order. Ids not in the list keep their relative order after
 * the named ones, so a stale client list cannot orphan a photo.
 */
export async function reorderPhotos(propertyId: string, orderedIds: readonly string[]): Promise<number> {
  const current = await getListingPhotos(propertyId);
  const named = orderedIds.filter((id) => current.some((p) => p.id === id));
  const rest = current.filter((p) => !named.includes(p.id)).map((p) => p.id);
  const finalOrder = [...named, ...rest];
  const stamp = new Date().toISOString();
  let written = 0;
  for (let i = 0; i < finalOrder.length; i++) {
    const id = finalOrder[i];
    const existing = current.find((p) => p.id === id);
    if (existing && existing.sort_order === i) continue;
    const { error } = await supabaseAdmin
      .from('property_listing_photos')
      .update({ sort_order: i, updated_at: stamp })
      .eq('id', id)
      .eq('property_id', propertyId);
    if (error) throw new Error(`listing photo reorder ${id}: ${error.message}`);
    written += 1;
  }
  return written;
}

/**
 * Make one photo the hero: clear the flag on the property's other rows
 * first (the partial unique index allows exactly one), then set it and
 * stamp hero_photo_id on the content row when one exists.
 */
export async function setHero(propertyId: string, photoId: string): Promise<ListingPhotoRow | null> {
  const stamp = new Date().toISOString();
  const clear = await supabaseAdmin
    .from('property_listing_photos')
    .update({ is_hero: false, updated_at: stamp })
    .eq('property_id', propertyId)
    .eq('is_hero', true)
    .neq('id', photoId);
  if (clear.error) throw new Error(`listing hero clear ${propertyId}: ${clear.error.message}`);
  const { data, error } = await supabaseAdmin
    .from('property_listing_photos')
    .update({ is_hero: true, updated_at: stamp })
    .eq('id', photoId)
    .eq('property_id', propertyId)
    .select(LISTING_PHOTO_COLS)
    .maybeSingle();
  if (error) throw new Error(`listing hero set ${photoId}: ${error.message}`);
  if (!data) return null;
  const content = await supabaseAdmin
    .from('property_listing_content')
    .update({ hero_photo_id: photoId, updated_at: stamp })
    .eq('property_id', propertyId);
  if (content.error) throw new Error(`listing hero stamp ${propertyId}: ${content.error.message}`);
  return shapeListingPhoto(data as Record<string, unknown>);
}
