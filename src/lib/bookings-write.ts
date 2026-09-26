/**
 * The only Helm-originated writer for `bookings`.
 *
 * Every create, move, confirm and cancel goes through the advisory-locked
 * Postgres functions from the plumbing migration (helm_create_booking,
 * helm_move_booking, helm_cancel_booking). They take one lock per property,
 * check the overlap INSIDE the lock, write the row and its booking_events
 * entry in the same transaction, and raise SQLSTATE P0002 'booking_overlap'
 * with the conflicting stay in the detail when a hold would double-book.
 * That closes every read-then-insert race the old actions had.
 *
 * What this module adds around the RPCs:
 *   - the P0002 detail becomes a typed BookingOverlapError the actions can
 *     catch and hand back to the form (conflictToSearchParams);
 *   - a Helm-minted confirmation code on direct / manual stays that arrive
 *     without one;
 *   - the guest record: upsertGuestForBooking links bookings.guest_id;
 *   - the Helm calendar mirror: after any write on a helm-run property the
 *     mirror is refreshed for just that home and window, so a hold shows up
 *     named on the Operations calendar without waiting for the cron.
 *
 * Guest-field and money-column edits have no RPC (they never move dates or
 * status), so they are the one direct UPDATE here, restricted to an
 * allowlist and paired with a booking_events row. The hard delete lives
 * here too so the artifact gate cannot be skipped: only a block, or an
 * inquiry nothing downstream has touched, is ever deleted; everything else
 * is a soft cancel with a reason.
 *
 * ical-sync keeps its own upsert: echo blocks legitimately overlap before
 * dedupe, which is the whole reason the overlap check is a function and not
 * an exclusion constraint.
 */
import 'server-only';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import type { Booking, BookingChannel, BookingSource, BookingStatus } from '@/lib/channels-types';
import { refreshMirrorForBooking, writeHelmCalendarMirror } from '@/lib/helm-calendar-mirror';
import { upsertGuestForBooking } from '@/lib/guests-identity';
import { shiftIsoDay } from '@/lib/sca-quotes-types';
import {
  mintHelmConfirmationCode,
  diffForEvent,
  parseOverlapDetail,
  isOverlapErrorCode,
  describeConflict,
  isYmd,
  pickPatch,
  GUEST_FIELD_KEYS,
  MONEY_FIELD_KEYS,
  type BookingConflict,
} from '@/lib/bookings-write-core';

export {
  conflictToSearchParams,
  conflictFromSearchParams,
  describeConflict,
  isHelmCode,
  type BookingConflict,
} from '@/lib/bookings-write-core';

// ── errors ────────────────────────────────────────────────────────────

/** The database refused a hold because another canonical stay has the nights. */
export class BookingOverlapError extends Error {
  readonly conflict: BookingConflict;
  constructor(conflict: BookingConflict) {
    super(describeConflict(conflict));
    this.name = 'BookingOverlapError';
    this.conflict = conflict;
  }
}

export function isBookingOverlapError(err: unknown): err is BookingOverlapError {
  return err instanceof BookingOverlapError || (!!err && typeof err === 'object' && (err as { name?: string }).name === 'BookingOverlapError');
}

type RpcError = { code?: string | null; message?: string; details?: string | null; hint?: string | null };

function throwRpcError(error: RpcError, what: string): never {
  if (isOverlapErrorCode(error.code)) {
    const conflict = parseOverlapDetail(error.details) ?? {
      booking_id: 'unknown',
      status: 'confirmed',
      check_in: '',
      check_out: '',
    };
    throw new BookingOverlapError(conflict);
  }
  if (error.code === 'P0001') throw new Error('Check-out must be after check-in.');
  if (error.code === 'P0003') throw new Error('Booking not found.');
  throw new Error(`${what}: ${error.message ?? 'unknown database error'}`);
}

function ensureConfigured(): void {
  if (!isServiceConfigured) throw new Error('Supabase service role is not configured; booking writes are disabled.');
}

function rowFromRpc(data: unknown, what: string): Booking {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') throw new Error(`${what}: the database returned no row`);
  return row as Booking;
}

function assertDates(checkIn: string, checkOut: string): void {
  if (!isYmd(checkIn) || !isYmd(checkOut)) throw new Error('Dates must be YYYY-MM-DD.');
  if (checkOut <= checkIn) throw new Error('Check-out must be after check-in.');
}

/** Channels whose stays Helm itself originates and therefore codes. */
const HELM_ORIGIN_CHANNELS: ReadonlySet<BookingChannel> = new Set(['direct', 'manual']);

const DEFAULT_ACTOR = 'helm@helm.system';

// ── reads the writer needs ────────────────────────────────────────────

export async function getBooking(id: string): Promise<Booking | null> {
  if (!isServiceConfigured || !id) return null;
  const { data, error } = await supabaseAdmin.from('bookings').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return data as Booking;
}

export type BookingEventRow = {
  id: string;
  booking_id: string;
  kind: string;
  actor: string;
  at: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  note: string | null;
};

/** The change log for one booking, newest first. */
export async function listBookingEvents(bookingId: string, limit = 200): Promise<BookingEventRow[]> {
  if (!isServiceConfigured || !bookingId) return [];
  const { data, error } = await supabaseAdmin
    .from('booking_events')
    .select('id, booking_id, kind, actor, at, before, after, note')
    .eq('booking_id', bookingId)
    .order('at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as BookingEventRow[];
}

async function isHelmRunProperty(propertyId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('properties')
    .select('calendar_authority')
    .eq('id', propertyId)
    .maybeSingle();
  if (error || !data) return false;
  return (data as { calendar_authority: string | null }).calendar_authority === 'helm';
}

// ── the after-write hooks ─────────────────────────────────────────────

type Window = { start: string; end: string };

function windowFor(rows: ReadonlyArray<Pick<Booking, 'check_in' | 'check_out'>>): Window | null {
  let start: string | null = null;
  let end: string | null = null;
  for (const r of rows) {
    const ci = r.check_in.slice(0, 10);
    const co = r.check_out.slice(0, 10);
    if (!start || ci < start) start = ci;
    if (!end || co > end) end = co;
  }
  if (!start || !end) return null;
  return { start: shiftIsoDay(start, -1), end };
}

/**
 * Refresh the Helm mirror for one property. Best effort: the booking is
 * already committed, so a mirror failure is logged and never surfaces to
 * the form. Guesty-run homes are skipped before any mirror code runs.
 */
async function refreshMirrorSafe(propertyId: string, bookingId: string | null, window: Window | null): Promise<void> {
  try {
    if (!(await isHelmRunProperty(propertyId))) return;
    if (window) {
      await writeHelmCalendarMirror([propertyId], window.start, window.end);
    } else if (bookingId) {
      await refreshMirrorForBooking(bookingId);
    }
  } catch (err) {
    console.warn('[bookings-write] mirror refresh failed', propertyId, err instanceof Error ? err.message : err);
  }
}

async function linkGuestSafe(row: Booking): Promise<void> {
  try {
    await upsertGuestForBooking({
      id: row.id,
      guest_name: row.guest_name,
      guest_email: row.guest_email,
      guest_phone: row.guest_phone,
      source: row.source === 'direct_booking' ? 'direct_booking' : 'helm',
    });
  } catch (err) {
    console.warn('[bookings-write] guest link failed', row.id, err instanceof Error ? err.message : err);
  }
}

// ── create ────────────────────────────────────────────────────────────

export type CreateBookingInput = {
  propertyId: string;
  channel: BookingChannel;
  source: BookingSource;
  status: BookingStatus;
  /** YYYY-MM-DD */
  checkIn: string;
  /** YYYY-MM-DD, exclusive */
  checkOut: string;
  guestName?: string | null;
  guestEmail?: string | null;
  guestPhone?: string | null;
  numGuests?: number | null;
  grossAmount?: number | null;
  cleaningFee?: number | null;
  taxes?: number | null;
  payout?: number | null;
  currency?: string | null;
  notes?: string | null;
  /** status = block only: owner | maintenance | ota | other */
  holdKind?: 'owner' | 'maintenance' | 'ota' | 'other' | null;
  /** Leave empty on a direct / manual stay and a HELM- code is minted. */
  externalConfirmationCode?: string | null;
  /** quote id, Stripe payment_intent id, SCA token */
  sourceRef?: string | null;
  /** ISO timestamp; when the guest committed. Defaults to now in the database. */
  bookedAt?: string | null;
  /** operator email | 'sca' | 'concierge' | 'book-page' */
  actor?: string | null;
  /** Only ical-sync style callers that dedupe afterwards may set this. */
  allowOverlap?: boolean;
};

function put(fields: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value === 'string' && value.trim() === '') return;
  fields[key] = value;
}

/**
 * Create a booking through helm_create_booking. Throws BookingOverlapError
 * when the status holds dates (confirmed / completed / block) and another
 * canonical hold has any of the nights; inquiry and pending never conflict.
 */
export async function createBooking(input: CreateBookingInput): Promise<Booking> {
  ensureConfigured();
  if (!input.propertyId) throw new Error('Pick a property.');
  assertDates(input.checkIn, input.checkOut);

  const fields: Record<string, unknown> = {};
  put(fields, 'guest_name', input.guestName?.trim());
  put(fields, 'guest_email', input.guestEmail?.trim().toLowerCase());
  put(fields, 'guest_phone', input.guestPhone?.trim());
  put(fields, 'num_guests', input.numGuests);
  put(fields, 'gross_amount', input.grossAmount);
  put(fields, 'cleaning_fee', input.cleaningFee);
  put(fields, 'taxes', input.taxes);
  put(fields, 'payout', input.payout);
  put(fields, 'currency', input.currency);
  put(fields, 'notes', input.notes?.trim());
  put(fields, 'source_ref', input.sourceRef);
  put(fields, 'booked_at', input.bookedAt);
  if (input.status === 'block') put(fields, 'hold_kind', input.holdKind ?? 'other');

  const code = input.externalConfirmationCode?.trim();
  if (code) fields.external_confirmation_code = code;
  else if (input.status !== 'block' && HELM_ORIGIN_CHANNELS.has(input.channel)) {
    fields.external_confirmation_code = mintHelmConfirmationCode();
  }

  const actor = input.actor?.trim() || DEFAULT_ACTOR;
  const { data, error } = await supabaseAdmin.rpc('helm_create_booking', {
    p_property_id: input.propertyId,
    p_channel: input.channel,
    p_source: input.source,
    p_status: input.status,
    p_check_in: input.checkIn,
    p_check_out: input.checkOut,
    p_fields: fields,
    p_actor: actor,
    p_allow_overlap: !!input.allowOverlap,
  });
  if (error) throwRpcError(error, 'create booking');
  const row = rowFromRpc(data, 'create booking');

  if (row.status !== 'block') await linkGuestSafe(row);
  await refreshMirrorSafe(row.property_id, row.id, null);
  return row;
}

export type CreateBlockInput = {
  propertyId: string;
  checkIn: string;
  checkOut: string;
  holdKind?: 'owner' | 'maintenance' | 'ota' | 'other' | null;
  note?: string | null;
  createdBy?: string | null;
};

/** An owner stay, a maintenance window, anything that should hold the nights. */
export async function createBlock(input: CreateBlockInput): Promise<Booking> {
  return createBooking({
    propertyId: input.propertyId,
    channel: 'block',
    source: 'manual',
    status: 'block',
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    holdKind: input.holdKind ?? 'other',
    notes: input.note,
    actor: input.createdBy,
  });
}

// ── move / confirm / cancel ───────────────────────────────────────────

export type MoveBookingInput = {
  checkIn: string;
  checkOut: string;
  status: BookingStatus;
};

/**
 * Change dates and / or status through helm_move_booking. The mirror is
 * refreshed over the union of the old and new nights so a hold that moved
 * away from a week does not linger there until the cron.
 */
export async function moveBooking(
  id: string,
  input: MoveBookingInput,
  actor: string,
  opts: { allowOverlap?: boolean } = {},
): Promise<Booking> {
  ensureConfigured();
  if (!id) throw new Error('Missing booking id.');
  assertDates(input.checkIn, input.checkOut);
  const before = await getBooking(id);
  if (!before) throw new Error('Booking not found.');

  const { data, error } = await supabaseAdmin.rpc('helm_move_booking', {
    p_booking_id: id,
    p_check_in: input.checkIn,
    p_check_out: input.checkOut,
    p_status: input.status,
    p_actor: actor?.trim() || DEFAULT_ACTOR,
    p_allow_overlap: !!opts.allowOverlap,
  });
  if (error) throwRpcError(error, 'move booking');
  const row = rowFromRpc(data, 'move booking');

  await refreshMirrorSafe(row.property_id, row.id, windowFor([before, row]));
  return row;
}

/** Promote an inquiry or pending booking to confirmed on its own dates. */
export async function confirmInquiry(id: string, actor: string): Promise<Booking> {
  ensureConfigured();
  const before = await getBooking(id);
  if (!before) throw new Error('Booking not found.');
  if (before.status === 'confirmed') return before;
  if (before.status !== 'inquiry' && before.status !== 'pending') {
    throw new Error(`Only an inquiry or a pending booking can be confirmed (this one is ${before.status}).`);
  }
  return moveBooking(id, { checkIn: before.check_in, checkOut: before.check_out, status: 'confirmed' }, actor);
}

/** Soft cancel with a reason; scheduled automation sends are cancelled with it. */
export async function cancelBooking(id: string, input: { reason?: string | null; actor: string }): Promise<Booking> {
  ensureConfigured();
  if (!id) throw new Error('Missing booking id.');
  const { data, error } = await supabaseAdmin.rpc('helm_cancel_booking', {
    p_booking_id: id,
    p_reason: input.reason?.trim() || null,
    p_actor: input.actor?.trim() || DEFAULT_ACTOR,
  });
  if (error) throwRpcError(error, 'cancel booking');
  const row = rowFromRpc(data, 'cancel booking');
  await refreshMirrorSafe(row.property_id, row.id, null);
  return row;
}

// ── field edits (no RPC: they never move dates or status) ─────────────

export type GuestFieldsPatch = {
  guest_name?: string | null;
  guest_email?: string | null;
  guest_phone?: string | null;
  num_guests?: number | string | null;
  notes?: string | null;
};

function toIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function toMoneyOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim().replace(/[$,]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

async function patchColumns(
  id: string,
  before: Booking,
  patch: Record<string, unknown>,
  kind: 'guest_changed' | 'money_changed',
  actor: string,
): Promise<Booking> {
  const diff = diffForEvent(before as unknown as Record<string, unknown>, patch, Object.keys(patch));
  if (diff.changed.length === 0) return before;

  const { data, error } = await supabaseAdmin
    .from('bookings')
    .update({ ...diff.after, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`update booking: ${error.message}`);
  const row = (data ?? { ...before, ...diff.after }) as Booking;

  const { error: evErr } = await supabaseAdmin.from('booking_events').insert({
    booking_id: id,
    kind,
    actor: actor?.trim() || DEFAULT_ACTOR,
    before: diff.before,
    after: diff.after,
  });
  if (evErr) console.warn('[bookings-write] booking_events insert failed', id, evErr.message);
  return row;
}

/**
 * Edit who is staying: name, email, phone, party size, notes. Writes a
 * 'guest_changed' event with only the changed keys and re-links the guest
 * record when an identity field moved.
 */
export async function updateGuestFields(id: string, patch: GuestFieldsPatch, actor: string): Promise<Booking> {
  ensureConfigured();
  if (!id) throw new Error('Missing booking id.');
  const before = await getBooking(id);
  if (!before) throw new Error('Booking not found.');

  const picked = pickPatch(patch as Record<string, unknown>, GUEST_FIELD_KEYS) as Record<string, unknown>;
  if ('num_guests' in picked) picked.num_guests = toIntOrNull(picked.num_guests);
  if (typeof picked.guest_email === 'string') picked.guest_email = picked.guest_email.trim().toLowerCase() || null;
  if (typeof picked.guest_name === 'string') picked.guest_name = picked.guest_name.trim() || null;
  if (typeof picked.guest_phone === 'string') picked.guest_phone = picked.guest_phone.trim() || null;
  if (typeof picked.notes === 'string') picked.notes = picked.notes.trim() || null;

  const row = await patchColumns(id, before, picked, 'guest_changed', actor);
  if (row !== before && row.status !== 'block') {
    const identityMoved =
      row.guest_email !== before.guest_email || row.guest_phone !== before.guest_phone || row.guest_name !== before.guest_name;
    if (identityMoved) await linkGuestSafe(row);
  }
  return row;
}

export type MoneyFieldsPatch = {
  gross_amount?: number | string | null;
  cleaning_fee?: number | string | null;
  taxes?: number | string | null;
  payout?: number | string | null;
};

/**
 * Edit the money columns on the bookings row itself (what the guest paid,
 * cleaning, taxes, payout as typed by the operator). Writes 'money_changed'.
 * This is bookkeeping on the booking record; nothing in the statements
 * pipeline reads these columns, and booking_finance is written separately
 * by booking-finance-write.ts.
 */
export async function updateBookingMoney(id: string, patch: MoneyFieldsPatch, actor: string): Promise<Booking> {
  ensureConfigured();
  if (!id) throw new Error('Missing booking id.');
  const before = await getBooking(id);
  if (!before) throw new Error('Booking not found.');
  const picked = pickPatch(patch as Record<string, unknown>, MONEY_FIELD_KEYS) as Record<string, unknown>;
  for (const k of Object.keys(picked)) picked[k] = toMoneyOrNull(picked[k]);
  return patchColumns(id, before, picked, 'money_changed', actor);
}

// ── delete, gated ─────────────────────────────────────────────────────

/**
 * Tables whose rows are what a stay generated. A booking with any of these
 * is history, not a typo, and is cancelled rather than deleted.
 */
export const DOWNSTREAM_ARTIFACT_TABLES = [
  'automation_sends',
  'guest_threads',
  'reviews',
  'inspection_plans',
  'booking_finance',
  'guest_access_codes',
  'packet_stops',
] as const;

export type DownstreamArtifacts = {
  total: number;
  byTable: Record<string, number>;
  /** Tables whose read failed. Any entry here blocks a hard delete. */
  unknown: string[];
};

export async function countDownstreamArtifacts(bookingId: string): Promise<DownstreamArtifacts> {
  const out: DownstreamArtifacts = { total: 0, byTable: {}, unknown: [] };
  if (!isServiceConfigured || !bookingId) {
    out.unknown.push(...DOWNSTREAM_ARTIFACT_TABLES);
    return out;
  }
  const results = await Promise.all(
    DOWNSTREAM_ARTIFACT_TABLES.map(async (table) => {
      const { count, error } = await supabaseAdmin
        .from(table)
        .select('booking_id', { count: 'exact', head: true })
        .eq('booking_id', bookingId);
      return { table, count: error ? null : (count ?? 0) };
    }),
  );
  for (const r of results) {
    if (r.count === null) {
      out.unknown.push(r.table);
      continue;
    }
    out.byTable[r.table] = r.count;
    out.total += r.count;
  }
  return out;
}

export type DeleteOutcome = {
  outcome: 'deleted' | 'cancelled';
  booking: Booking;
  /** Why a cancel happened instead of a delete. */
  reason?: string;
  artifacts?: DownstreamArtifacts;
};

/**
 * The operator's Delete button. A block is deleted outright (it is a hold,
 * not history). An inquiry is deleted only when nothing downstream has been
 * generated from it and every artifact table could be read. Everything else,
 * and any inquiry with artifacts, becomes a soft cancel with a reason, so a
 * stay that produced a turnover, a PIN or a thread never vanishes from the
 * record.
 */
export async function deleteOrCancelBooking(id: string, actor: string): Promise<DeleteOutcome> {
  ensureConfigured();
  if (!id) throw new Error('Missing booking id.');
  const before = await getBooking(id);
  if (!before) throw new Error('Booking not found.');

  let deletable = false;
  let artifacts: DownstreamArtifacts | undefined;
  let reason = '';
  if (before.status === 'block') {
    deletable = true;
  } else if (before.status === 'inquiry') {
    artifacts = await countDownstreamArtifacts(id);
    deletable = artifacts.total === 0 && artifacts.unknown.length === 0;
    if (!deletable) {
      reason =
        artifacts.total > 0
          ? `kept as cancelled: ${artifacts.total} downstream ${artifacts.total === 1 ? 'artifact' : 'artifacts'} (${Object.entries(artifacts.byTable)
              .filter(([, n]) => n > 0)
              .map(([t, n]) => `${t} ${n}`)
              .join(', ')})`
          : `kept as cancelled: could not verify ${artifacts.unknown.join(', ')}`;
    }
  } else {
    reason = `kept as cancelled: a ${before.status} booking is history, not a typo`;
  }

  if (deletable) {
    const { error } = await supabaseAdmin.from('bookings').delete().eq('id', id);
    if (error) throw new Error(`delete booking: ${error.message}`);
    if (before.status === 'block') await refreshMirrorSafe(before.property_id, null, windowFor([before]));
    return { outcome: 'deleted', booking: before, artifacts };
  }

  const booking = before.status === 'cancelled'
    ? before
    : await cancelBooking(id, { reason: `operator_delete: ${reason}`, actor });
  return { outcome: 'cancelled', booking, reason, artifacts };
}
