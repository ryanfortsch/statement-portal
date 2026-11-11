/**
 * Which CRM contact an owner card is, so the card links to the owner's
 * Activity on /crm instead of /owner-messaging keeping its own per-owner
 * history (the Contacts block, retired in the UX audit of 2026-11-07).
 *
 * A card names its owner by `owner_contact`, a phone (SMS) or an email.
 * The match is exact: a contact holding that phone or that email. Failing
 * that, the home: the one owner contact linked to the card's property (a
 * household whose CRM row has an email and no phone still texts from its
 * phone). Two owner contacts on one home, or none, is no link, never a guess.
 *
 * Pure: no database. owner-crm-link-server.ts loads the contacts.
 */
import { normalizePhone } from './quo-lines.ts';

export type CrmContactRow = {
  id: string;
  type: string | null;
  phone: string | null;
  emails: string[] | null;
  linked_property_ids: string[] | null;
};

export type OwnerCrmDirectory = {
  /** Normalized phone or lowercased email to contact id. */
  byContact: Record<string, string>;
  /** Property id to its one owner contact. */
  byProperty: Record<string, string>;
};

export const EMPTY_OWNER_CRM_DIRECTORY: OwnerCrmDirectory = { byContact: {}, byProperty: {} };

/** A phone as ten digits, an email lowercased; '' when it is neither. */
export function ownerContactKey(raw: string | null | undefined): string {
  const v = (raw || '').trim();
  if (!v) return '';
  if (v.includes('@')) return v.toLowerCase();
  const phone = normalizePhone(v);
  return phone.length === 10 ? phone : '';
}

export function buildOwnerCrmDirectory(rows: CrmContactRow[]): OwnerCrmDirectory {
  const byContact: Record<string, string> = {};
  const claimed = new Map<string, Set<string>>();
  const claim = (key: string, id: string) => {
    if (!key) return;
    claimed.set(key, (claimed.get(key) ?? new Set()).add(id));
  };
  // Owner rows first, so an owner wins a number another row also carries.
  const ordered = [...rows].sort((a, b) => Number(b.type === 'owner') - Number(a.type === 'owner'));
  for (const r of ordered) {
    for (const key of [ownerContactKey(r.phone), ...(r.emails ?? []).map(ownerContactKey)]) {
      if (key && !(key in byContact)) byContact[key] = r.id;
    }
    if (r.type === 'owner') for (const p of r.linked_property_ids ?? []) claim(p, r.id);
  }
  const byProperty: Record<string, string> = {};
  for (const [property, ids] of claimed) if (ids.size === 1) byProperty[property] = [...ids][0];
  return { byContact, byProperty };
}

/** The `/crm/<id>` an owner card links to, or null when Helm cannot tell. */
export function ownerCrmHref(dir: OwnerCrmDirectory, ownerContact: string | null | undefined, propertyId: string | null | undefined): string | null {
  const key = ownerContactKey(ownerContact);
  const id = (key && dir.byContact[key]) || (propertyId ? dir.byProperty[propertyId] : undefined);
  return id ? `/crm/${encodeURIComponent(id)}` : null;
}
