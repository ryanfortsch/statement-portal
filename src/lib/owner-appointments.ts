import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { etDateOf } from '@/lib/vendor-visit-dates';
import { ACTIVE_WORK_SLIP_STATUSES } from '@/lib/work-types';
import {
  appointmentKey,
  appointmentRow,
  checkOwnerAppointment,
  pickOwnerContact,
  type OwnerAppointment,
  type OwnerContactPick,
} from '@/lib/owner-appointments-core';

/**
 * Files an appointment an owner booked at the house (2026-10-23) as an
 * important contact_meetings row on the owner's CRM contact, so the
 * evening-before text and the home feed's Meetings card carry it. When a
 * work slip was filed beside it, the slip takes the appointment's date
 * (only a slip with no date yet: a date someone set by hand stays).
 *
 * Refusals are answers, not outages: an unknown or retired home is 404, a
 * home with no owner contact in the CRM is 422 with what to do about it.
 * The concierge parks those for a person and retries only on a real error.
 */

const CONCIERGE_BOT_EMAIL = 'concierge@helm.system';

export type OwnerAppointmentFileResult =
  | {
      ok: true;
      id: string | null;
      contact_id: string | null;
      status: 'filed' | 'already_filed' | 'past';
      slip_dated: boolean;
    }
  | { ok: false; error: string; status: 400 | 404 | 422 | 500 };

export async function fileOwnerAppointment(
  db: SupabaseClient,
  a: OwnerAppointment,
  now: Date = new Date(),
): Promise<OwnerAppointmentFileResult> {
  const bad = checkOwnerAppointment(a);
  if (bad) return { ok: false, error: bad, status: 400 };
  const today = etDateOf(now);
  // The day is over: nothing to remind anyone of.
  if (a.date < today) return { ok: true, id: null, contact_id: null, status: 'past', slip_dated: false };

  const { data: home, error: homeErr } = await db
    .from('properties')
    .select('id, name, is_active, owner_emails')
    .eq('id', a.propertyId)
    .maybeSingle();
  if (homeErr) return { ok: false, error: `properties: ${homeErr.message}`, status: 500 };
  const house = home as { id: string; name: string | null; is_active?: boolean; owner_emails?: string[] | null } | null;
  if (!house || !house.is_active) return { ok: false, error: `no active home ${a.propertyId}`, status: 404 };
  const propertyName = house.name || a.propertyId;

  const { data: contacts, error: contactsErr } = await db
    .from('contacts')
    .select('id, name, type, linked_property_ids, emails, phone')
    .eq('type', 'owner');
  if (contactsErr) return { ok: false, error: `contacts: ${contactsErr.message}`, status: 500 };
  const contact = pickOwnerContact((contacts ?? []) as OwnerContactPick[], a.propertyId, house.owner_emails, a.ownerContact);
  if (!contact) {
    return {
      ok: false,
      error: `no owner contact in the CRM for ${propertyName}; add or link the owner on /crm, then approve the card again`,
      status: 422,
    };
  }

  const row = appointmentRow(a, contact.id, propertyName, CONCIERGE_BOT_EMAIL);
  const { data, error } = await db
    .from('contact_meetings')
    .upsert(row, { onConflict: 'source_key', ignoreDuplicates: true })
    .select('id');
  if (error) return { ok: false, error: `contact_meetings: ${error.message}`, status: 500 };
  let id: string | null = ((data ?? []) as Array<{ id: string }>)[0]?.id ?? null;
  let status: 'filed' | 'already_filed' = 'filed';
  if (!id) {
    // Already on the calendar (an approve and an auto-close both reach
    // here): one row, whoever files it.
    const { data: existing } = await db
      .from('contact_meetings')
      .select('id')
      .eq('source_key', appointmentKey(a.cardId, a.date))
      .maybeSingle();
    id = (existing as { id?: string } | null)?.id ?? null;
    status = 'already_filed';
  }

  let slipDated = false;
  if (a.slipRequestKey) {
    const { data: slips } = await db
      .from('work_slips')
      .update({ scheduled_date: a.date })
      .eq('from_guest_request_key', a.slipRequestKey)
      .is('scheduled_date', null)
      .in('status', ACTIVE_WORK_SLIP_STATUSES)
      .select('id');
    slipDated = ((slips ?? []) as Array<{ id: string }>).length > 0;
  }

  return { ok: true, id, contact_id: contact.id, status, slip_dated: slipDated };
}
