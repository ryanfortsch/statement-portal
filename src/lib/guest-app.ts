/**
 * The Stay Cape Ann guest app, as data: everything /h/<token> shows a guest
 * for one home, built from the home's record by one pure function.
 *
 * Why it is built the way it is (2026-11-11, from a read of Guesty's own
 * guest app and the guidebooks guests actually use):
 *
 *  - One permanent link per home, printed as a QR code in the house. Guesty
 *    mints a link per reservation that expires at checkout, so it can never
 *    be printed. Ours outlives every stay, which is exactly why it carries
 *    NO door, gate, garage, alarm or thermostat code: a photo of the card
 *    would otherwise open the house next season. The input type below has
 *    no field that could hold one, and guest-app.test.ts reads the loader to
 *    keep it that way. The door code still arrives in the check-in message.
 *  - Wi-Fi first and never gated. Guesty reveals Wi-Fi and the door code as
 *    one module, so holding back one holds back the other.
 *  - Live, not synced. Guesty copies property fields into its app once a
 *    day. Every fact here is read from Helm on each load, from the same
 *    columns /api/kb-facts sends the guest AI, so the page on the guest's
 *    phone and the concierge's reply never disagree.
 *  - Blank is reported, not hidden. Guesty drops an empty field without a
 *    word; `missing` lists what this home's app has nothing for, and the
 *    property page shows it to the team.
 *  - City rules come from civic.ts. The trash night, the cart rule and the
 *    $400 "back in" clause are never written here.
 *  - Reaching a person is a text to the GUESTS line with the home already
 *    named, so it lands in the concierge's inbox and its emergency net like
 *    any other guest text. Nothing on the page writes to Helm.
 *
 * Pure (relative .ts imports, no server-only), so node:test pins it.
 */

import {
  cartSetOutFor,
  civicForProperty,
  type CivicInfo,
} from './civic.ts';
import { clockHHMM } from './house-policy.ts';
import { QUO_LINES } from './quo-lines.ts';
import type { GuestRoomFact } from './kb-facts-rooms.ts';
import type { NearbyPlace } from './guest-app-nearby.ts';
import type { HelmPropertyRow, HomeGuideOverrides } from './properties.ts';

// ── Input ──────────────────────────────────────────────────────────────────

/**
 * The guest-safe columns of `properties`, and only those. A column that is
 * not listed here cannot reach a guest. GUEST_APP_PROPERTY_COLS is the
 * select the loader runs; the two must name the same fields
 * (guest-app.test.ts checks).
 */
export type GuestAppHome = {
  id: string;
  name: string;
  title: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  guesty_listing_id: string | null;
  former_guesty_listing_id: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  max_occupancy: number | null;
  parking: string | null;
  parking_regulations: string | null;
  trash_day: string | null;
  recycling_day: string | null;
  trash_notes: string | null;
  carts_handled_by_us: boolean | null;
  heating: string | null;
  cooling: string | null;
  thermostat_brand: string | null;
  internet_provider: string | null;
  smart_tv: string | null;
  wifi_name: string | null;
  wifi_label: string | null;
  wifi_name_2: string | null;
  wifi_label_2: string | null;
  has_pack_n_play: boolean | null;
  has_high_chair: boolean | null;
  has_pullout_bed: boolean | null;
  pullout_linens_location: string | null;
  quiet_hours: string | null;
  pet_policy: string | null;
  smoking_policy: string | null;
  house_rules: string | null;
  default_checkout_time: string | null;
  smart_lock_brand: string | null;
  fire_extinguisher_locations: string | null;
  smoke_detector_locations: string | null;
  fire_exit_locations: string | null;
  water_shutoff_location: string | null;
  gas_shutoff_location: string | null;
  oil_shutoff_location: string | null;
  electrical_panel_location: string | null;
  home_guide_overrides: HomeGuideOverrides | null;
};

export const GUEST_APP_PROPERTY_COLS =
  'id, name, title, address, city, region, latitude, longitude, guesty_listing_id, former_guesty_listing_id, ' +
  'bedrooms, bathrooms, max_occupancy, parking, parking_regulations, trash_day, recycling_day, trash_notes, ' +
  'carts_handled_by_us, heating, cooling, thermostat_brand, internet_provider, smart_tv, wifi_name, wifi_label, ' +
  'wifi_name_2, wifi_label_2, has_pack_n_play, has_high_chair, has_pullout_bed, pullout_linens_location, ' +
  'quiet_hours, pet_policy, smoking_policy, house_rules, default_checkout_time, smart_lock_brand, ' +
  'fire_extinguisher_locations, smoke_detector_locations, fire_exit_locations, water_shutoff_location, ' +
  'gas_shutoff_location, oil_shutoff_location, electrical_panel_location, home_guide_overrides';

/** A guest-facing fact note (property_notes, kind fact, guest_facing). */
export type GuestAppNote = { title: string; body: string };

export type GuestAppInput = {
  home: GuestAppHome;
  /** The two Wi-Fi passwords from property_access, read by a select of exactly those two columns. */
  wifi: { password: string | null; password2: string | null };
  rooms: GuestRoomFact[];
  notes: GuestAppNote[];
  /** The rate plan's GUEST check-in (never properties.default_checkin_time, the cleaner's margin). */
  checkInTime: string | null;
  heroPhotoUrl: string | null;
  nearby: NearbyPlace[];
  /** staycapeann.com/stays/<id> when the home is listed there. */
  bookAgainUrl: string | null;
  welcomeNote: string | null;
  now: Date;
};

// ── Output ─────────────────────────────────────────────────────────────────

export type GuestItem = {
  /** Small label above or beside the text ("Network", "Primary bedroom"). */
  label?: string;
  text: string;
  /** Render in mono and offer a copy button (a password, a network name). */
  copy?: boolean;
  /** Quieter type for a footnote. */
  aside?: boolean;
  /** Keep the browser's page translation off this text (passwords, names). */
  noTranslate?: boolean;
  /** A tap target under the text. */
  link?: { href: string; label: string };
};

export type GuestSectionId =
  | 'wifi'
  | 'checkout'
  | 'trash'
  | 'house'
  | 'howto'
  | 'rules'
  | 'arrival'
  | 'safety'
  | 'nearby';

export type GuestSection = {
  id: GuestSectionId;
  /** The short name on the chip strip. */
  nav: string;
  title: string;
  intro?: string;
  items: GuestItem[];
};

export type WifiNetwork = {
  label: string | null;
  ssid: string;
  password: string | null;
  /** WIFI: URI for the join QR (iOS Camera and Android both read it). */
  joinUri: string | null;
};

export type TodayLine = { kind: 'trash' | 'sun'; title: string; text: string };

export type Hospital = { name: string; address: string; phone: string; tel: string; note: string; directionsUrl: string };

export type MissingFact = { label: string; where: string };

export type GuestApp = {
  propertyId: string;
  title: string;
  name: string;
  address: string | null;
  cityLine: string | null;
  heroUrl: string | null;
  welcome: string;
  directionsUrl: string | null;
  today: TodayLine[];
  wifi: WifiNetwork[];
  checkIn: string | null;
  checkOut: string | null;
  trashDay: string | null;
  sections: GuestSection[];
  nearby: NearbyPlace[];
  contact: {
    phoneDisplay: string;
    tel: string;
    text: string;
    report: string;
    lateCheckout: string;
    email: string;
  };
  emergency: { address: string | null; hospital: Hospital | null };
  bookAgainUrl: string | null;
  missing: MissingFact[];
};

// ── Helpers ────────────────────────────────────────────────────────────────

const ET = 'America/New_York';

const clean = (v: string | null | undefined): string => (v ?? '').trim();

/** "10:00" -> "10:00 AM", "16:00" -> "4:00 PM". */
export function clockLabel(hhmm: string | null | undefined): string | null {
  const t = clockHHMM(hhmm);
  if (!t) return null;
  const h = Number(t.slice(0, 2));
  const m = t.slice(3);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/** The WIFI: URI, escaped the way the printed placard escapes it. */
export function wifiJoinUri(ssid: string, password: string | null): string | null {
  if (!ssid) return null;
  const esc = (s: string) => s.replace(/([\\;,":])/g, '\\$1');
  return password
    ? `WIFI:T:WPA;S:${esc(ssid)};P:${esc(password)};H:false;;`
    : `WIFI:T:nopass;S:${esc(ssid)};;`;
}

/** sms: link that pre-fills the body. `?&body=` is the form iOS and Android both read. */
export function smsHref(e164: string, body: string): string {
  return `sms:${e164}?&body=${encodeURIComponent(body)}`;
}

export function telHref(e164: string): string {
  return `tel:${e164}`;
}

/** "+19788652575" -> "(978) 865-2575". */
export function phoneDisplay(e164: string): string {
  const d = e164.replace(/\D/g, '').replace(/^1/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
}

/** Today's weekday name in Eastern time. */
export function easternWeekday(now: Date): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: ET }).format(now);
}

/** Today's Eastern date as YYYY-MM-DD. */
export function easternDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** "forced hot water" style values read as prose without shouting. */
function sentence(s: string): string {
  const t = s.trim();
  if (!t) return t;
  const body = /[.!?]$/.test(t) ? t : `${t}.`;
  return body.charAt(0).toUpperCase() + body.slice(1);
}

/** Paragraphs from free text, blank-line or newline separated, "- " bullets unwrapped. */
export function paragraphs(text: string | null | undefined): string[] {
  return clean(text)
    .split(/\n\s*\n|\n(?=\s*[-*•]\s)/)
    .map((p) => p.replace(/^\s*[-*•]\s+/, '').replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
}

// ── Sunset ─────────────────────────────────────────────────────────────────

/**
 * Sunset for a date and place, NOAA's general solar position method
 * (accurate to a minute or two at Cape Ann's latitude), or null when the sun
 * does not set. Exported for the test.
 */
export function sunsetAt(isoDate: string, lat: number, lng: number): Date | null {
  const day = new Date(`${isoDate}T00:00:00Z`);
  const start = Date.UTC(day.getUTCFullYear(), 0, 1);
  const n = Math.floor((day.getTime() - start) / 86_400_000) + 1;
  const g = ((2 * Math.PI) / 365) * (n - 1);
  const eqTime =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const latR = (lat * Math.PI) / 180;
  const cosHa = Math.cos((90.833 * Math.PI) / 180) / (Math.cos(latR) * Math.cos(decl)) - Math.tan(latR) * Math.tan(decl);
  if (cosHa < -1 || cosHa > 1) return null;
  const haDeg = (Math.acos(cosHa) * 180) / Math.PI;
  const minutesUtc = 720 - 4 * (lng - haDeg) - eqTime;
  return new Date(day.getTime() + minutesUtc * 60_000);
}

function easternClock(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' }).format(d);
}

// ── Emergency ──────────────────────────────────────────────────────────────

/**
 * The emergency department a guest in this city should drive to. Both are
 * Beth Israel Lahey Health hospitals with a 24-hour emergency department;
 * the numbers are each hospital's main line (checked 2026-11-11 against
 * beverlyhospital.org). Unlisted cities get none rather than a guess, and
 * 911 always leads the section.
 */
export const HOSPITALS: Record<'addison_gilbert' | 'beverly', Omit<Hospital, 'directionsUrl'>> = {
  addison_gilbert: {
    name: 'Addison Gilbert Hospital',
    address: '298 Washington Street, Gloucester, MA',
    phone: '(978) 283-4000',
    tel: 'tel:+19782834000',
    note: 'Emergency department open 24 hours.',
  },
  beverly: {
    name: 'Beverly Hospital',
    address: '85 Herrick Street, Beverly, MA',
    phone: '(978) 922-3000',
    tel: 'tel:+19789223000',
    note: 'Emergency department open 24 hours.',
  },
};

const HOSPITAL_FOR_CITY: Record<string, keyof typeof HOSPITALS> = {
  Gloucester: 'addison_gilbert',
  Rockport: 'addison_gilbert',
  Essex: 'addison_gilbert',
  Manchester: 'beverly',
  'Manchester-by-the-Sea': 'beverly',
  Beverly: 'beverly',
};

export function hospitalForCity(city: string): Hospital | null {
  const key = HOSPITAL_FOR_CITY[city];
  if (!key) return null;
  const h = HOSPITALS[key];
  return { ...h, directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(h.address)}` };
}

// ── The build ──────────────────────────────────────────────────────────────

/** The welcome note's limit; the migration's check constraint says the same. */
export const GUEST_APP_WELCOME_MAX = 600;

export const DEFAULT_WELCOME =
  'We are so glad you are here. Everything for your stay is on this page: the Wi-Fi, how the house works, and our favorite places nearby. If anything comes up, text us.';

function cityShort(home: GuestAppHome): string {
  return clean(home.city).split(',')[0].trim();
}

function civicOf(home: GuestAppHome): CivicInfo {
  // civicForProperty reads city, address, trash_day, recycling_day and
  // parking_regulations; every one of them is a GuestAppHome field.
  return civicForProperty(home as unknown as HelmPropertyRow);
}

/** The home-guide cell text an operator wrote, if any (never the catalog's stock prose). */
function overrideText(ov: HomeGuideOverrides | null, key: 'wifi' | 'climate' | 'parking' | 'trash'): string {
  return clean(ov?.[key]);
}

function trashToday(home: GuestAppHome, civic: CivicInfo, now: Date): TodayLine | null {
  const setOut = cartSetOutFor(cityShort(home), civic.trashDay, { cartsHandledByUs: home.carts_handled_by_us === true });
  if (!setOut) return null;
  const today = easternWeekday(now);
  if (today === setOut.outNight) {
    return { kind: 'trash', title: 'Trash night', text: `${setOut.outLine} Pickup is ${setOut.day} morning.` };
  }
  if (today === setOut.day) {
    // When the team handles the carts, the guest has nothing to bring in.
    const back = home.carts_handled_by_us === true ? 'We bring the carts back in.' : `${setOut.backLine.replace(/\.$/, '')} once they are emptied.`;
    return { kind: 'trash', title: 'Pickup day', text: `The truck comes this morning. ${back}` };
  }
  return { kind: 'trash', title: 'Trash day', text: `Pickup is ${setOut.day} morning, so the carts go out ${setOut.outNight} night.` };
}

export function buildGuestApp(input: GuestAppInput): GuestApp {
  const { home, now } = input;
  const civic = civicOf(home);
  const city = cityShort(home);
  const ov = home.home_guide_overrides ?? null;
  const title = clean(home.title) || `Stay at ${home.name}`;
  const address = clean(home.address) || null;
  const fullAddress = address ? `${address}${city ? `, ${city}, MA` : ''}` : null;
  const coords = typeof home.latitude === 'number' && typeof home.longitude === 'number' ? { lat: home.latitude, lng: home.longitude } : null;
  const directionsUrl = coords
    ? `https://www.google.com/maps/dir/?api=1&destination=${coords.lat},${coords.lng}`
    : fullAddress
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fullAddress)}`
      : null;
  const checkIn = clockLabel(input.checkInTime);
  const checkOut = clockLabel(home.default_checkout_time);

  // Contact: the GUESTS line, with the home named so an unknown number (a
  // second guest's phone) still lands on the right house.
  const guestLine = QUO_LINES.guests.number;
  const where = `${title} (${home.name})`;
  const contact = {
    phoneDisplay: phoneDisplay(guestLine),
    tel: telHref(guestLine),
    text: smsHref(guestLine, `Hi, this is a guest at ${where}. `),
    report: smsHref(guestLine, `Something needs attention at ${where}: `),
    lateCheckout: smsHref(guestLine, `Hi, we are staying at ${where}. Is a late checkout possible on our last day?`),
    email: 'hello@staycapeann.com',
  };

  // ── Wi-Fi ──
  const wifi: WifiNetwork[] = [];
  const ssid1 = clean(home.wifi_name);
  const ssid2 = clean(home.wifi_name_2);
  if (ssid1) wifi.push({ label: clean(home.wifi_label) || null, ssid: ssid1, password: clean(input.wifi.password) || null, joinUri: wifiJoinUri(ssid1, clean(input.wifi.password) || null) });
  if (ssid2) wifi.push({ label: clean(home.wifi_label_2) || null, ssid: ssid2, password: clean(input.wifi.password2) || null, joinUri: wifiJoinUri(ssid2, clean(input.wifi.password2) || null) });

  const sections: GuestSection[] = [];

  // Wi-Fi & TV. The networks render as cards above the section items.
  const tvItems: GuestItem[] = [];
  for (const r of input.rooms) {
    if (!r.tv && !r.tv_remote) continue;
    tvItems.push({ label: r.name, text: [r.tv, r.tv_remote ? `Remote: ${r.tv_remote}` : ''].filter(Boolean).join('. ') });
  }
  const wifiItems: GuestItem[] = [];
  if (overrideText(ov, 'wifi')) for (const p of paragraphs(overrideText(ov, 'wifi'))) wifiItems.push({ text: p });
  if (clean(home.smart_tv)) wifiItems.push({ label: 'Streaming', text: sentence(clean(home.smart_tv)) });
  wifiItems.push(...tvItems);
  if (clean(home.internet_provider)) wifiItems.push({ label: 'Internet', text: `${clean(home.internet_provider)}. If it drops, text us and we will sort it out.`, aside: true });
  sections.push({ id: 'wifi', nav: 'Wi-Fi', title: 'Wi-Fi & TV', items: wifiItems });

  // Checking out.
  const checkoutItems: GuestItem[] = [];
  const setOut = cartSetOutFor(city, civic.trashDay, { cartsHandledByUs: home.carts_handled_by_us === true });
  if (setOut) {
    checkoutItems.push({
      label: `Leaving on a ${setOut.day}?`,
      text: home.carts_handled_by_us
        ? `Pickup is that morning. Bring the trash down the night before, lids closed, and we roll the carts out.`
        : `Pickup is that morning, so roll the carts to the curb the night before, lids closed. We bring them back in.`,
    });
  }
  checkoutItems.push({ label: 'On your way out', text: 'Lock the door behind you. Everything else stays as it is.' });
  checkoutItems.push({ label: 'More time?', text: 'Ask us about a late checkout. It depends on who arrives next.', link: { href: contact.lateCheckout, label: 'Ask about late checkout' } });
  sections.push({
    id: 'checkout',
    nav: 'Checkout',
    title: 'Checking out',
    intro: checkOut ? `Checkout is ${checkOut}. No chores required.` : 'No chores required.',
    items: checkoutItems,
  });

  // Trash & recycling: where the bins live (the row), when (civic), the rule (civic).
  const trashItems: GuestItem[] = [];
  const trashWhere = overrideText(ov, 'trash') || clean(home.trash_notes);
  for (const p of paragraphs(trashWhere)) trashItems.push({ text: p });
  if (civic.trashDay) {
    const rec = civic.recyclingDay && civic.recyclingDay !== civic.trashDay ? `, recycling on ${civic.recyclingDay}` : civic.recyclingDay ? ', recycling the same day' : '';
    trashItems.push({ label: 'Pickup', text: `${civic.trashDay} morning${rec}.` });
  }
  if (civic.receptacleRule) trashItems.push({ label: city === 'Gloucester' ? 'The City rule' : 'How it works here', text: civic.receptacleRule });
  if (trashItems.length) sections.push({ id: 'trash', nav: 'Trash', title: 'Trash & recycling', items: trashItems });

  // The house: rooms and beds, climate, gear for little ones.
  const houseItems: GuestItem[] = [];
  const counts = [
    home.bedrooms ? `${home.bedrooms} bedroom${home.bedrooms === 1 ? '' : 's'}` : '',
    home.bathrooms ? `${home.bathrooms} bath${home.bathrooms === 1 ? '' : 's'}` : '',
    home.max_occupancy ? `sleeps ${home.max_occupancy}` : '',
  ].filter(Boolean);
  if (counts.length) houseItems.push({ text: sentence(counts.join(' · ')).replace(/\.$/, '') });
  for (const r of input.rooms) {
    const beds = [...r.beds.filter((b) => !r.sofa_beds.some((s) => b.toLowerCase().includes(s.toLowerCase())))];
    const parts = [
      beds.length ? beds.join(', ') : '',
      r.sofa_beds.length ? `${r.sofa_beds.join(', ')}${r.sofa_linens ? ` (sheets: ${r.sofa_linens})` : ''}` : '',
      r.amenities.length ? r.amenities.join(', ') : '',
      r.guest_summary,
    ].filter(Boolean);
    if (parts.length) houseItems.push({ label: r.name, text: parts.map((p) => sentence(p)).join(' ') });
  }
  if (home.has_pullout_bed && clean(home.pullout_linens_location) && !input.rooms.some((r) => r.sofa_linens)) {
    houseItems.push({ label: 'Pullout bed sheets', text: sentence(clean(home.pullout_linens_location)) });
  }
  const climateText = overrideText(ov, 'climate');
  if (climateText) {
    for (const p of paragraphs(climateText)) houseItems.push({ label: 'Heat & cooling', text: p });
  } else if (clean(home.heating) || clean(home.cooling)) {
    const parts = [
      clean(home.heating) ? `Heat: ${clean(home.heating)}` : '',
      clean(home.cooling) ? `Cooling: ${clean(home.cooling)}` : '',
      clean(home.thermostat_brand) ? `Thermostat: ${clean(home.thermostat_brand)}` : '',
    ].filter(Boolean);
    houseItems.push({ label: 'Heat & cooling', text: parts.map(sentence).join(' ') });
  }
  const kids = [home.has_pack_n_play ? 'a pack-n-play' : '', home.has_high_chair ? 'a high chair' : ''].filter(Boolean);
  if (kids.length) houseItems.push({ label: 'For little ones', text: `The home has ${kids.join(' and ')}.` });
  if (houseItems.length) sections.push({ id: 'house', nav: 'The house', title: 'The house', items: houseItems });

  // How things work: the guest-facing facts (the concierge's knowledge
  // base) and any home-guide cell an operator wrote for this home.
  const howItems: GuestItem[] = [];
  const seen = new Set<string>();
  const addHow = (label: string, body: string) => {
    const key = `${label.toLowerCase()}|${body.toLowerCase()}`;
    if (!body || seen.has(key)) return;
    seen.add(key);
    howItems.push({ label: label || undefined, text: body });
  };
  for (const n of input.notes) addHow(clean(n.title), paragraphs(n.body).join(' '));
  for (const slot of [ov?.slot5, ov?.slot6]) {
    const body = clean(slot?.body);
    if (!slot || !body) continue;
    const label = slot.key === 'custom' ? clean(slot.customTitle) : SLOT_TITLES[slot.key] ?? '';
    addHow(label, paragraphs(body).join(' '));
  }
  if (howItems.length) sections.push({ id: 'howto', nav: 'How things work', title: 'How things work', items: howItems });

  // House rules.
  const ruleItems: GuestItem[] = [];
  ruleItems.push({ label: 'Quiet hours', text: clean(home.quiet_hours) ? sentence(clean(home.quiet_hours)) : civic.noise });
  if (home.max_occupancy) ruleItems.push({ label: 'Guests', text: `Up to ${home.max_occupancy} guests stay overnight.` });
  if (clean(home.pet_policy)) ruleItems.push({ label: 'Pets', text: sentence(clean(home.pet_policy)) });
  if (clean(home.smoking_policy)) ruleItems.push({ label: 'Smoking', text: sentence(clean(home.smoking_policy)) });
  for (const p of paragraphs(home.house_rules)) ruleItems.push({ text: sentence(p) });
  sections.push({ id: 'rules', nav: 'House rules', title: 'House rules', items: ruleItems });

  // Getting here: arrival time, parking, the door. Never a code.
  const arrivalItems: GuestItem[] = [];
  if (checkIn) arrivalItems.push({ label: 'Check-in', text: `From ${checkIn}.` });
  const parkingText = overrideText(ov, 'parking') || clean(home.parking);
  if (parkingText) for (const p of paragraphs(parkingText)) arrivalItems.push({ label: 'Parking', text: sentence(p) });
  arrivalItems.push({ label: 'On the street', text: civic.parking, aside: true });
  arrivalItems.push({
    label: 'The door',
    text: `${clean(home.smart_lock_brand) ? `The door has a ${clean(home.smart_lock_brand)} keypad. ` : ''}Your door code and entry steps come in your check-in message on arrival day.`,
  });
  if (fullAddress) arrivalItems.push({ label: 'Address', text: fullAddress, copy: true, noTranslate: true, link: directionsUrl ? { href: directionsUrl, label: 'Directions' } : undefined });
  sections.push({ id: 'arrival', nav: 'Getting here', title: 'Getting here', items: arrivalItems });

  // Safety. 911 and the hospital render as cards above these items.
  const safetyItems: GuestItem[] = [];
  const safetyFacts: Array<[string, string | null]> = [
    ['Fire extinguishers', home.fire_extinguisher_locations],
    ['Smoke detectors', home.smoke_detector_locations],
    ['Ways out', home.fire_exit_locations],
    ['Water shutoff', home.water_shutoff_location],
    ['Electrical panel', home.electrical_panel_location],
    ['Gas shutoff', home.gas_shutoff_location],
    ['Oil shutoff', home.oil_shutoff_location],
  ];
  for (const [label, v] of safetyFacts) if (clean(v)) safetyItems.push({ label, text: sentence(clean(v)) });
  safetyItems.push({ label: 'Poison control', text: '1-800-222-1222, any hour.', link: { href: 'tel:+18002221222', label: 'Call poison control' } });
  sections.push({
    id: 'safety',
    nav: 'Safety',
    title: 'Safety & emergencies',
    intro: 'In an emergency, call 911 first. Then text us so we can help.',
    items: safetyItems,
  });

  if (input.nearby.length) {
    sections.push({ id: 'nearby', nav: 'Nearby', title: 'Around Cape Ann', intro: 'Our favorite places from this front door, with how long it takes to get there.', items: [] });
  }

  // Today, at this house. Eastern time; Gloucester's cart night from civic.
  const today: TodayLine[] = [];
  const trash = trashToday(home, civic, now);
  if (trash) today.push(trash);
  if (coords) {
    const set = sunsetAt(easternDate(now), coords.lat, coords.lng);
    if (set) today.push({ kind: 'sun', title: 'Sunset', text: `${easternClock(set)} tonight.` });
  }

  return {
    propertyId: home.id,
    title,
    name: home.name,
    address,
    cityLine: city ? `${city}, Massachusetts` : null,
    heroUrl: input.heroPhotoUrl,
    welcome: clean(input.welcomeNote) || DEFAULT_WELCOME,
    directionsUrl,
    today,
    wifi,
    checkIn,
    checkOut,
    trashDay: civic.trashDay,
    sections,
    nearby: input.nearby,
    contact,
    emergency: { address: fullAddress, hospital: hospitalForCity(city) },
    bookAgainUrl: input.bookAgainUrl,
    missing: missingFacts(input, civic),
  };
}

const SLOT_TITLES: Record<string, string> = {
  bathrooms: 'Bathrooms',
  kitchen: 'Kitchen',
  hot_tub: 'Hot tub',
  outdoor: 'Outdoor space',
  pets: 'Pets',
  quiet_hours: 'Quiet hours',
  wood_stove: 'Wood stove',
  smart_tv: 'TV',
  laundry: 'Laundry',
};

/**
 * What this home's app has nothing for, in the words the property page
 * prints, each with where the team fills it in. Blank is said out loud,
 * because a guest who opens Safety and finds no water shutoff at 2 AM is
 * the failure Guesty's silent blanks produce.
 */
export function missingFacts(input: GuestAppInput, civic: CivicInfo = civicOf(input.home)): MissingFact[] {
  const h = input.home;
  const out: MissingFact[] = [];
  const add = (blank: boolean, label: string, where: string) => {
    if (blank) out.push({ label, where });
  };
  add(!clean(h.wifi_name) || !clean(input.wifi.password), 'Wi-Fi name and password', 'Facts');
  add(!clockHHMM(h.default_checkout_time), 'Checkout time', 'House policy');
  add(!clockHHMM(input.checkInTime), 'Guest check-in time', 'Pricing (rate plan)');
  add(!clean(h.parking) && !overrideText(h.home_guide_overrides, 'parking'), 'Parking', 'Facts');
  const city = cityShort(h);
  if (city !== 'Rockport') add(!clean(h.trash_notes) && !overrideText(h.home_guide_overrides, 'trash'), 'Where the trash bins live', 'Facts');
  if (city === 'Gloucester') add(!civic.trashDay, 'Trash day (ask DPW)', 'Facts');
  add(!clean(h.heating) && !clean(h.cooling) && !overrideText(h.home_guide_overrides, 'climate'), 'Heat and cooling', 'Facts');
  add(input.rooms.length === 0, 'Rooms and beds', 'Rooms');
  add(input.notes.length === 0, 'House how-tos (guest-facing notes)', 'Add a note, marked guest-facing');
  add(!clean(h.fire_extinguisher_locations), 'Fire extinguisher locations', 'Facts');
  add(!clean(h.smoke_detector_locations), 'Smoke detector locations', 'Facts');
  add(!clean(h.water_shutoff_location), 'Water shutoff', 'Facts');
  add(!clean(h.electrical_panel_location), 'Electrical panel', 'Facts');
  add(!input.heroPhotoUrl, 'A photo of the home', 'Listing photos');
  add(typeof h.latitude !== 'number' || typeof h.longitude !== 'number', 'Map location', 'Facts');
  return out;
}

/** Every guest-visible string, for the page's search box. */
export function searchText(section: GuestSection): string {
  return [section.title, section.intro ?? '', ...section.items.map((i) => `${i.label ?? ''} ${i.text}`)].join(' ').toLowerCase();
}

