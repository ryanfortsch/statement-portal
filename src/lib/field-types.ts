/**
 * Shared types for the Field module (external contractor portal).
 * Mirrors the schema in 20260620_field_contractor_portal.sql.
 */

export type ContractorStatus = 'invited' | 'onboarding' | 'active' | 'paused' | 'archived';
export type ContractorTrade = 'inspection' | 'maintenance' | 'cleaning';

export type PacketStatus =
  | 'draft'
  | 'published'
  | 'claimed'
  | 'in_progress'
  | 'submitted'
  | 'approved'
  | 'cancelled';

export type WindowBasis = 'checkout_day' | 'vacant' | 'pre_checkin';
export type StopStatus = 'pending' | 'in_progress' | 'complete' | 'skipped';

export type ContractorRow = {
  id: string;
  full_name: string;
  company: string | null;
  email: string;
  phone: string | null;
  trade: ContractorTrade;
  status: ContractorStatus;
  portal_token: string;
  token_expires_at: string | null;
  w9_on_file: boolean;
  agreement_signed_at: string | null;
  agreement_signed_name: string | null;
  agreement_ip: string | null;
  agreement_user_agent: string | null;
  home_lat: number | null;
  home_lng: number | null;
  service_radius_miles: number;
  vendor_key: string | null;
  invited_by_email: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

/** True once the contractor has cleared onboarding and may claim paid work. */
export function canClaim(c: Pick<ContractorRow, 'status' | 'agreement_signed_at' | 'w9_on_file'>): boolean {
  return c.status === 'active' && !!c.agreement_signed_at && c.w9_on_file;
}

export type PacketRow = {
  id: string;
  title: string;
  status: PacketStatus;
  trade: ContractorTrade;
  visit_date: string;
  window_start: string;
  window_end: string;
  centroid_lat: number | null;
  centroid_lng: number | null;
  max_pairwise_miles: number | null;
  stop_count: number;
  posted_price_cents: number;
  awarded_contractor_id: string | null;
  claimed_at: string | null;
  claim_deadline: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by_email: string | null;
  paid_at: string | null;
  paid_by_email: string | null;
  published_at: string | null;
  notes: string | null;
  auto_generated: boolean;
  suggestion_key: string | null;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
};

export type PacketStopRow = {
  id: string;
  packet_id: string;
  property_id: string;
  booking_id: string | null;
  window_basis: WindowBasis;
  prior_checkout: string | null;
  next_checkin: string | null;
  base_price_cents: number;
  walk_order: number;
  inspection_id: string | null;
  status: StopStatus;
  created_at: string;
};

/** Property fields the Field module needs: location + the access bundle. */
export type FieldProperty = {
  id: string;
  name: string;
  title: string | null;
  address: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  inspection_base_price_cents: number;
  // Access bundle (revealed to the awarded contractor only).
  guest_access_method: string | null;
  smart_lock_brand: string | null;
  smart_lock_code: string | null;
  key_code_location: string | null;
  gate_code: string | null;
  garage_code: string | null;
  alarm_system: string | null;
  parking: string | null;
};

/** Entry/access info shown to a contractor after they claim a packet. */
export type AccessBundle = {
  method: string | null;
  smartLock: string | null;
  lockboxLocation: string | null;
  gateCode: string | null;
  garageCode: string | null;
  alarm: string | null;
  parking: string | null;
};

export function accessBundle(p: FieldProperty): AccessBundle {
  const smartLock =
    p.smart_lock_code && p.smart_lock_brand
      ? `${p.smart_lock_brand}: ${p.smart_lock_code}`
      : p.smart_lock_code || null;
  return {
    method: p.guest_access_method,
    smartLock,
    lockboxLocation: p.key_code_location,
    gateCode: p.gate_code,
    garageCode: p.garage_code,
    alarm: p.alarm_system,
    parking: p.parking,
  };
}

export function hasAnyAccessInfo(a: AccessBundle): boolean {
  return Object.values(a).some((v) => !!v && String(v).trim().length > 0);
}

/** A stop joined with its property + (post-claim) access bundle. */
export type PacketStopDetail = PacketStopRow & {
  property: FieldProperty;
  access: AccessBundle | null;
};

/** A packet joined with its stops, for both internal and contractor views. */
export type PacketDetail = PacketRow & {
  stops: PacketStopDetail[];
  contractor: ContractorRow | null;
  /** Straight-line miles from the viewing contractor's home to the cluster
   *  centroid, when their home location is known. Set by the marketplace
   *  loader for "near you" ranking; undefined for internal views. */
  distanceMiles?: number;
};

/** A draft packet produced by the grouping algorithm, before persistence. */
export type PacketSuggestion = {
  title: string;
  visitDate: string;
  windowStart: string;
  windowEnd: string;
  centroidLat: number | null;
  centroidLng: number | null;
  maxPairwiseMiles: number;
  postedPriceCents: number;
  suggestionKey: string;
  stops: Array<{
    propertyId: string;
    propertyName: string;
    bookingId: string | null;
    windowBasis: WindowBasis;
    priorCheckout: string | null;
    nextCheckin: string | null;
    basePriceCents: number;
    walkOrder: number;
  }>;
};

export function dollars(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/** Drop the trailing state ("Gloucester MA" -> "Gloucester") for display. */
export function cityShort(city: string | null): string {
  if (!city) return '';
  return city.replace(/,?\s*(MA|CT|FL|NH|RI|ME)$/i, '').trim();
}

function streetName(name: string): string {
  const m = (name || '').match(/[A-Za-z][A-Za-z\s]+$/);
  return (m ? m[0] : name).trim();
}

/** A shared street/neighborhood when 2+ stops sit on it (e.g. "Rocky Neck"),
 *  otherwise null. */
export function sharedArea(p: PacketDetail): string | null {
  const counts = new Map<string, number>();
  for (const s of p.stops) {
    const k = streetName(s.property.name);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top && top[1] > 1 ? top[0] : null;
}

/** The card/detail headline: carries what + where. The property name for a
 *  single stop, otherwise "N inspections on <neighborhood>" or "in <town>". */
export function packetHeadline(p: PacketDetail): string {
  if (p.stop_count === 1) return p.stops[0]?.property.name ?? '1 inspection';
  const area = sharedArea(p);
  if (area) return `${p.stop_count} inspections on ${area}`;
  const city = cityShort(p.stops[0]?.property.city ?? null);
  return city ? `${p.stop_count} inspections in ${city}` : `${p.stop_count} inspections`;
}
