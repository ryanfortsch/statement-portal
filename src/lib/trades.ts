/**
 * Trades: the outside vendors we hire when something breaks.
 *
 * A separate population from `contractors` (the 1099 Field portal roster:
 * our own inspectors, handymen and creative crew, who claim packets and
 * hold portal tokens) and from `contacts` (the CRM's owners/leads). A
 * trade vendor is a COMPANY we call -- a plumber, an electrician, an
 * appliance tech, an exterminator. They never claim a packet; they get
 * dispatched, and what matters about them is the number, whether they
 * take after-hours calls, and whether we call them first or second.
 *
 * The category list here is the source of truth for the taxonomy. The
 * table stores category as plain text with no check constraint on
 * purpose: adding a trade is a one-file change (same ethos as adding a
 * cleaning vendor to bank-charges.ts), and any value not in this list
 * renders under "Other" rather than breaking a page.
 */

export type TradeStanding = 'primary' | 'backup' | 'trial' | 'do_not_use';

export type TradeVendorRow = {
  id: string;
  name: string;
  contact_name: string | null;
  category: string;
  standing: TradeStanding;
  emergency: boolean;
  phone: string | null;
  after_hours_phone: string | null;
  email: string | null;
  website: string | null;
  service_area: string | null;
  rate_note: string | null;
  account_number: string | null;
  license_number: string | null;
  insured: boolean | null;
  coi_expires_on: string | null;
  w9_on_file: boolean;
  property_ids: string[];
  notes: string | null;
  last_used_on: string | null;
  archived_at: string | null;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * The trades, in the order the page renders them: break-fix first (what
 * you reach for at 9 PM), then the scheduled and seasonal work, then the
 * building trades, then the recurring services. `other` always sorts last.
 */
export const TRADE_CATEGORIES: { id: string; label: string }[] = [
  // Break-fix -- the emergency end of the list
  { id: 'plumbing',       label: 'Plumbing' },
  { id: 'electrical',     label: 'Electrical' },
  { id: 'hvac',           label: 'Heating & cooling' },
  { id: 'appliance',      label: 'Appliance repair' },
  { id: 'handyman',       label: 'Handyman' },
  { id: 'locksmith',      label: 'Locks & keys' },
  { id: 'restoration',    label: 'Water, fire & mold' },
  // Recurring service
  { id: 'pest',           label: 'Pest control' },
  { id: 'cleaning',       label: 'Cleaning' },
  { id: 'linen_laundry',  label: 'Linen & laundry' },
  { id: 'landscaping',    label: 'Landscaping' },
  { id: 'snow',           label: 'Snow & ice' },
  { id: 'tree',           label: 'Tree work' },
  { id: 'waste',          label: 'Trash & hauling' },
  { id: 'pool_spa',       label: 'Pool & hot tub' },
  { id: 'septic_water',   label: 'Septic & well' },
  { id: 'oil_propane',    label: 'Oil & propane' },
  { id: 'chimney',        label: 'Chimney & fireplace' },
  // Building trades
  { id: 'carpentry',      label: 'Carpentry' },
  { id: 'roofing',        label: 'Roofing & gutters' },
  { id: 'masonry',        label: 'Masonry & paving' },
  { id: 'painting',       label: 'Painting' },
  { id: 'flooring',       label: 'Flooring & tile' },
  { id: 'windows_doors',  label: 'Windows & doors' },
  // Systems
  { id: 'internet_av',    label: 'Internet & AV' },
  { id: 'alarm_security', label: 'Alarm & cameras' },
  { id: 'inspection_permit', label: 'Inspections & permits' },
  { id: 'other',          label: 'Other' },
];

const CATEGORY_LABELS = new Map(TRADE_CATEGORIES.map((c) => [c.id, c.label]));

/** Label for a stored category, falling back to the raw value so a
 *  hand-entered trade still reads as itself rather than as "Other". */
export function categoryLabel(id: string): string {
  return CATEGORY_LABELS.get(id) ?? id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** Render order for a stored category. Unknown values sort just before
 *  "Other" so a hand-entered trade still gets its own section. */
export function categoryRank(id: string): number {
  const i = TRADE_CATEGORIES.findIndex((c) => c.id === id);
  return i === -1 ? TRADE_CATEGORIES.length - 0.5 : i;
}

export const STANDING_ORDER: TradeStanding[] = ['primary', 'backup', 'trial', 'do_not_use'];

export const STANDING_META: Record<TradeStanding, { label: string; tint: string; bg: string }> = {
  primary:    { label: 'First call', tint: 'var(--positive)',  bg: 'rgba(46,125,79,0.10)' },
  backup:     { label: 'Backup',     tint: 'var(--ink-4)',     bg: 'transparent' },
  trial:      { label: 'Trying out', tint: '#7a5512',          bg: 'rgba(154,106,30,0.10)' },
  do_not_use: { label: 'Do not use', tint: '#c0392b',          bg: 'rgba(192,57,43,0.08)' },
};

export function parseStanding(v: string | null | undefined): TradeStanding {
  return v === 'primary' || v === 'trial' || v === 'do_not_use' ? v : 'backup';
}

/** Sort within a category: who we call first, then alphabetical. */
export function compareVendors(a: TradeVendorRow, b: TradeVendorRow): number {
  const s = STANDING_ORDER.indexOf(a.standing) - STANDING_ORDER.indexOf(b.standing);
  if (s !== 0) return s;
  return a.name.localeCompare(b.name);
}

/** Group a flat list into render-ordered category sections. */
export function byCategory(vendors: TradeVendorRow[]): { id: string; label: string; vendors: TradeVendorRow[] }[] {
  const groups = new Map<string, TradeVendorRow[]>();
  for (const v of vendors) {
    const list = groups.get(v.category);
    if (list) list.push(v);
    else groups.set(v.category, [v]);
  }
  return [...groups.entries()]
    .sort((a, b) => categoryRank(a[0]) - categoryRank(b[0]))
    .map(([id, list]) => ({ id, label: categoryLabel(id), vendors: [...list].sort(compareVendors) }));
}

/** Digits-only href target for tel:/sms: links. Null when there's no number. */
export function dialable(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^+\d]/g, '');
  return digits.length >= 7 ? digits : null;
}

/** "(978) 949-1399" from any of the shapes people type. Anything that
 *  isn't a plain 10-digit US number is left exactly as entered. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const d = phone.replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d.startsWith('1')) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return phone;
}

/** Days until a certificate of insurance lapses; null when none is on
 *  file. Negative means it already has. */
export function coiDaysLeft(coiExpiresOn: string | null, today = new Date()): number | null {
  if (!coiExpiresOn) return null;
  const exp = new Date(`${coiExpiresOn}T00:00:00`);
  if (Number.isNaN(exp.getTime())) return null;
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((exp.getTime() - t.getTime()) / 86_400_000);
}

/** True when the COI is gone or goes within the month -- the one date on
 *  a vendor card worth surfacing on its own. */
export function coiAtRisk(coiExpiresOn: string | null, today = new Date()): boolean {
  const d = coiDaysLeft(coiExpiresOn, today);
  return d !== null && d <= 30;
}
