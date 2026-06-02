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
  photo: z.string().trim().optional(),
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
  sleepingArrangements?: Array<{ name?: string; beds?: string; photo?: string }>;
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
    const arr = form.sleepingArrangements
      .map((s) => {
        const o: { name?: string; beds?: string; photo?: string } = {};
        if (s.name) o.name = s.name;
        if (s.beds) o.beds = s.beds;
        if (s.photo) o.photo = s.photo;
        return o;
      })
      .filter((o) => Object.keys(o).length > 0);
    if (arr.length) entry.sleepingArrangements = arr;
  }
  return entry;
}

type RawRegistry = { description?: string; listings?: Record<string, unknown> };

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
  entry: ScaRegistryEntry,
): string {
  const obj = parseRegistry(raw);
  if (!obj.listings) obj.listings = {};
  obj.listings[guestyListingId] = entry;
  return JSON.stringify(obj, null, 2) + '\n';
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
