/**
 * Sync past + upcoming Guesty guests into the Audience module.
 *
 * Strategy:
 *   1. Read all rows from `guesty_reservations` (already populated by
 *      /api/sync-guesty) since `sinceCheckOut` (default: 2 years back).
 *   2. Build the unique set of (guest_id, property_id) pairs.
 *   3. For each guest_id we haven't fetched recently, call /v1/guests/{id}
 *      to pull email + name.
 *   4. Upsert into `audience_contacts`:
 *        - email-keyed; existing rows get tag-merge + name backfill
 *        - never downgrade an existing 'subscribed' status
 *        - never override an explicit 'unsubscribed' / 'bounced' / 'complained'
 *        - tags include 'Guesty' + the property short name (e.g. '21 Horton')
 *        - proxy emails (@guest.airbnb.com, @mchat.booking.com, etc.)
 *          are imported but auto-tagged 'proxy_email' so default segments skip
 *
 * Returns a structured result for the caller to log + display.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  getGuestyToken,
  guestyGet,
  GuestyNotFound,
} from './guesty-client';
import { isProxyEmail, type GuestStatus } from './guests-types';
import { recordSyncFailure, recordSyncSuccess } from './sync-status';

let _sb: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (_sb) return _sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';
  if (!url || !key) throw new Error('Supabase env not configured');
  _sb = createClient(url, key);
  return _sb;
}

type ReservationRow = {
  guest_id: string | null;
  property_id: string | null;
  check_out: string | null;
  channel: string | null;
};

type GuestyGuest = {
  _id: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  emails?: Array<{ address?: string } | string>;
  email?: string;
};

export type GuestSyncResult = {
  reservations_scanned: number;
  unique_guests: number;
  fetched_from_guesty: number;
  contacts_with_email: number;
  inserted: number;
  updated: number;
  skipped_no_email: number;
  errors: string[];
  duration_ms: number;
};

const DEFAULT_LOOKBACK_DAYS = 730;

export async function syncGuestyGuestsToList(
  options: { sinceCheckOut?: string; maxGuests?: number } = {},
): Promise<GuestSyncResult> {
  // Wrap the whole body so /api/guests/sync-guesty (manual button) AND
  // /api/cron/guests-guesty-sync (the safety-net cron) both record a single
  // 'guesty-guests' failure when an error escapes -- without a try here it
  // bubbles to two different callers that handle 500s but don't write
  // sync_status, leaving daily-brief blind. Rethrow so callers still 500.
  try {
  const t0 = Date.now();
  const errors: string[] = [];

  const sinceIso =
    options.sinceCheckOut ??
    new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);

  // Pull reservations + property names in one shot.
  const { data: rs, error: rsErr } = await sb()
    .from('guesty_reservations')
    .select('guest_id, property_id, check_out, channel')
    .gte('check_out', sinceIso)
    .not('guest_id', 'is', null)
    .limit(10000);

  if (rsErr) throw new Error('Failed to read guesty_reservations: ' + rsErr.message);
  const reservations = (rs ?? []) as ReservationRow[];

  // Map property_id -> short name (e.g. '21 Horton'). Used as a tag.
  const propertyNames = await loadPropertyNameMap();

  // Collapse to guest_id -> set of tags they should carry. Past Guesty
  // guests are also on the insider list by default (existing relationship,
  // CAN-SPAM compliant, matches industry norm for STR repeat outreach).
  const guestPropertyTags = new Map<string, Set<string>>();
  for (const r of reservations) {
    if (!r.guest_id) continue;
    const tags = guestPropertyTags.get(r.guest_id) ?? new Set<string>();
    tags.add('insider');
    tags.add('Guesty');
    if (r.property_id && propertyNames[r.property_id]) {
      tags.add(propertyNames[r.property_id]);
    }
    if (r.channel) tags.add(r.channel); // 'Airbnb' / 'VRBO' / 'Direct'
    guestPropertyTags.set(r.guest_id, tags);
  }

  const uniqueGuestIds = Array.from(guestPropertyTags.keys());
  const cap = options.maxGuests ?? uniqueGuestIds.length;
  const guestIdsToFetch = uniqueGuestIds.slice(0, cap);

  const token = await getGuestyToken();

  let fetched = 0;
  let withEmail = 0;
  let inserted = 0;
  let updated = 0;
  let skippedNoEmail = 0;

  for (const guestId of guestIdsToFetch) {
    let guest: GuestyGuest | null = null;
    try {
      guest = await guestyGet<GuestyGuest>(`/v1/guests/${guestId}`, token);
      fetched++;
    } catch (err) {
      if (err instanceof GuestyNotFound) continue;
      errors.push(`guest ${guestId}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (!guest) continue;

    const email = extractEmail(guest);
    if (!email) {
      skippedNoEmail++;
      continue;
    }
    withEmail++;

    const tags = Array.from(guestPropertyTags.get(guestId) ?? []);
    if (isProxyEmail(email)) tags.push('proxy_email');

    const firstName = (guest.firstName || '').trim() || extractFirstFromFull(guest.fullName) || null;
    const lastName = (guest.lastName || '').trim() || extractLastFromFull(guest.fullName) || null;

    const upsertResult = await upsertContact({
      email,
      firstName,
      lastName,
      tags,
      guestyGuestId: guestId,
    });
    if (upsertResult === 'inserted') inserted++;
    else if (upsertResult === 'updated') updated++;
  }

  // Log to sync_status so /guests can show "last synced X minutes ago" AND
  // any error escaping this function lights up the daily brief.
  await recordSyncSuccess('guesty-guests', {
    reservations_scanned: reservations.length,
    unique_guests: uniqueGuestIds.length,
    fetched_from_guesty: fetched,
    contacts_with_email: withEmail,
    inserted,
    updated,
    skipped_no_email: skippedNoEmail,
    errors: errors.slice(0, 20),
  });

  // Audit event so the /guests timeline shows the import.
  await sb().from('audience_events').insert({
    event_type: 'imported',
    metadata: {
      source: 'guesty_sync',
      since_check_out: sinceIso,
      unique_guests: uniqueGuestIds.length,
      inserted,
      updated,
      with_email: withEmail,
      no_email: skippedNoEmail,
    },
  });

  return {
    reservations_scanned: reservations.length,
    unique_guests: uniqueGuestIds.length,
    fetched_from_guesty: fetched,
    contacts_with_email: withEmail,
    inserted,
    updated,
    skipped_no_email: skippedNoEmail,
    errors,
    duration_ms: Date.now() - t0,
  };
  } catch (err) {
    await recordSyncFailure('guesty-guests', err);
    throw err;
  }
}

async function loadPropertyNameMap(): Promise<Record<string, string>> {
  const { data } = await sb().from('properties').select('id, name');
  const map: Record<string, string> = {};
  for (const row of (data ?? []) as Array<{ id: string; name: string }>) {
    map[row.id] = row.name;
  }
  return map;
}

function extractEmail(g: GuestyGuest): string | null {
  if (g.email) return g.email.toLowerCase().trim();
  if (Array.isArray(g.emails)) {
    for (const e of g.emails) {
      if (typeof e === 'string' && e.includes('@')) return e.toLowerCase().trim();
      if (typeof e === 'object' && e?.address) return e.address.toLowerCase().trim();
    }
  }
  return null;
}

function extractFirstFromFull(full: string | undefined): string | null {
  if (!full) return null;
  const parts = full.trim().split(/\s+/);
  return parts[0] || null;
}

function extractLastFromFull(full: string | undefined): string | null {
  if (!full) return null;
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : null;
}

/**
 * Upsert one contact. Tag-merge instead of replace. Status policy:
 *   - existing 'subscribed' / 'pending'  → keep existing, merge tags + names
 *   - existing 'unsubscribed' / 'bounced' / 'complained' → DO NOT touch status
 *     (respect prior decision; just merge tags so segmentation stays accurate)
 *   - new contact → insert as 'subscribed'
 */
async function upsertContact(args: {
  email: string;
  firstName: string | null;
  lastName: string | null;
  tags: string[];
  guestyGuestId: string;
}): Promise<'inserted' | 'updated' | 'noop'> {
  const { email, firstName, lastName, tags, guestyGuestId } = args;

  const { data: existing } = await sb()
    .from('audience_contacts')
    .select('id, status, tags, first_name, last_name, source, source_detail, guesty_guest_id')
    .eq('email', email)
    .maybeSingle();

  if (!existing) {
    const { error } = await sb().from('audience_contacts').insert({
      email,
      first_name: firstName,
      last_name: lastName,
      status: 'subscribed' as GuestStatus,
      subscribed_at: new Date().toISOString(),
      source: 'guesty_post_stay',
      source_detail: `Guesty guest ${guestyGuestId}`,
      guesty_guest_id: guestyGuestId,
      tags,
      marketing_consent: true,
    });
    if (error) {
      console.error('[guests-guesty-sync] insert failed', email, error);
      return 'noop';
    }
    return 'inserted';
  }

  // Merge tags (dedup), backfill names if missing, never downgrade status.
  const mergedTags = Array.from(new Set([...(existing.tags ?? []), ...tags]));
  const updates: Record<string, unknown> = { tags: mergedTags };
  if (!existing.first_name && firstName) updates.first_name = firstName;
  if (!existing.last_name && lastName) updates.last_name = lastName;
  // Backfill guesty_guest_id when it wasn't set yet (Squarespace contact
  // who turned out to also be a Guesty guest, or pre-migration rows).
  if (!(existing as { guesty_guest_id?: string | null }).guesty_guest_id) {
    updates.guesty_guest_id = guestyGuestId;
  }
  // If the contact was previously imported from Squarespace and had no source
  // detail, surface that they're also a Guesty guest.
  if (!existing.source_detail || existing.source === 'manual') {
    updates.source_detail = (existing.source_detail ?? '') + (existing.source_detail ? ' · ' : '') + `Guesty guest ${guestyGuestId}`;
  }

  const { error } = await sb().from('audience_contacts').update(updates).eq('id', existing.id);
  if (error) {
    console.error('[guests-guesty-sync] update failed', email, error);
    return 'noop';
  }
  return 'updated';
}

export async function getLastGuestySyncStatus(): Promise<{
  last_synced_at: string | null;
  last_result: Record<string, unknown> | null;
}> {
  const { data } = await sb()
    .from('sync_status')
    .select('last_synced_at, last_result')
    .eq('source', 'guesty-guests')
    .maybeSingle();
  return {
    last_synced_at: data?.last_synced_at ?? null,
    last_result: (data?.last_result as Record<string, unknown> | null) ?? null,
  };
}
