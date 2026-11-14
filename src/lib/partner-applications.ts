/**
 * A host applies to list their home on staycapeann.com at /host/apply, and
 * an owner adds the home or declines it on /guests/requests.
 *
 * The application is the host's word about the home: who they are, the
 * street and town, the bedrooms, where it is listed now, and who runs it day
 * to day (the owner, or a management company). It lists nothing and sends
 * nothing. Add makes the home through the same writer as Add a partner home
 * (createPartnerHome in partner-listing-db.ts): a partner home, off the site,
 * with the applicant as its host. Decline records why, for the office only.
 * Either way the office writes to the host itself.
 *
 * Who runs the home matters later: a home a management company runs is never
 * offered our full management (partner-host-services.ts), so the answer is
 * kept and shown.
 *
 * The words a host reads are Stay Cape Ann's: the form is on the guest site.
 *
 * PURE MODULE: no env, no database, no server-only imports.
 */
import { parseNewPartnerHome, type NewPartnerHome } from './partner-listing.ts';

export const LISTED_ON = [
  { key: 'airbnb', label: 'Airbnb' },
  { key: 'vrbo', label: 'Vrbo' },
  { key: 'booking', label: 'Booking.com' },
  { key: 'own_site', label: 'Its own website' },
  { key: 'not_yet', label: 'Not listed yet' },
] as const;

export type ListedOnKey = (typeof LISTED_ON)[number]['key'];

export const RUN_BY = {
  self: 'The owner runs it',
  manager: 'A management company runs it',
} as const;

export type RunBy = keyof typeof RUN_BY;

export const APPLICATION_LIMITS = { name: 120, email: 200, address: 120, city: 60, note: 1000, reason: 500, bedrooms: 20 } as const;

export type PartnerApplication = {
  name: string;
  email: string;
  phone: string | null;
  address: string;
  city: string;
  bedrooms: number | null;
  listed_on: ListedOnKey[];
  run_by: RunBy;
  note: string | null;
};

export type ApplicationStatus = 'new' | 'added' | 'declined';

export type ApplicationRow = PartnerApplication & {
  id: string;
  created_at: string;
  status: ApplicationStatus;
  property_id: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decline_reason: string | null;
};

export const APPLICATION_COLS =
  'id, created_at, name, email, phone, address, city, bedrooms, listed_on, run_by, note, status, property_id, decided_at, decided_by, decline_reason';

/** What the host reads once it is in, the same whether or not they applied before. */
export const APPLICATION_RECEIVED = 'Thank you. We read every application and will write back by email.';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[+\d][\d\s().-]{6,24}$/;

function line(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
}

export function isListedOn(v: unknown): v is ListedOnKey {
  return typeof v === 'string' && LISTED_ON.some((o) => o.key === v);
}

export function isRunBy(v: unknown): v is RunBy {
  return v === 'self' || v === 'manager';
}

/** The form, checked. Every refusal is a sentence the host reads on the site. */
export function parsePartnerApplication(raw: unknown): { ok: true; value: PartnerApplication } | { ok: false; reason: string } {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = line(b.name);
  const email = line(b.email).toLowerCase();
  const phone = line(b.phone);
  const address = line(b.address).replace(/,.*$/, '').trim();
  const city = line(b.city);
  if (!name || name.length > APPLICATION_LIMITS.name) return { ok: false, reason: 'Add your name.' };
  if (!EMAIL.test(email) || email.length > APPLICATION_LIMITS.email) return { ok: false, reason: 'Add the email we should write to.' };
  if (phone && !PHONE.test(phone)) return { ok: false, reason: 'That phone number does not look right.' };
  if (!/^\d+[A-Za-z]?\s+\S/.test(address)) return { ok: false, reason: 'The street address starts with the house number, like 12 Main Street.' };
  if (address.length > APPLICATION_LIMITS.address) return { ok: false, reason: 'That street address is too long.' };
  if (!city || city.length > APPLICATION_LIMITS.city) return { ok: false, reason: 'Add the town.' };

  let bedrooms: number | null = null;
  const rawBeds = typeof b.bedrooms === 'number' ? String(b.bedrooms) : line(b.bedrooms);
  if (rawBeds) {
    if (!/^\d{1,2}$/.test(rawBeds) || Number(rawBeds) > APPLICATION_LIMITS.bedrooms) return { ok: false, reason: 'Bedrooms is a number, like 3.' };
    bedrooms = Number(rawBeds);
  }

  const picked = Array.isArray(b.listed_on) ? b.listed_on : [];
  let listedOn = LISTED_ON.map((o) => o.key).filter((k) => picked.includes(k));
  // Listed somewhere and "not listed yet" cannot both be true; the channels win.
  if (listedOn.length > 1) listedOn = listedOn.filter((k) => k !== 'not_yet');

  if (!isRunBy(b.run_by)) return { ok: false, reason: 'Say who runs the home day to day.' };

  const note = typeof b.note === 'string' ? b.note.replace(/\r\n?/g, '\n').trim() : '';
  if (note.length > APPLICATION_LIMITS.note) return { ok: false, reason: `Keep the note under ${APPLICATION_LIMITS.note} characters.` };

  return {
    ok: true,
    value: { name, email, phone: phone || null, address, city, bedrooms, listed_on: listedOn, run_by: b.run_by, note: note || null },
  };
}

/** An application as the home Add a partner home makes, checked by the same rules. */
export function homeFromApplication(app: Pick<PartnerApplication, 'name' | 'email' | 'phone' | 'address' | 'city'>): { ok: true; home: NewPartnerHome } | { ok: false; error: string } {
  return parseNewPartnerHome({ address: app.address, city: app.city, host_name: app.name, host_email: app.email, host_phone: app.phone ?? '' });
}

/** "Airbnb, Vrbo" or "Not listed yet", for the office's row. */
export function listedOnLine(keys: ReadonlyArray<string>): string {
  const labels = LISTED_ON.filter((o) => keys.includes(o.key)).map((o) => o.label);
  return labels.length ? labels.join(', ') : 'Did not say where it is listed';
}

/** The decline reason, for the office only. Optional. */
export function parseDeclineReason(raw: unknown): { ok: true; value: string | null } | { ok: false; reason: string } {
  const text = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (text.length > APPLICATION_LIMITS.reason) return { ok: false, reason: `Keep the reason under ${APPLICATION_LIMITS.reason} characters.` };
  return { ok: true, value: text || null };
}

/** The owners' home feed line: who applied and nothing about them but the town. */
export function applicationQueueCard(waiting: ReadonlyArray<{ city: string }>): { href: string; text: string } | null {
  if (waiting.length === 0) return null;
  const href = '/guests/requests#applications';
  if (waiting.length === 1) return { href, text: `A host applied to list a home in ${waiting[0].city}` };
  return { href, text: `${waiting.length} hosts applied to list a home` };
}
