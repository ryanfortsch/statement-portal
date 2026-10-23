/**
 * An appointment an owner booked at the house, filed from their message
 * (2026-10-23). The pure half: what the concierge must send, the key that
 * makes a second filing a no-op, which CRM contact it lands on, and the
 * meeting row it becomes. The write is in owner-appointments.ts.
 *
 * Laila Rocha, 3 Windward: "Just made an appointment for the inspection on
 * November 6th (Friday). The window they gave me is 9:30-12. We can give
 * them a call the morning of, between 8:30-9:15am. Phone number
 * 978-325-5210 Reference RRST-26-307." The approved reply promised someone
 * there and a call ahead. What filed was a work slip with no date, and
 * nothing would have texted anyone on the 5th or the 6th. Dotti: "what
 * happens with this notification i need to get that morning or night
 * before?"
 *
 * The appointment becomes a contact_meetings row (kind 'appointment') on the
 * owner's CRM contact, marked important, so the rail that already exists
 * carries it: the 5 PM ET text the evening before, and the Meetings card on
 * the home feed the day of. The work slip filed beside it takes the same
 * date.
 */

import { formatMeetingTime } from './meetings-core.ts';

export type OwnerAppointment = {
  /** The owner card it came from; one appointment per card and day. */
  cardId: string;
  propertyId: string;
  /** The day, YYYY-MM-DD, Eastern. */
  date: string;
  /** HH:MM, when the owner gave a time; the end of the window if one. */
  startTime: string | null;
  endTime: string | null;
  /** The appointment itself: "City of Gloucester safety inspection". */
  what: string;
  /** Who is coming: "city building and fire inspectors". */
  who: string;
  /** What we must do, numbers copied as written: the call-ahead, a reference. */
  instructions: string;
  ownerName: string;
  /** Phone or email the owner wrote from. */
  ownerContact: string;
  channel: 'sms' | 'email' | null;
  message: string;
  messageAt: string;
  /** The work slip's request key, when one was filed beside it, so the slip
   *  can take the appointment's date. */
  slipRequestKey: string | null;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Why an appointment cannot be filed at all, or null. */
export function checkOwnerAppointment(a: Partial<OwnerAppointment>): string | null {
  if (!a.cardId || !String(a.cardId).trim()) return 'card_id is required';
  if (!a.propertyId || !String(a.propertyId).trim()) return 'property_id is required';
  if (!a.date || !YMD.test(a.date)) return 'date must be YYYY-MM-DD';
  if (a.startTime && !HHMM.test(a.startTime)) return 'start_time must be HH:MM';
  if (a.endTime && !HHMM.test(a.endTime)) return 'end_time must be HH:MM';
  if (!a.what || !String(a.what).trim()) return 'what is required';
  if (!a.message || !String(a.message).trim()) return 'message is required';
  return null;
}

/** The key that makes filing an appointment twice a no-op. */
export function appointmentKey(cardId: string, date: string): string {
  return `ownerappt:${cardId}:${date}`;
}

export type OwnerContactPick = {
  id: string;
  name: string;
  type: string;
  linked_property_ids: string[] | null;
  emails: string[] | null;
  phone: string | null;
};

const digits = (v: string | null | undefined): string => (v ?? '').replace(/\D/g, '');
const lower = (v: string | null | undefined): string => (v ?? '').trim().toLowerCase();

/**
 * The CRM contact the appointment lands on. In order: the owner contact
 * linked to the home; the owner contact sharing an address with the home's
 * statement emails (3 Windward's owners are linked to 73 Rocky Neck only,
 * but both homes carry their addresses); the contact the owner wrote from.
 * Null when none, which is a refusal the operator settles, never a guess.
 */
export function pickOwnerContact(
  contacts: OwnerContactPick[],
  propertyId: string,
  propertyOwnerEmails: string[] | null | undefined,
  ownerContact: string,
): OwnerContactPick | null {
  const owners = contacts.filter((c) => c.type === 'owner');
  const linked = owners.find((c) => (c.linked_property_ids ?? []).includes(propertyId));
  if (linked) return linked;
  const homeEmails = new Set((propertyOwnerEmails ?? []).map(lower).filter(Boolean));
  if (homeEmails.size > 0) {
    const shared = owners.find((c) => (c.emails ?? []).some((e) => homeEmails.has(lower(e))));
    if (shared) return shared;
  }
  const wrote = lower(ownerContact);
  if (wrote.includes('@')) {
    return owners.find((c) => (c.emails ?? []).some((e) => lower(e) === wrote)) ?? null;
  }
  const wroteDigits = digits(wrote);
  if (wroteDigits.length >= 10) {
    const tail = wroteDigits.slice(-10);
    return owners.find((c) => digits(c.phone).endsWith(tail)) ?? null;
  }
  return null;
}

/** The notes line: who is coming, the window, then what we must do. */
export function appointmentNotes(a: Pick<OwnerAppointment, 'who' | 'startTime' | 'endTime' | 'instructions'>): string | null {
  const parts: string[] = [];
  const who = (a.who || '').trim();
  if (who) parts.push(who.charAt(0).toUpperCase() + who.slice(1) + (/[.!?]$/.test(who) ? '' : '.'));
  if (a.startTime && a.endTime && a.endTime !== a.startTime) {
    parts.push(`Window ${formatMeetingTime(a.startTime)} to ${formatMeetingTime(a.endTime)}.`);
  }
  const instructions = (a.instructions || '').trim();
  if (instructions) parts.push(/[.!?]$/.test(instructions) ? instructions : `${instructions}.`);
  return parts.length ? parts.join(' ') : null;
}

/** The contact_meetings row. Important always: the evening-before text is
 *  the whole point. The location is the home; the title is the appointment. */
export function appointmentRow(
  a: OwnerAppointment,
  contactId: string,
  propertyName: string,
  createdBy: string,
): Record<string, unknown> {
  return {
    contact_id: contactId,
    property_id: a.propertyId,
    kind: 'appointment',
    source_key: appointmentKey(a.cardId, a.date),
    title: a.what.trim().slice(0, 160),
    meeting_date: a.date,
    meeting_time: a.startTime || null,
    location: propertyName,
    notes: appointmentNotes(a),
    important: true,
    created_by_email: createdBy,
  };
}
