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
  background_check_status: 'not_started' | 'pending' | 'cleared' | 'failed';
  agreement_signed_at: string | null;
  agreement_signed_name: string | null;
  agreement_ip: string | null;
  agreement_user_agent: string | null;
  // Background-check authorization captured at onboarding (FCRA consent on
  // file; the office runs the actual report through a screening provider).
  bg_authorized_at: string | null;
  bg_authorized_name: string | null;
  bg_authorized_ip: string | null;
  bg_disclosure_version: string | null;
  home_lat: number | null;
  home_lng: number | null;
  service_radius_miles: number;
  photo_url: string | null;
  sms_opt_in: boolean; // receives "new work posted" texts (opt-out; default true)
  payment_method: string | null;
  payment_hint: string | null;
  vendor_key: string | null;
  invited_by_email: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

/** True once the contractor has finished the self-serve setup (active + signed
 *  agreement + W-9). They can browse, but can't claim until cleared. */
export function onboardingComplete(c: Pick<ContractorRow, 'status' | 'agreement_signed_at' | 'w9_on_file'>): boolean {
  return c.status === 'active' && !!c.agreement_signed_at && c.w9_on_file;
}

/** True once the contractor may claim paid work: onboarding done AND a
 *  background check that is at least underway. The office marking the check
 *  'pending' (running) unlocks claiming so a contractor can start while it
 *  completes; 'cleared' keeps them unlocked; 'not_started' and 'failed' do not.
 *  (They enter owners' homes, so a not-yet-started or failed check still gates.) */
export function canClaim(
  c: Pick<ContractorRow, 'status' | 'agreement_signed_at' | 'w9_on_file' | 'background_check_status'>,
): boolean {
  return onboardingComplete(c) && (c.background_check_status === 'cleared' || c.background_check_status === 'pending');
}

/** What the packet IS, orthogonal to who can do it (`trade`). 'standard' =
 *  every turnover-inspection and maintenance packet; 'setup' = staging a new
 *  property for photos + outfitting it for operations (2 to 4 hours, one home,
 *  done by inspection-trade specialists). */
export type PacketKind = 'standard' | 'setup';

export type PacketRow = {
  id: string;
  title: string;
  status: PacketStatus;
  trade: ContractorTrade;
  kind: PacketKind;
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
  paid_method: string | null;
  paid_reference: string | null;
  published_at: string | null;
  notes: string | null;
  instructions: string | null; // packet-wide free-form note from the office, shown to the inspector
  // Above-and-beyond bonus on top of posted_price_cents (0 = none). The posted
  // price stays the agreed claim-time record; the bonus is the extra, with the
  // reason shown to the contractor. Total payout = posted_price_cents + bonus_cents.
  bonus_cents: number;
  bonus_reason: string | null;
  entry_code: string | null;
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
  work_slip_id: string | null;
  instructions: string | null; // per-stop free-form note from the office, shown to the inspector
  status: StopStatus;
  // Live-route arrival signals (migration 20260701). started_at = Start tap;
  // arrived_verified_at = the Seam lock recorded their packet code at the door
  // (physical proof); arrival_source self|lock|both -> verified iff lock|both.
  started_at: string | null;
  arrived_verified_at: string | null;
  completed_at: string | null;
  departed_at: string | null; // left the property (next door opening, or submit)
  arrival_source: 'self' | 'lock' | 'both' | null;
  verified_device_id: string | null;
  verified_access_code_id: string | null;
  created_at: string;
};

/** The work-slip detail a maintenance stop covers (shown to the contractor). */
export type WorkSlipLite = {
  id: string;
  title: string;
  description: string | null;
  action_summary: string | null;
  bring_list: string | null;
  location: string | null;
  priority: string;
  photo_urls: string[];
};

/** A work slip ATTACHED to a stop (extra task riding on the visit), as opposed
 *  to a maintenance stop that IS a slip. Carries the per-attachment office note
 *  and its own completion, tracked independently of the stop's status. */
export type AttachedSlip = WorkSlipLite & {
  attachmentId: string;
  officeNote: string | null;
  completedAt: string | null;
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
  inspection_base_price_cents: number; // effective per-stop base (size-aware; see field-pricing)
  bedrooms: number | null;
  // Access bundle (revealed to the awarded contractor only).
  guest_access_method: string | null;
  arrival_brief: string | null;
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
  /** Arrival + parking brief, colleague tone (from property_access). */
  arrival: string | null;
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
    arrival: p.arrival_brief,
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
  workSlip: WorkSlipLite | null;
  /** Extra work slips the office attached to this stop (separate from workSlip,
   *  which is the maintenance job the stop itself is). [] when none. */
  attachedSlips: AttachedSlip[];
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
  // Normalize every stored shape ("Gloucester", "Gloucester, MA",
  // "Gloucester, MA 01930", "Gloucester MA") to the bare town, so the same
  // town never reads as two ("Gloucester & Gloucester, MA 01930").
  return city
    .split(',')[0]
    .replace(/\s+(MA|CT|FL|NH|RI|ME)(\s+\d{5}(-\d{4})?)?$/i, '')
    .trim();
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
  // "N inspections on X" claims EVERY stop is on X — only say it when true.
  // (2 of 3 on Rocky Neck plus one in Beverly used to read "on Rocky Neck".)
  return top && top[1] === p.stops.length ? top[0] : null;
}

/** Honest multi-town label, in stop order: "Gloucester", "Gloucester & Beverly",
 *  "Gloucester, Rockport & Beverly". A contractor judges drive time off this —
 *  a packet must never hide that a leg is in another town. */
export function townsLabel(cities: Array<string | null>): string {
  const towns = [...new Set(cities.map(cityShort).filter(Boolean))];
  if (towns.length === 0) return '';
  if (towns.length === 1) return towns[0];
  if (towns.length === 2) return `${towns[0]} & ${towns[1]}`;
  return `${towns.slice(0, -1).join(', ')} & ${towns[towns.length - 1]}`;
}

/** The card/detail headline: carries what + where. The property name for a
 *  single stop, otherwise "N inspections on <neighborhood>" or "in <town>". */
export function packetHeadline(p: PacketDetail): string {
  // Property setup: one home, one big job. Name the home when the viewer may
  // see it (masked payloads carry no name, so fall back to the town).
  if (p.kind === 'setup') {
    const nm = p.stops[0]?.property.name;
    if (nm) return `Set up ${nm}`;
    const c = cityShort(p.stops[0]?.property.city ?? null);
    return c ? `Property setup in ${c}` : 'Property setup';
  }
  // Maintenance/cleaning count JOBS, and several jobs can share one home — so
  // label by distinct homes, never by a "shared street" (which falsely implies
  // every job is on that street).
  if (p.trade === 'maintenance' || p.trade === 'cleaning') {
    const noun = p.trade === 'maintenance' ? 'job' : 'clean';
    const label = `${p.stop_count} ${p.stop_count === 1 ? noun : `${noun}s`}`;
    const homes = new Set(p.stops.map((s) => s.property_id)).size;
    if (homes <= 1) {
      const name = p.stops[0]?.property.name;
      return name ? `${label} at ${name}` : label;
    }
    return `${label} · ${homes} homes`;
  }
  // Inspections: one stop per home, so a shared street/town is accurate.
  if (p.stop_count === 1) {
    const nm = p.stops[0]?.property.name;
    if (nm) return nm;
    // Masked (pre-claim) payload has no name — fall back to the town.
    const c = cityShort(p.stops[0]?.property.city ?? null);
    return c ? `1 inspection in ${c}` : '1 inspection';
  }
  const area = sharedArea(p);
  if (area) return `${p.stop_count} inspections on ${area}`;
  const towns = townsLabel(p.stops.map((s) => s.property.city));
  return towns ? `${p.stop_count} inspections in ${towns}` : `${p.stop_count} inspections`;
}
