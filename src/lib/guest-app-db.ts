/**
 * Server side of the Stay Cape Ann guest app: the guest_app_homes row (one
 * permanent link per home) and the live read that feeds buildGuestApp.
 *
 * Every read here is guest-safe by construction:
 *   - properties through GUEST_APP_PROPERTY_COLS only, never select('*');
 *   - property_access through getGuestWifiPasswords, a select of the two
 *     Wi-Fi passwords and nothing else (no door, gate, garage, alarm or
 *     thermostat code is ever in this module's memory);
 *   - property_rooms through guestRoomFacts, the same field-by-field shape
 *     /api/kb-facts sends the guest AI (a room's quirks and notes stay home);
 *   - property_notes: open guest-facing facts only, the concierge's KB.
 * guest-app.test.ts reads this file and fails if any of that changes.
 *
 * The app is Stay Cape Ann's, so it serves Cape Ann homes only: a home in
 * another region has no SCA brand to wear.
 */
import 'server-only';
import { randomBytes } from 'node:crypto';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { getGuestWifiPasswords } from '@/lib/property-access';
import { guestRoomFacts } from '@/lib/kb-facts-rooms';
import { isCapeAnnOps } from '@/lib/property-scope';
import {
  buildGuestApp,
  easternDate,
  GUEST_APP_PROPERTY_COLS,
  type GuestApp,
  type GuestAppHome,
  type GuestAppNote,
} from '@/lib/guest-app';
import { findGuideListing, nearbyPlaces, type GuideData } from '@/lib/guest-app-nearby';
import type { PropertyRoom } from '@/lib/property-rooms-shared';
import guideJson from '@/data/sca-guide.json';

const GUIDE = guideJson as unknown as GuideData;

export type GuestAppRow = {
  property_id: string;
  token: string;
  enabled: boolean;
  welcome_note: string | null;
  open_count: number;
  last_opened_at: string | null;
  rotated_at: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};

const ROW_COLS = 'property_id, token, enabled, welcome_note, open_count, last_opened_at, rotated_at, created_at, updated_at, updated_by';

/** 16 lowercase hex: 64 random bits, the /b/ shoot-brief length. */
export function newGuestAppToken(): string {
  return randomBytes(8).toString('hex');
}

export const GUEST_APP_TOKEN_RE = /^[a-f0-9]{16,64}$/;

/** Where the link lives. Overridable so a guest-facing domain can front Helm later. */
export function guestAppOrigin(): string {
  return (process.env.GUEST_APP_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || 'https://helm.risingtidestr.com').replace(/\/+$/, '');
}

export function guestAppUrl(token: string): string {
  return `${guestAppOrigin()}/h/${token}`;
}

/** What the property page's Guest app panel shows and edits. */
export type GuestAppView = {
  enabled: boolean;
  url: string;
  welcomeNote: string;
  openCount: number;
  /** Eastern calendar days (YYYY-MM-DD), so the panel never shows a UTC day. */
  lastOpenedDay: string | null;
  rotatedDay: string | null;
};

function easternDay(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : easternDate(d);
}

export function guestAppView(row: GuestAppRow): GuestAppView {
  return {
    enabled: row.enabled,
    url: guestAppUrl(row.token),
    welcomeNote: row.welcome_note ?? '',
    openCount: row.open_count ?? 0,
    lastOpenedDay: easternDay(row.last_opened_at),
    rotatedDay: easternDay(row.rotated_at),
  };
}

/** The row for one home, or null (none yet, or the table is not there yet). */
export async function getGuestAppRow(propertyId: string): Promise<GuestAppRow | null> {
  if (!isServiceConfigured || !propertyId) return null;
  const { data, error } = await supabaseAdmin.from('guest_app_homes').select(ROW_COLS).eq('property_id', propertyId).maybeSingle();
  if (error || !data) return null;
  return data as GuestAppRow;
}

async function rowByToken(token: string): Promise<GuestAppRow | null> {
  if (!isServiceConfigured || !GUEST_APP_TOKEN_RE.test(token)) return null;
  const { data, error } = await supabaseAdmin.from('guest_app_homes').select(ROW_COLS).eq('token', token).maybeSingle();
  if (error || !data) return null;
  return data as GuestAppRow;
}

/**
 * Columns added most recently. Migrations here are applied by hand, so a
 * column can reach the code before it reaches the database; without this a
 * missing column would turn every printed QR code into a 404. The retry
 * drops only these, and the app simply has nothing for them.
 */
const NEWEST_COLS = ['oil_shutoff_location'];

async function readHome(propertyId: string): Promise<GuestAppHome | null> {
  const read = (cols: string) =>
    supabaseAdmin.from('properties').select(cols).eq('id', propertyId).eq('is_active', true).maybeSingle();
  let { data, error } = await read(GUEST_APP_PROPERTY_COLS);
  if (error && /column/i.test(error.message)) {
    const reduced = GUEST_APP_PROPERTY_COLS.split(',')
      .map((c) => c.trim())
      .filter((c) => c && !NEWEST_COLS.includes(c))
      .join(', ');
    ({ data, error } = await read(reduced));
  }
  if (error || !data) return null;
  const row = data as unknown as Partial<GuestAppHome>;
  const home = { ...row, oil_shutoff_location: row.oil_shutoff_location ?? null } as GuestAppHome;
  return isCapeAnnOps({ region: home.region }) ? home : null;
}

/**
 * Guesty's guest arrival time for the home (guesty_listings.checkin_time,
 * which /api/sync-guesty copies from the listing's defaultCheckInTime). The
 * fallback when the home has no Helm rate plan, which is every Guesty-run
 * home. Null when the home has no mapped listing, when its listings disagree
 * (never a guess), or when the column is not on this database yet.
 * Never properties.default_checkin_time: that is the cleaner deadline.
 */
export async function guestyCheckinTime(propertyId: string): Promise<string | null> {
  if (!isServiceConfigured || !propertyId) return null;
  const { data, error } = await supabaseAdmin.from('guesty_listings').select('checkin_time').eq('property_id', propertyId);
  if (error || !Array.isArray(data)) return null;
  const times = new Set(
    (data as Array<{ checkin_time: string | null }>)
      .map((r) => r.checkin_time)
      .filter((t): t is string => typeof t === 'string' && /^\d{2}:\d{2}$/.test(t)),
  );
  return times.size === 1 ? [...times][0] : null;
}

/**
 * Everything one home's app shows, read live. `now` is passed in so the
 * property page and the guest page agree on "today".
 */
export async function loadGuestApp(propertyId: string, welcomeNote: string | null, now = new Date()): Promise<GuestApp | null> {
  const home = await readHome(propertyId);
  if (!home) return null;

  const [wifi, roomsRes, notesRes, planRes, guestyCheckin, photoRes] = await Promise.all([
    getGuestWifiPasswords(propertyId),
    supabaseAdmin
      .from('property_rooms')
      .select('id, property_id, room_type, name, sort_order, details, guest_summary, created_at')
      .eq('property_id', propertyId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('property_notes')
      .select('title, body')
      .eq('property_id', propertyId)
      .eq('guest_facing', true)
      .is('resolved_at', null)
      .order('created_at', { ascending: true }),
    supabaseAdmin.from('property_rate_plans').select('checkin_time').eq('property_id', propertyId).maybeSingle(),
    guestyCheckinTime(propertyId),
    supabaseAdmin
      .from('property_listing_photos')
      .select('url, is_hero, sort_order')
      .eq('property_id', propertyId)
      .order('is_hero', { ascending: false })
      .order('sort_order', { ascending: true })
      .limit(1),
  ]);

  const rooms = guestRoomFacts(
    ((roomsRes.data ?? []) as Pick<PropertyRoom, 'name' | 'room_type' | 'details' | 'guest_summary'>[]),
  );
  const notes: GuestAppNote[] = ((notesRes.data ?? []) as Array<{ title: string | null; body: string | null }>)
    .map((n) => ({ title: (n.title ?? '').trim(), body: (n.body ?? '').trim() }))
    .filter((n) => n.title || n.body);
  // The rate plan is the store on a Helm-run home; Guesty's listing on the rest.
  const checkInTime = (planRes.data as { checkin_time: string | null } | null)?.checkin_time || guestyCheckin;
  const heroPhotoUrl = ((photoRes.data ?? []) as Array<{ url: string | null }>)[0]?.url ?? null;

  const listing = findGuideListing(GUIDE, {
    guestyListingId: home.guesty_listing_id,
    formerGuestyListingId: home.former_guesty_listing_id,
    name: home.name,
  });
  const listingId =
    [home.guesty_listing_id, home.former_guesty_listing_id].find((id) => id && GUIDE.listings[id]) ?? null;

  return buildGuestApp({
    home,
    wifi,
    rooms,
    notes,
    checkInTime,
    heroPhotoUrl,
    nearby: nearbyPlaces(GUIDE, listing, { lat: home.latitude, lng: home.longitude }),
    bookAgainUrl: listingId ? `https://staycapeann.com/stays/${listingId}` : null,
    welcomeNote,
    now,
  });
}

/** The public page's read: an enabled link to a live Cape Ann home, or null (a 404). */
export async function loadGuestAppByToken(token: string, now = new Date()): Promise<{ row: GuestAppRow; app: GuestApp } | null> {
  const row = await rowByToken(token);
  if (!row || !row.enabled) return null;
  const app = await loadGuestApp(row.property_id, row.welcome_note, now);
  return app ? { row, app } : null;
}

/** Count an open. Never throws: a counter must not take the page down. */
export async function recordGuestAppOpen(token: string): Promise<void> {
  if (!isServiceConfigured || !GUEST_APP_TOKEN_RE.test(token)) return;
  try {
    await supabaseAdmin.rpc('guest_app_opened', { p_token: token });
  } catch {
    /* counted next time */
  }
}

// ── Writers (property page, staff session; the actions check the session) ──

export async function createGuestAppRow(propertyId: string, by: string): Promise<GuestAppRow> {
  const { data, error } = await supabaseAdmin
    .from('guest_app_homes')
    .upsert({ property_id: propertyId, token: newGuestAppToken(), updated_by: by }, { onConflict: 'property_id', ignoreDuplicates: true })
    .select(ROW_COLS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data as GuestAppRow;
  const existing = await getGuestAppRow(propertyId);
  if (!existing) throw new Error('Could not create the guest app link.');
  return existing;
}

export async function updateGuestAppRow(
  propertyId: string,
  patch: Partial<Pick<GuestAppRow, 'enabled' | 'welcome_note' | 'token' | 'rotated_at'>>,
  by: string,
): Promise<GuestAppRow> {
  const { data, error } = await supabaseAdmin
    .from('guest_app_homes')
    .update({ ...patch, updated_by: by, updated_at: new Date().toISOString() })
    .eq('property_id', propertyId)
    .select(ROW_COLS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('This home has no guest app link yet.');
  return data as GuestAppRow;
}
