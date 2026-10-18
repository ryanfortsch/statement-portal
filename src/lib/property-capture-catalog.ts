/**
 * Client-safe half of the property quick-capture feature: the routable
 * column catalog + the proposal/item types. No 'ai' or 'zod' imports, so
 * the review UI (a client component) can pull labels + types from here
 * without bundling the model SDK. The server-side parser in
 * src/lib/ai/property-capture.ts imports from this module.
 */

export type CaptureColumn = {
  key: string;
  label: string;
  section: string;
  type: 'text' | 'int' | 'float' | 'phone';
  /** A couple of phrasings so the model learns the mapping. */
  hints: string;
  /**
   * High-consequence entry/access field: downstream tools (the field-crew
   * packet's "HOW TO GET IN", the guest KB) render these as the PRIMARY way
   * to get into the home. A wrong value here misleads a cleaner or inspector,
   * so the model routes only the primary/current method here (spare/backup
   * goes to a note), and the review UI does not auto-apply these.
   */
  highStakes?: boolean;
};

/**
 * The routable column catalog. Identity/billing columns (id, name,
 * address, management_fee_pct, owner_emails) are intentionally excluded:
 * too consequential for fuzzy dictation; they have guarded edit paths.
 *
 * `section` is the Facts tab's group name, the same one the edit form uses,
 * so the capture review chip ("Connectivity · Wi-Fi name") speaks the one
 * vocabulary the page does.
 */
export const CAPTURE_COLUMNS: CaptureColumn[] = [
  // ── Utilities ──
  { key: 'wifi_name', label: 'Wi-Fi name', section: 'Connectivity', type: 'text', hints: 'network/SSID' },
  { key: 'wifi_password', label: 'Wi-Fi password', section: 'Connectivity', type: 'text', hints: 'wifi code/password' },
  { key: 'wifi_label', label: 'Wi-Fi 1 unit label', section: 'Connectivity', type: 'text', hints: 'which unit the main network covers' },
  { key: 'wifi_name_2', label: 'Wi-Fi 2 name', section: 'Connectivity', type: 'text', hints: 'second unit network/SSID' },
  { key: 'wifi_password_2', label: 'Wi-Fi 2 password', section: 'Connectivity', type: 'text', hints: 'second unit wifi code' },
  { key: 'wifi_label_2', label: 'Wi-Fi 2 unit label', section: 'Connectivity', type: 'text', hints: 'which unit the second network covers' },
  { key: 'thermostat_brand', label: 'Thermostat brand', section: 'House and systems', type: 'text', hints: 'Nest / ecobee / Honeywell' },
  { key: 'thermostat_code', label: 'Thermostat code', section: 'House and systems', type: 'text', hints: 'thermostat PIN/login' },
  { key: 'electricity_provider', label: 'Electricity provider', section: 'House and systems', type: 'text', hints: 'Eversource / NSTAR' },
  { key: 'heating', label: 'Heating', section: 'House and systems', type: 'text', hints: 'oil / gas / heat pump' },
  { key: 'cooling', label: 'Cooling', section: 'House and systems', type: 'text', hints: 'central A/C / mini-split / none' },
  { key: 'internet_provider', label: 'Internet provider', section: 'Connectivity', type: 'text', hints: 'Comcast / Verizon Fios' },
  { key: 'cable_provider', label: 'Cable / TV provider', section: 'Connectivity', type: 'text', hints: 'cable company' },
  { key: 'num_tvs', label: 'Number of TVs', section: 'Connectivity', type: 'int', hints: 'count of TVs' },
  { key: 'smart_tv', label: 'Smart TV', section: 'Connectivity', type: 'text', hints: 'Roku / Samsung smart TV notes' },

  // ── Access & codes ──
  { key: 'smart_lock_brand', label: 'Smart lock brand', section: 'Entry and credentials', type: 'text', hints: 'Yale / August / Schlage' },
  { key: 'smart_lock_code', label: 'Smart lock code', section: 'Entry and credentials', type: 'text', hints: 'the PRIMARY door lock PIN / entry code used to get in', highStakes: true },
  { key: 'gate_code', label: 'Gate code', section: 'Entry and credentials', type: 'text', hints: 'driveway/community gate code needed to reach the home', highStakes: true },
  { key: 'garage_code', label: 'Garage code', section: 'Entry and credentials', type: 'text', hints: 'garage keypad code', highStakes: true },
  { key: 'key_code_location', label: 'Key / code location', section: 'Entry and credentials', type: 'text', hints: 'where the PRIMARY lockbox / key is that a cleaner or inspector uses to get in. NOT a spare, backup, or emergency-only lockbox (that is a note).', highStakes: true },
  { key: 'supply_closet_location', label: 'Supply closet', section: 'Entry and credentials', type: 'text', hints: 'where cleaning supplies / linens / paper goods are kept' },
  { key: 'alarm_system', label: 'Alarm system', section: 'Entry and credentials', type: 'text', hints: 'ADT / SimpliSafe / none, plus how to disarm it on entry', highStakes: true },
  { key: 'guest_access_method', label: 'Guest access method', section: 'Entry and credentials', type: 'text', hints: 'the normal, primary way guests get in', highStakes: true },
  { key: 'security_cameras', label: 'Security cameras', section: 'Entry and credentials', type: 'text', hints: 'Ring / Wyze + locations' },

  // ── Specs ──
  { key: 'bedrooms', label: 'Bedrooms', section: 'House and systems', type: 'int', hints: 'bedroom count' },
  { key: 'bathrooms', label: 'Bathrooms', section: 'House and systems', type: 'float', hints: 'bathroom count (e.g. 2.5)' },
  { key: 'square_feet', label: 'Square feet', section: 'House and systems', type: 'int', hints: 'square footage' },
  { key: 'parking', label: 'Parking', section: 'Trash, parking and civic', type: 'text', hints: 'driveway / garage / street, capacity' },
  { key: 'basement', label: 'Basement', section: 'House and systems', type: 'text', hints: 'finished / unfinished / crawlspace' },
  { key: 'hoa', label: 'HOA', section: 'House and systems', type: 'text', hints: 'HOA fees / rules' },

  // ── STR setup ──
  { key: 'currently_listed', label: 'Currently listed', section: 'Listing', type: 'text', hints: 'Airbnb / VRBO platforms' },
  { key: 'str_registration_id', label: 'STR registration #', section: 'Safety and permits', type: 'text', hints: 'STR permit/license id' },
  { key: 'str_insurance_carrier', label: 'STR insurance carrier', section: 'Safety and permits', type: 'text', hints: 'insurance company' },
  { key: 'str_permit_expires', label: 'STR permit expiration', section: 'Safety and permits', type: 'text', hints: 'permit expiry date' },

  // ── Inspection & safety ──
  { key: 'trash_day', label: 'Trash day', section: 'Trash, parking and civic', type: 'text', hints: 'trash collection day' },
  { key: 'recycling_day', label: 'Recycling day', section: 'Trash, parking and civic', type: 'text', hints: 'recycling collection day' },
  { key: 'trash_notes', label: 'Trash notes', section: 'Trash, parking and civic', type: 'text', hints: 'indoor bin and outdoor cart location' },
  { key: 'parking_regulations', label: 'Parking regulations', section: 'Trash, parking and civic', type: 'text', hints: 'permit zone / street sweeping' },
  { key: 'gas_shutoff_location', label: 'Gas shutoff', section: 'Safety and permits', type: 'text', hints: 'gas shutoff valve location' },
  { key: 'water_shutoff_location', label: 'Water shutoff', section: 'Safety and permits', type: 'text', hints: 'main water shutoff location' },
  { key: 'electrical_panel_location', label: 'Electrical panel', section: 'Safety and permits', type: 'text', hints: 'breaker box location' },
  { key: 'fire_extinguisher_locations', label: 'Fire extinguishers', section: 'Safety and permits', type: 'text', hints: 'extinguisher placement' },
  { key: 'smoke_detector_locations', label: 'Smoke / CO detectors', section: 'Safety and permits', type: 'text', hints: 'detector placement' },
  { key: 'fire_exit_locations', label: 'Fire exits', section: 'Safety and permits', type: 'text', hints: 'egress routes' },

  // ── Owner contact ──
  { key: 'owner_phone', label: 'Owner phone', section: 'Owner', type: 'phone', hints: "owner's phone number" },
  { key: 'owner_mailing_address', label: 'Owner mailing address', section: 'Owner', type: 'text', hints: 'owner mailing address' },
  { key: 'owner_preferred_contact', label: 'Preferred contact', section: 'Owner', type: 'text', hints: 'call / text / email' },
  { key: 'emergency_contact_name', label: 'Emergency contact name', section: 'Emergency contact', type: 'text', hints: 'emergency contact person' },
  { key: 'emergency_contact_phone', label: 'Emergency contact phone', section: 'Emergency contact', type: 'phone', hints: 'emergency contact number' },
  { key: 'emergency_contact_relationship', label: 'Emergency contact relationship', section: 'Emergency contact', type: 'text', hints: 'brother / neighbor / PM' },
];

export const CAPTURE_COLUMN_KEYS = new Set(CAPTURE_COLUMNS.map((c) => c.key));
export function captureColumn(key: string): CaptureColumn | undefined {
  return CAPTURE_COLUMNS.find((c) => c.key === key);
}

/** True if `key` is a high-consequence entry/access field (drives how cleaners
 *  and inspectors get in). Callers gate auto-apply + show a warning on these. */
export function isHighStakesColumn(key: string | null | undefined): boolean {
  return !!key && !!captureColumn(key)?.highStakes;
}

/** A single routed fragment in a parsed proposal. */
export type CaptureItem = {
  /** 'column' writes into a structured field; 'note' creates a property note. */
  target: 'column' | 'note';
  /** Stable ID for a reviewed note, retained across retries. Never supplied by the parser. */
  noteId?: string;
  /** For target=column: the exact column key. Null for notes. */
  column: string | null;
  /** For target=column: the cleaned value to store. Null for notes. */
  value: string | null;
  /** For target=note: the note's title / body / tag. */
  noteTitle: string | null;
  noteBody: string | null;
  noteTag: string | null;
  /** For target=note: true if guest-messaging knowledge, false if internal ops. */
  guestFacing: boolean;
  /** The slice of the operator's text this came from (shown for trust). */
  sourceText: string;
  confidence: 'high' | 'medium' | 'low';
};

export type CaptureProposal = {
  items: CaptureItem[];
  /** Any part of the note the model couldn't confidently route. */
  unrouted: string | null;
};
