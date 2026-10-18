/**
 * Stay Cape Ann launch — pure logic (no I/O).
 *
 * Validates the operator's editorial draft, builds the data/ical-urls.json
 * registry entry, and applies/removes it against the raw registry JSON with a
 * minimal, review-friendly diff (parse -> mutate -> JSON.stringify(_, 2) + "\n",
 * which reproduces the file byte-for-byte plus the one changed entry — verified
 * against the live file). Kept I/O-free so it's trivially testable and so the
 * GitHub calls stay in the server actions.
 *
 * The emitted entry mirrors stay-cape-ann's IcalRegistryEntry (lib/icalRegistry.ts).
 * internalName / publicName / icalUrl are the only fields that repo requires; we
 * additionally require a launch-ready editorial set (pitch, tagline, 3 highlights,
 * a stayFavorite, a stripeAccountKey) so launched pages are never thin.
 */

import { z } from 'zod';

export type ScaLaunchStatus = 'draft' | 'pr_open' | 'live' | 'unlisted';
export type PaymentVerifySignal = 'wired' | 'demo_mode' | 'unknown';

/** The persisted row (public.sca_launches). Non-secret. */
export type ScaLaunchRow = {
  property_id: string;
  guesty_listing_id: string | null;
  stripe_account_key: string | null;
  ical_url: string | null;
  rank: number | null;
  status: ScaLaunchStatus;
  registry_entry: ScaFormDraft | null;
  branch_name: string | null;
  pr_number: number | null;
  pr_url: string | null;
  preview_url: string | null;
  payment_publishable_set: boolean;
  payment_secret_set: boolean;
  payment_webhook_set: boolean;
  payment_verified_at: string | null;
  payment_verify_signal: PaymentVerifySignal | null;
  published_at: string | null;
  live_url: string | null;
  snapshot_refreshed_at: string | null;
  snapshot_refresh_error: string | null;
  snapshot_refresh_error_at: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const favoriteSchema = z.object({
  name: z.string().trim().min(1, 'Name required'),
  town: z.string().trim().min(1, 'Town required'),
  blurb: z.string().trim().min(1, 'A one-sentence blurb is required'),
  lat: z.number().refine((n) => Number.isFinite(n), 'Latitude required'),
  lng: z.number().refine((n) => Number.isFinite(n), 'Longitude required'),
});

const reviewSchema = z.object({
  name: z.string().trim().min(1),
  date: z.string().trim().min(1), // YYYY-MM
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().min(1),
});

const sleepingSchema = z.object({
  name: z.string().trim().optional(),
  beds: z.string().trim().optional(),
  // One or more uploaded photo URLs for this bedroom (Vercel Blob).
  photo: z.array(z.string().trim()).optional(),
});

/**
 * Launch-ready schema. Anything optional in the registry stays optional here,
 * but we require the editorial core so a launched page reads well.
 */
export const scaFormSchema = z.object({
  guestyListingId: z.string().trim().min(1, 'Guesty listing ID is required'),
  internalName: z.string().trim().min(1, 'Internal name is required'),
  publicName: z.string().trim().min(1, 'Public listing name is required'),
  icalUrl: z
    .string()
    .trim()
    .refine((v) => /^https?:\/\//.test(v), 'Must be the Guesty iCal export URL (https://...)'),
  stripeAccountKey: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_]+$/, 'Letters, numbers, and underscores only (e.g. 36_GRANITE)'),
  rank: z.number().int('Rank must be a whole number'),
  pitch: z.string().trim().min(1, 'A short map pitch is required'),
  tagline: z.string().trim().min(1, 'A tagline is required'),
  description: z.string().trim().optional(),
  highlights: z
    .array(z.string().trim())
    .transform((arr) => arr.filter((s) => s.length > 0))
    .refine((arr) => arr.length >= 3, 'At least 3 highlights are required'),
  stayFavorite: favoriteSchema,
  extraFavorites: z.array(favoriteSchema).optional(),
  sleepingArrangements: z.array(sleepingSchema).optional(),
  reviews: z.array(reviewSchema).optional(),
  rating: z.number().optional(),
  reviewCount: z.number().int().optional(),
  heroPhoto: z.string().trim().optional(),
});

/** The form/draft shape (loosely typed for in-progress drafts in the UI). */
export type ScaFormDraft = {
  guestyListingId: string;
  internalName: string;
  publicName: string;
  icalUrl: string;
  stripeAccountKey: string;
  rank: number;
  pitch: string;
  tagline: string;
  description?: string;
  highlights: string[];
  stayFavorite: { name: string; town: string; blurb: string; lat: number; lng: number };
  extraFavorites?: Array<{ name: string; town: string; blurb: string; lat: number; lng: number }>;
  sleepingArrangements?: Array<{ name?: string; beds?: string; photo?: string[] }>;
  reviews?: Array<{ name: string; date: string; rating: number; text: string }>;
  rating?: number;
  reviewCount?: number;
  heroPhoto?: string;
};

/** The object we write into data/ical-urls.json (mirrors IcalRegistryEntry). */
export type ScaRegistryEntry = {
  internalName: string;
  publicName: string;
  icalUrl: string;
  rank?: number;
  stripeAccountKey?: string;
  pitch?: string;
  tagline?: string;
  description?: string;
  highlights?: string[];
  heroPhoto?: string;
  rating?: number;
  reviewCount?: number;
  reviews?: Array<{ name: string; date: string; rating: number; text: string }>;
  stayFavorite?: { name: string; category: 'dining'; lat: number; lng: number; town: string; blurb: string };
  extraFavorites?: Array<{ name: string; category: 'dining'; lat: number; lng: number; town: string; blurb: string }>;
  sleepingArrangements?: Array<{ name?: string; beds?: string; photo?: string | string[] }>;
};

export type ValidationResult =
  | { ok: true; data: z.infer<typeof scaFormSchema> }
  | { ok: false; errors: Record<string, string> };

/** Validate a draft into a launch-ready form, flattening zod issues by field. */
export function validateScaForm(draft: unknown): ValidationResult {
  const parsed = scaFormSchema.safeParse(draft);
  if (parsed.success) return { ok: true, data: parsed.data };
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join('.') || 'form';
    if (!errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}

/** 36_granite -> 36_GRANITE. Sanitizes to the registry's allowed charset. */
export function deriveStripeAccountKey(propertyId: string): string {
  return propertyId
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Registry photo-field rule, shared by the launcher and the bedroom-photo tool:
 * 0 photos -> omit the field, 1 -> a bare string, >1 -> an array (stay-cape-ann
 * renders up to 3 side-by-side). Empty/whitespace URLs are dropped first.
 */
export function toPhotoField(photos: readonly string[]): string | string[] | undefined {
  const clean = photos.map((p) => p.trim()).filter(Boolean);
  if (clean.length === 0) return undefined;
  if (clean.length === 1) return clean[0];
  return clean;
}

/** Build the registry entry, omitting empty optionals so the JSON stays tidy. */
export function buildRegistryEntry(form: z.infer<typeof scaFormSchema>): ScaRegistryEntry {
  const entry: ScaRegistryEntry = {
    internalName: form.internalName,
    publicName: form.publicName,
    icalUrl: form.icalUrl,
    rank: form.rank,
    stripeAccountKey: form.stripeAccountKey,
    pitch: form.pitch,
    tagline: form.tagline,
    highlights: form.highlights,
    stayFavorite: { ...form.stayFavorite, category: 'dining' },
  };
  if (form.description) entry.description = form.description;
  if (form.heroPhoto) entry.heroPhoto = form.heroPhoto;
  if (typeof form.rating === 'number') entry.rating = form.rating;
  if (typeof form.reviewCount === 'number') entry.reviewCount = form.reviewCount;
  if (form.reviews && form.reviews.length) entry.reviews = form.reviews;
  if (form.extraFavorites && form.extraFavorites.length) {
    entry.extraFavorites = form.extraFavorites.map((f) => ({ ...f, category: 'dining' as const }));
  }
  if (form.sleepingArrangements && form.sleepingArrangements.length) {
    // A room's place is its card's place on the site, so an empty room in the
    // middle stays as {} (a placeholder card); only trailing empties drop.
    const arr = buildSleepingArrangementsForRegistry(form.sleepingArrangements);
    if (arr.length) entry.sleepingArrangements = arr;
  }
  return entry;
}

/**
 * The registry fields the launcher writes. Anything else on a live entry
 * (nearbyOverrides, a dining pick's address) was put there by hand in the
 * stay-cape-ann repo, and an update from Helm must carry it through untouched.
 */
const MANAGED_KEYS = [
  'internalName', 'publicName', 'icalUrl', 'rank', 'stripeAccountKey', 'pitch', 'tagline', 'description',
  'highlights', 'heroPhoto', 'rating', 'reviewCount', 'reviews', 'stayFavorite', 'extraFavorites', 'sleepingArrangements',
] as const;
const FAVORITE_KEYS = ['name', 'category', 'lat', 'lng', 'town', 'blurb'];
const ROOM_KEYS = ['name', 'beds', 'photo'];
const REVIEW_KEYS = ['name', 'date', 'rating', 'text'];

function pickKeys(value: unknown, keys: readonly string[]): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const src = value as Record<string, unknown>;
  return Object.fromEntries(keys.filter((k) => Object.prototype.hasOwnProperty.call(src, k)).map((k) => [k, src[k]]));
}

/** The part of a registry entry the launcher owns: what its preview check compares. */
export function managedRegistryView(entry: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of MANAGED_KEYS) if (Object.prototype.hasOwnProperty.call(entry, k)) out[k] = entry[k];
  if (out.stayFavorite !== undefined) out.stayFavorite = pickKeys(out.stayFavorite, FAVORITE_KEYS);
  if (Array.isArray(out.extraFavorites)) out.extraFavorites = out.extraFavorites.map((f) => pickKeys(f, FAVORITE_KEYS));
  if (Array.isArray(out.sleepingArrangements)) out.sleepingArrangements = out.sleepingArrangements.map((r) => pickKeys(r, ROOM_KEYS));
  if (Array.isArray(out.reviews)) out.reviews = out.reviews.map((r) => pickKeys(r, REVIEW_KEYS));
  return out;
}

/**
 * Write the launcher's entry over a listing's live entry. The launcher's
 * fields take the form's values (a field the form leaves empty is removed, so
 * the site falls back to Guesty for it); every other field survives, and a
 * dining pick that keeps its name keeps its own extra details.
 */
export function mergeRegistryEntry(live: Record<string, unknown>, next: ScaRegistryEntry): Record<string, unknown> {
  const out: Record<string, unknown> = { ...live };
  const nextRec = next as unknown as Record<string, unknown>;
  for (const k of MANAGED_KEYS) {
    if (nextRec[k] === undefined) delete out[k];
    else out[k] = nextRec[k];
  }
  const nameOf = (f: unknown): string =>
    f && typeof f === 'object' ? String((f as { name?: unknown }).name ?? '').trim().toLowerCase() : '';
  const keepDetails = (prev: unknown, cur: unknown): unknown =>
    prev && cur && typeof prev === 'object' && typeof cur === 'object' && nameOf(prev) && nameOf(prev) === nameOf(cur)
      ? { ...(prev as Record<string, unknown>), ...(cur as Record<string, unknown>) }
      : cur;
  if (out.stayFavorite !== undefined) out.stayFavorite = keepDetails(live.stayFavorite, out.stayFavorite);
  if (Array.isArray(out.extraFavorites)) {
    const prev = Array.isArray(live.extraFavorites) ? live.extraFavorites : [];
    out.extraFavorites = out.extraFavorites.map((f) => keepDetails(prev.find((p) => nameOf(p) === nameOf(f)), f));
  }
  return out;
}

type RawRegistry = { description?: string; listings?: Record<string, unknown> };

/**
 * Compare the launcher's part of a registry entry (managedRegistryView),
 * independent of object-key order, retaining array order. Fields the launcher
 * does not write are outside the comparison, so preserving them never reads
 * as "your form differs from the preview".
 */
export function scaPreviewSignature(listingId: string, entry: unknown): string | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  entry = managedRegistryView(entry as Record<string, unknown>);
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)]));
    }
    return value;
  };
  return JSON.stringify([listingId.trim(), canonical(entry)]);
}

/** Use the exact validation/serialization used when opening the preview PR. */
export function scaDraftPreviewSignature(draft: ScaFormDraft): string | null {
  const valid = validateScaForm(draft);
  return valid.ok ? scaPreviewSignature(valid.data.guestyListingId, buildRegistryEntry(valid.data)) : null;
}

function parseRegistry(raw: string): RawRegistry {
  const obj = JSON.parse(raw) as RawRegistry;
  if (!obj || typeof obj !== 'object') throw new Error('Registry JSON is not an object');
  return obj;
}

/** True if a listing ID is already present in the registry. */
export function registryHasListing(raw: string, guestyListingId: string): boolean {
  const obj = parseRegistry(raw);
  return !!(obj.listings && Object.prototype.hasOwnProperty.call(obj.listings, guestyListingId));
}

/** Next display rank: max(existing) + 10, or 10 if empty. */
export function nextRank(raw: string): number {
  const obj = parseRegistry(raw);
  const ranks = Object.values(obj.listings ?? {})
    .map((l) => (l as { rank?: number }).rank)
    .filter((n): n is number => typeof n === 'number');
  return ranks.length ? Math.max(...ranks) + 10 : 10;
}

/**
 * Insert/replace an entry and re-serialize. Appends the new key to the end of
 * `listings`, so the PR diff is exactly the one entry (the file is already
 * 2-space formatted with a trailing newline).
 */
export function applyEntryToRegistryJson(
  raw: string,
  guestyListingId: string,
  entry: ScaRegistryEntry | Record<string, unknown>,
): string {
  const obj = parseRegistry(raw);
  if (!obj.listings) obj.listings = {};
  obj.listings[guestyListingId] = entry;
  return JSON.stringify(obj, null, 2) + '\n';
}

/** One bedroom slot as the operator edits it (photos held as an array). */
export type SleepingPhotoInput = { name?: string; beds?: string; photo?: string[] };

/**
 * Build the registry `sleepingArrangements` array from the launcher's rooms.
 * A slot's position is its bedroom card's position on the site, so interior
 * empty slots are preserved as {} (stay-cape-ann renders those as placeholder
 * cards). Only trailing empties are trimmed.
 */
export function buildSleepingArrangementsForRegistry(
  input: SleepingPhotoInput[],
): Array<{ name?: string; beds?: string; photo?: string | string[] }> {
  const mapped = input.map((s) => {
    const o: { name?: string; beds?: string; photo?: string | string[] } = {};
    const name = s.name?.trim();
    const beds = s.beds?.trim();
    if (name) o.name = name;
    if (beds) o.beds = beds;
    const photo = toPhotoField(Array.isArray(s.photo) ? s.photo : []);
    if (photo !== undefined) o.photo = photo;
    return o;
  });
  let end = mapped.length;
  while (end > 0 && Object.keys(mapped[end - 1]).length === 0) end--;
  return mapped.slice(0, end);
}

/** Read one listing's entry from the raw registry JSON, or null when absent. */
export function registryEntryFor(raw: string, guestyListingId: string): Record<string, unknown> | null {
  const obj = parseRegistry(raw);
  const id = guestyListingId.trim();
  if (!id || !obj.listings || !Object.prototype.hasOwnProperty.call(obj.listings, id)) return null;
  const entry = obj.listings[id];
  return entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>) : null;
}

/**
 * The launcher form for a listing that is already on staycapeann.com, read
 * back from its live registry entry. The inverse of buildRegistryEntry, so a
 * live listing opens on exactly what guests see (the copy, the dining picks,
 * every bedroom photo) rather than on a draft saved before an edit made
 * elsewhere. Unknown fields are left out; missing ones take the form's
 * defaults, and the launcher's validation names anything a launch requires.
 */
export function registryEntryToDraft(
  guestyListingId: string,
  entry: Record<string, unknown>,
  fallback: Pick<ScaFormDraft, 'internalName' | 'stripeAccountKey' | 'rank'>,
): ScaFormDraft {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const fav = (v: unknown): ScaFormDraft['stayFavorite'] => {
    const f = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    return { name: str(f.name), town: str(f.town), blurb: str(f.blurb), lat: num(f.lat), lng: num(f.lng) };
  };
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const highlights = list(entry.highlights).map(str).filter((h) => h.trim());
  const draft: ScaFormDraft = {
    guestyListingId: guestyListingId.trim(),
    internalName: str(entry.internalName) || fallback.internalName,
    publicName: str(entry.publicName),
    icalUrl: str(entry.icalUrl),
    stripeAccountKey: str(entry.stripeAccountKey) || fallback.stripeAccountKey,
    rank: typeof entry.rank === 'number' && Number.isFinite(entry.rank) ? entry.rank : fallback.rank,
    pitch: str(entry.pitch),
    tagline: str(entry.tagline),
    description: str(entry.description),
    highlights: [...highlights, '', '', ''].slice(0, Math.max(3, highlights.length)),
    stayFavorite: fav(entry.stayFavorite),
    extraFavorites: list(entry.extraFavorites).map(fav),
    sleepingArrangements: list(entry.sleepingArrangements).map((v) => {
      const s = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
      const photo = Array.isArray(s.photo) ? s.photo.map(str).filter(Boolean) : str(s.photo) ? [str(s.photo)] : [];
      return { name: str(s.name), beds: str(s.beds), photo };
    }),
    reviews: list(entry.reviews).map((v) => {
      const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
      return { name: str(r.name), date: str(r.date), rating: typeof r.rating === 'number' ? r.rating : 5, text: str(r.text) };
    }),
  };
  if (typeof entry.rating === 'number') draft.rating = entry.rating;
  if (typeof entry.reviewCount === 'number') draft.reviewCount = entry.reviewCount;
  if (str(entry.heroPhoto)) draft.heroPhoto = str(entry.heroPhoto);
  return draft;
}

/** Remove an entry (the "unlist" path). No-op if absent. */
export function removeEntryFromRegistryJson(raw: string, guestyListingId: string): string {
  const obj = parseRegistry(raw);
  if (obj.listings) delete obj.listings[guestyListingId];
  return JSON.stringify(obj, null, 2) + '\n';
}

/**
 * Interpret a fetched /book page: the SCA BookingForm renders the demo-mode
 * sentinel when no publishable key is configured for the listing. Pure so it's
 * testable without the network.
 */
export function interpretBookProbe(html: string, sentinel: string): PaymentVerifySignal {
  if (!html) return 'unknown';
  if (html.includes(sentinel)) return 'demo_mode';
  // The form rendered without the demo notice => a publishable key is wired.
  return 'wired';
}
