/**
 * City-aware civic info used by the property Information Note.
 *
 * The Gloucester DPW publishes a per-street trash schedule; this module
 * pins the canonical lookup table so we never have to ask "what day is
 * trash" by hand. Source: gloucester-ma.gov/DocumentCenter/View/9780
 * (Street-list-for-trash-collection-11-16-23). Recycling in Gloucester is
 * single-stream curbside on the same day as trash.
 *
 * Beverly + Rockport publish their own schedules that aren't street-keyed
 * (or aren't published as cleanly) — for those we render city-wide
 * defaults until we have a reason to backfill per-property overrides.
 *
 * Noise + animal-control text and the default parking rules come from each
 * city's STR ordinance; they're per-jurisdiction, not per-property.
 *
 * THIS MODULE OWNS THE RECEPTACLE RULE. What a household puts waste in, and
 * when it goes to the curb, is city policy. A property row says where its
 * carts live; it does not get to contradict the city about the set-out rule.
 * Every surface reads `receptacleRule` from here rather than carrying its own
 * copy, which is what keeps a Gloucester cart sentence off a Rockport home
 * that has no curbside collection at all. See GLOUCESTER_CART_RULE.
 *
 * ON THE DAY TABLE: checked against the DPW list on 2026-09-25. The city still
 * publishes the 11-16-23 revision as current and says the Casella cart rollout
 * does not move collection days ("the day of the week that your trash is
 * currently picked up will remain the same", gloucester-ma.gov/1616), so the
 * table stands. Twelve streets carry two published days and are listed in
 * AMBIGUOUS_STREETS; those resolve to null rather than guessing.
 */
import type { HelmPropertyRow } from './properties';

export type CivicInfo = {
  /** Day of week trash is collected, or null if unknown. */
  trashDay: string | null;
  /** Day of week recycling is collected. Gloucester = same-day as trash. */
  recyclingDay: string | null;
  /** Self-contained parking guidance — never points elsewhere. */
  parking: string;
  /** City quiet-hours / noise ordinance summary, plain English. */
  noise: string;
  /** Animal-control summary. */
  animals: string;
  /** URL fragment for the city's published trash schedule. */
  trashLink: string | null;
  /**
   * What the household puts its waste IN, and when it goes to the curb.
   * City policy, never per-property: a property row may say where its carts
   * live, but it may not contradict the city about the set-out rule. Null
   * for a city we have no confirmed rule for, so a surface can omit the
   * line rather than print something wrong.
   */
  receptacleRule: string | null;
};

/**
 * Gloucester collects with automated Casella carts (since 2026-10-01): one
 * 65-gallon trash cart and one 65-gallon recycling cart per unit, $300/yr
 * billed $75/quarter on the property's utility account. Short-term rentals
 * are not exempt. Pickup is in the morning, so the carts go out the night
 * before. Bringing them back in is the part that costs money: Gloucester STR
 * ordinance Sec. 5-66(q) fines $400 per occurrence for a cart left at the
 * curb. Do not drop the "back in" clause in a rewrite.
 *
 * Kept short on purpose (Dotti, 2026-10-02): a guest needs where it goes,
 * when it goes out, and to bring it back. Identical in substance to
 * stay-concierge's cart sentence, so the posted note and a text agree.
 */
export const GLOUCESTER_CART_RULE =
  'Everything goes in the two City carts with the lids closed, since nothing left beside a cart is collected. Carts go out the night before pickup and come back in once they are emptied. A holiday earlier in the week pushes pickup one day later, and Friday runs Saturday.';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type CartSetOut = {
  /** Collection weekday, e.g. "Friday". */
  day: string;
  /** The evening the carts go out, e.g. "Thursday". */
  outNight: string;
  /** What the household does that evening. */
  outLine: string;
  /** When the carts come back, as a label fragment ("once emptied"), or null when that is our job. */
  backWhen: string | null;
  /** What it does once the truck has been. */
  backLine: string;
};

/**
 * The set-out half of GLOUCESTER_CART_RULE applied to one collection weekday,
 * for a surface that wants it as two dated lines (the fridge notice) instead
 * of the paragraph. Still city policy and still only this module's to word.
 * Gloucester only, since the lines describe City carts a Rockport home does
 * not have, and null without a resolved day so a card never prints a blank
 * where the day goes.
 *
 * "Bring the trash down" is the nudge the card exists for (Dotti, 2026-10-09):
 * the kitchen bag reaches the cart, and the cart reaches the curb. The second
 * line is the half that costs money under Sec. 5-66(q). The card is for
 * guests and says only these two things; the lids clause rides inside the
 * first line, and the holiday shift is the reminder texts' job.
 *
 * `cartsHandledByUs` (properties.carts_handled_by_us) is the one home where we
 * roll the carts ourselves, so the guest only fills them. The two lines say so.
 */
export function cartSetOutFor(
  city: string,
  trashDay: string | null,
  opts: { cartsHandledByUs?: boolean } = {},
): CartSetOut | null {
  if (city !== 'Gloucester' || !trashDay) return null;
  const idx = WEEKDAYS.indexOf(trashDay);
  if (idx < 0) return null;
  const ours = opts.cartsHandledByUs === true;
  return {
    day: trashDay,
    outNight: WEEKDAYS[(idx + 6) % 7],
    outLine: ours
      ? 'Bring the trash down, lids closed. We roll the carts to the curb.'
      : 'Bring the trash down and roll the carts to the curb, lids closed.',
    backWhen: ours ? null : 'once emptied',
    backLine: ours ? 'We bring the carts back in.' : 'Bring the carts back in.',
  };
}

/**
 * Rockport has no curbside collection at all: the town runs a Transfer Station
 * and its own pay-as-you-throw bags. Never send it cart wording.
 *
 * Written for the guest, who is the one reading it. Hauling to the Transfer
 * Station is OUR job, not theirs, so this says where their trash goes and
 * stops. An earlier draft described the Transfer Station run itself, which
 * read as an errand we were handing a guest on holiday.
 */
const ROCKPORT_RULE =
  'Rockport has no curbside collection, so nothing goes out to the street here. Fill the outdoor bins and leave them where they are, and we take it from there.';

/**
 * Beverly runs its own Casella program, moved over 2026-07-01 on its own
 * specs (95-gallon recycling). Deliberately states only what we have actually
 * confirmed: the carts and the lid rule. Beverly's set-out window and its
 * removal deadline are NOT Gloucester's and we have not sourced them, so this
 * does not assert one. Add it once someone has the city's own wording.
 */
const BEVERLY_RULE =
  'Beverly collects with City carts. Everything goes inside with the lid fully closed, since anything left beside a cart is not collected. Check the city schedule for the set-out window.';

/** The receptacle rule for a city, or null for a city we have not confirmed. */
export function receptacleRuleFor(city: string): string | null {
  switch (city) {
    case 'Gloucester':
      return GLOUCESTER_CART_RULE;
    case 'Rockport':
      return ROCKPORT_RULE;
    case 'Beverly':
      return BEVERLY_RULE;
    default:
      return null;
  }
}

/**
 * Resolve civic info for a property. Prefers per-property DB overrides
 * (`trash_day`, `recycling_day`, `parking_regulations`) when present;
 * otherwise derives from the city table.
 */
export function civicForProperty(p: HelmPropertyRow): CivicInfo {
  const cityShort = (p.city || '').split(',')[0].trim();
  const cityDefaults = civicForCity(cityShort);

  const street = extractStreet(p.address);
  const lookedUpDay =
    cityShort === 'Gloucester' ? gloucesterTrashDay(street) : null;

  // Per-property override wins over the lookup; lookup wins over null.
  const trashDay = normalizeDay(p.trash_day) || lookedUpDay;
  const recyclingDay =
    normalizeDay(p.recycling_day) ||
    // Gloucester collects single-stream recycling on the same day as trash.
    // Fall back to the RESOLVED trash day, not the raw lookup: when an
    // operator overrides trash_day the two must move together, or the note
    // prints two different days for a city that collects both at once.
    (cityShort === 'Gloucester' ? trashDay : null);

  return {
    trashDay,
    recyclingDay,
    parking: p.parking_regulations || cityDefaults.parking,
    noise: cityDefaults.noise,
    animals: cityDefaults.animals,
    trashLink: cityDefaults.trashLink,
    receptacleRule: receptacleRuleFor(cityShort),
  };
}

/**
 * True when `isoDate` (YYYY-MM-DD) falls on the property's resolved collection
 * weekday. Used by the cleaner schedule: a guest whose pickup is checkout
 * morning rolls the carts out on their last night, and the turnover cleaner
 * brings them back in (Sec. 5-66(q), $400 per day for a cart left out). The
 * nominal weekday only; a holiday-shifted week is not modelled here.
 */
export function isCollectionDay(trashDay: string | null, isoDate: string): boolean {
  if (!trashDay) return false;
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(`${isoDate}T12:00:00Z`),
  );
  return weekday === trashDay;
}

/**
 * Screen the sentinels that mean "no collection" so they never escape as a
 * printable weekday. The DPW list itself carries a literal "None" on one
 * street, and operators have typed "NA" and "DUMP" into the column for homes
 * with no curbside service.
 */
const NO_SERVICE_DAYS = new Set(['na', 'n/a', 'none', 'no', 'dump', '-', '—']);

/**
 * The weekday an operator typed on the row, or null when the column is empty
 * or holds a no-service sentinel. Exported so a surface can say whether the
 * day it prints came from the row (a DPW-confirmed answer) or the street list.
 */
export function normalizeTrashDay(raw: string | null | undefined): string | null {
  return normalizeDay(raw);
}

function normalizeDay(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v || NO_SERVICE_DAYS.has(v.toLowerCase())) return null;
  return DAY_LONG[v] ?? v;
}

/**
 * Pull the bare street name out of a full address. "21 Horton Street" →
 * "horton street". Lowercased so it matches the lookup table without us
 * worrying about case.
 */
function extractStreet(address: string): string {
  if (!address) return '';
  // Drop the leading house number(s) — including ranges and letter
  // suffixes like "21A". Then trim and lowercase.
  return address
    .replace(/^\s*\d+[a-zA-Z]?(\s*[-–]\s*\d+[a-zA-Z]?)?\s+/, '')
    // Drop anything after a comma: a unit token or a city/state tail.
    // "53 Rocky Neck, Downstairs" is a real address in the fleet and the
    // suffix pass below is end-anchored, so without this it never matches.
    .split(',')[0]
    .trim()
    .toLowerCase();
}

/**
 * Street-suffix spellings the DPW list and our address column disagree on.
 * The list publishes "windward point"; the property row says "3 Windward Pt".
 * Expanded before the lookup so both spellings land on the same key.
 */
const SUFFIX_ALIASES: Record<string, string> = {
  st: 'street',
  ave: 'avenue',
  av: 'avenue',
  rd: 'road',
  ln: 'lane',
  dr: 'drive',
  ct: 'court',
  cir: 'circle',
  pl: 'place',
  sq: 'square',
  ter: 'terrace',
  pt: 'point',
  hts: 'heights',
  ext: 'extension',
  pk: 'park',
};

/**
 * Look up a Gloucester street's collection day. Tries the exact key
 * first, then a "swap suffix" pass so "horton street" matches when the
 * table only has "horton" or vice-versa.
 */
function gloucesterTrashDay(street: string): string | null {
  if (!street) return null;
  // Canonicalize the suffix and drop a trailing period BEFORE anything else,
  // so an exact street still wins on the direct hit. This ordering is the
  // whole point: the synthesis pass below strips the suffix and guesses, and
  // on a stem with several entries it guesses wrong. "beach court" is Tuesday
  // while "beach road" is Monday, so "beach ct" or "beach court." reaching
  // synthesis used to answer Monday. Resolve the real key first and it never
  // gets there.
  // Order matters. The published list carries BOTH spellings for some streets
  // and they do not always agree ("patriots cir" is Wednesday, "patriots
  // circle" is Friday), and it carries an abbreviated-only key for others
  // ("mason sq", with no "mason square" to expand into). So an exact key,
  // period aside, always wins over the expansion.
  const bare = street.replace(/\.\s*$/, '');
  const expanded = bare.replace(
    /\b(st|ave|av|rd|ln|dr|ct|cir|pl|sq|ter|pt|hts|ext|pk)\b$/,
    (m) => SUFFIX_ALIASES[m] ?? m,
  );
  for (const candidate of [street, bare, expanded]) {
    if (AMBIGUOUS_STREETS.has(candidate)) return null;
    const direct = GLOUCESTER_TRASH[candidate];
    if (direct) return normalizeDay(direct);
  }
  // Try without the suffix word, then with each common suffix variant.
  //
  // point / heights / park are deliberately NOT in either list. They are rare
  // enough that a street carrying one usually has a same-stem neighbour with
  // an ordinary suffix, and synthesis would silently answer with the wrong
  // one: "norwood heights" is Friday but "norwood court" is Monday, and
  // stripping "heights" makes the Monday row win. The alias expansion above
  // already lands "windward pt" on the real "windward point" key by direct
  // lookup, which is the only case the fleet actually needs.
  // Synthesis could also land on an ambiguous street from a bare stem, so the
  // guard is repeated below rather than only on the direct hits.
  const noSuffix = expanded.replace(/\b(street|st|avenue|ave|road|rd|lane|ln|way|drive|dr|circle|cir|court|ct|place|pl|square|sq|terrace|ter)\b\.?$/, '').trim();
  for (const suffix of ['street', 'avenue', 'road', 'lane', 'way', 'drive', 'circle', 'court', 'place', 'square', 'terrace']) {
    const candidate = `${noSuffix} ${suffix}`.trim();
    if (AMBIGUOUS_STREETS.has(candidate)) return null;
    const hit = GLOUCESTER_TRASH[candidate];
    if (hit) return normalizeDay(hit);
  }
  return null;
}

/** Short city defaults — apply per jurisdiction. */
export function civicForCity(city: string): {
  parking: string;
  noise: string;
  animals: string;
  trashLink: string | null;
} {
  switch (city) {
    case 'Gloucester':
      return {
        parking:
          'Use the home’s designated parking spaces. On public streets, observe posted street-sweeping signs (typically once per month, April through November) and clear all on-street parking when the city declares a snow emergency. Do not block driveways, hydrants, or shared access. Resident-only zones are posted near the beaches; visitor parking is permitted only where signed.',
        noise:
          'Gloucester prohibits excessive noise that crosses property lines and disrupts neighbors’ comfort, especially between 10 p.m. and 7 a.m. Music, hot tubs, and outdoor gatherings should be kept quiet during these hours.',
        animals:
          'Dogs must be leashed in public spaces and waste picked up. Excessive barking that disturbs neighbors is treated as a noise violation.',
        trashLink: 'gloucester-ma.gov/DocumentCenter/View/9780',
      };
    case 'Rockport':
      return {
        parking:
          'Use the home’s designated parking spaces. On public streets, observe posted street-sweeping signs and resident-only zones near the harbor and beaches. Clear all on-street parking when a snow emergency is declared. Do not block driveways or hydrants.',
        noise:
          'Rockport quiet hours run 10 p.m. to 7 a.m. Sound that crosses property lines and disturbs neighbors is prohibited at any hour.',
        animals:
          'Dogs must be leashed in public spaces and waste picked up. Excessive barking is a noise violation.',
        trashLink: 'rockportma.gov/trash-recycling',
      };
    case 'Beverly':
      return {
        parking:
          'Use the home’s designated parking spaces. On public streets, observe posted street-sweeping signs and resident-only zones. Clear all on-street parking when a snow emergency is declared. Do not block driveways or hydrants.',
        noise:
          'Beverly enforces quiet hours from 10 p.m. to 7 a.m. Sound that crosses property lines and disturbs neighbors is prohibited at any hour.',
        animals:
          'Dogs must be leashed in public spaces and waste picked up. Excessive barking is a noise violation.',
        trashLink: 'beverlyma.gov/trash-recycling',
      };
    default:
      return {
        parking:
          'Use the home’s designated parking spaces. On public streets, observe posted parking signs, street-sweeping schedules, and snow-emergency rules. Do not block driveways or hydrants.',
        noise:
          'Please be considerate of neighbors at all hours, especially overnight (10 p.m. to 7 a.m.). Sound that crosses property lines and disturbs neighbors is generally prohibited.',
        animals:
          'Dogs must be leashed in public spaces. Please pick up after pets.',
        trashLink: null,
      };
  }
}

/** "Mon" → "Monday", etc. The PDF uses 3-letter abbreviations. */
const DAY_LONG: Record<string, string> = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Tues: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Thur: 'Thursday',
  Thurs: 'Thursday',
  Fri: 'Friday',
};

/**
 * Twelve streets on the published list carry more than one collection day,
 * because the route splits them part-way along. Ten of the twelve give no
 * segment note at all, so the street NAME cannot answer which day a given
 * house is on, and the list is the only thing this module has.
 *
 * Verified against the DPW list on 2026-09-25. The city still publishes the
 * 11-16-23 revision as current and states that the Casella cart rollout does
 * not change collection days ("the day of the week that your trash is
 * currently picked up will remain the same", gloucester-ma.gov/1616).
 *
 * The table below is a plain object literal, so a duplicated key silently
 * kept whichever row came last. That is not a conservative choice, it is an
 * arbitrary one, and it meant any property on one of these streets got a
 * confident coin-flip day on the printed Information Note. Refuse instead:
 * an ambiguous street resolves to null and the surface says to confirm with
 * DPW. A property can still carry an operator-set `properties.trash_day`,
 * which wins over this and is the right place to record the answer once
 * somebody has phoned 978-325-5600 for that specific address.
 */
const AMBIGUOUS_STREETS = new Set([
  'atlantic road',
  'cononicus road',
  'hough avenue',
  'magnolia avenue',
  'main street',
  'maplewood avenue',
  'middle street',
  'prospect street',
  'thatcher road',
  'washington street',
  'western avenue',
  'willow street',
]);

/**
 * Gloucester trash collection schedule. Source: City of Gloucester DPW,
 * "Street List for Trash Collection" (11-16-23 revision), still the current
 * published list as of 2026-09-25. The PDF itself is checked in at
 * docs/civic/gloucester-trash-street-list-2023-11-16.pdf, and this table was
 * diffed against it row for row on 2026-10-02: 690 streets, no differences,
 * the same twelve split streets. If the city reissues the list, replace the
 * PDF and re-diff; do not hand-edit a day here without a source. Keys are lowercased canonical street
 * names; values are the 3-letter day code as published. Recycling collection
 * runs the same day on Gloucester's single-stream curbside route.
 *
 * Streets the route splits are listed in AMBIGUOUS_STREETS above and are not
 * answerable from this table, whatever value survived the collapse here.
 */
const GLOUCESTER_TRASH: Record<string, string> = {
  'abbott road': 'Mon',
  'acacia street': 'Wed',
  'adams avenue': 'Fri',
  'adams hill road': 'Fri',
  'adams place': 'Mon',
  'addison street': 'Tues',
  'aileen terrace': 'Fri',
  'albion court': 'Thur',
  'allen street': 'Tues',
  'alpine court': 'Wed',
  'amero court': 'Mon',
  'andrews court': 'Thur',
  'andrews street': 'Thur',
  'angle street': 'Wed',
  'annisquam heights': 'Thurs',
  'apple street': 'Wed',
  'arbor street': 'Fri',
  'arcadia court': 'Wed',
  'arland terrace': 'Fri',
  'arlington street': 'Fri',
  'armstrong way': 'Wed',
  'arthur court': 'Wed',
  'arthur street': 'Wed',
  'ashland place': 'Wed',
  'atlantic avenue': 'Tues',
  'atlantic road': 'Fri',
  'atlantic street': 'Tues',
  'avon court': 'Mon',
  'b road': 'Wed',
  'babson court': 'Wed',
  'babson street': 'Wed',
  'baker street': 'Wed',
  'balsam rd': 'Thur',
  'banner hill way': 'Mon',
  'barberry heights road': 'Thur',
  'barberry lane': 'Mon',
  'barberry way': 'Fri',
  'barker avenue': 'Thur',
  'barn lane': 'Mon',
  'barnerry ln': 'Mon',
  'bass avenue': 'Mon',
  'bass rocks road': 'Mon',
  'bayberry lane': 'Tues',
  'bayfield road': 'Thur',
  'bayle lane': 'Tues',
  'beach court': 'Tues',
  'beach road': 'Mon',
  'beachcroft road': 'Fri',
  'beachmont avenue': 'Fri',
  'beacon street': 'Wed',
  'beauport avenue': 'Wed',
  'becker lane': 'Tues',
  'becker ln': 'Tues',
  'beckford street': 'Tues',
  'bellevue avenue': 'Wed',
  'bemo avenue': 'Fri',
  'bennet street': 'Thur',
  'bent street': 'Mon',
  'bertoni road': 'Wed',
  'bianchini road': 'Thur',
  'bickford way': 'Fri',
  'birch grove heights': 'Thur',
  'birch road': 'Mon',
  'bittersweet road': 'Thur',
  'blackburn drive': 'None',
  'blake court': 'Mon',
  'blossom lane': 'Fri',
  'blossom street': 'Thur',
  'blueberry lane': 'Wed',
  'blynman avenue': 'Wed',
  'bond street': 'Thur',
  'boulder avenue': 'Fri',
  'brace cove': 'Fri',
  'bradford road': 'Wed',
  'bray street': 'Tues',
  'breakwater lane': 'Fri',
  'breezy point road': 'Wed',
  'bridgewater street': 'Fri',
  'brier neck avenue': 'Fri',
  'brier neck road': 'Fri',
  'brier road': 'Fri',
  'brierwood court': 'Thur',
  'brierwood street': 'Thur',
  'brightside avenue': 'Mon',
  'brookfield drive': 'Tues',
  'brooks road': 'Tues',
  'buena vista avenue': 'Fri',
  'bungalow road': 'Tues',
  'burnham street': 'Tues',
  'burns way': 'Thur',
  'butler avenue': 'Fri',
  'butman avenue': 'Thur',
  'butternut lane': 'Thur',
  'cabo drive': 'Mon',
  'calder street': 'Mon',
  'caledonia place': 'Mon',
  'cambridge avenue': 'Fri',
  'carlisle street': 'Wed',
  'carrie lane': 'Thur',
  'castle hill road': 'Fri',
  'castle view drive': 'Tues',
  'causeway street': 'Tues',
  'cedar lane': 'Wed',
  'cedar street': 'Tues',
  'cedarwood road': 'Tues',
  'centennial avenue': 'Wed',
  'center street': 'Tues',
  'chapel street': 'Mon',
  'chateau heights': 'Fri',
  'cherry hill road': 'Thur',
  'cherry street': 'Thur',
  'chester square': 'Fri',
  'chestnut street': 'Tues',
  'church street': 'Tues',
  'clarendon street': 'Fri',
  'clay court': 'Mon',
  'clearview avenue': 'Thur',
  'cleveland place': 'Wed',
  'cleveland street': 'Wed',
  'cliff avenue': 'Fri',
  'cliff road': 'Fri',
  'clifford court': 'Wed',
  'coggleshell road': 'Thurs',
  'colburn street': 'Thur',
  'cole ave': 'Thur',
  'coles island road': 'Tues',
  'collins avenue': 'Wed',
  'colonial street': 'Wed',
  'columbia street': 'Tues',
  'commercial street': 'Tues',
  'commonwealth avenue': 'Wed',
  'conant avenue': 'Wed',
  'concord street': 'Tues',
  'cononicus road': 'Tues',
  'corliss avenue': 'Wed',
  'costa drive': 'Thur',
  'cottage lane': 'Thur',
  'cove ledge lane': 'Fri',
  'crafts road': 'Tues',
  'crestview terrace': 'Mon',
  'cross street': 'Mon',
  'crowell avenue': 'Fri',
  'cunningham road': 'Wed',
  'curtis square': 'Wed',
  'dale avenue': 'Tues',
  'dalton ave': 'Fri',
  'dalton ln': 'Fri',
  'dalton road': 'Fri',
  'daniel roy road': 'Wed',
  'davis street': 'Mon',
  'day avenue': 'Thur',
  'day court': 'Thur',
  'days avenue': 'Thur',
  'decatur street': 'Mon',
  'dennis court': 'Thur',
  'dennis ct': 'Thur',
  'dennison street': 'Thur',
  'derby street': 'Wed',
  'diamond avenue': 'Fri',
  'doanne road': 'Wed',
  'dodge street': 'Tues',
  'dogtown rd': 'Thur',
  'dogtown road': 'Thur',
  'dolliver neckrd': 'Fri',
  'dorset drive': 'Thur',
  'dove lane': 'Mon',
  'drumhack road': 'Fri',
  'duley street': 'Thur',
  'duncan street': 'Tues',
  'dune circle': 'Tues',
  'dune lane': 'Tues',
  'eagle road': 'Mon',
  'east main street': 'Mon',
  'eastern avenue': 'Mon',
  'eastern point blvd': 'Fri',
  'eastern point road': 'Fri',
  'echo avenue': 'Thur',
  'edgemoor road': 'Mon',
  'edgewood road': 'Thur',
  'edmonds way': 'Fri',
  'elizabeth road': 'Mon',
  'ellery street': 'Thur',
  'elm avenue': 'Fri',
  'elm street': 'Tues',
  'elmo lane': 'Tues',
  'elmo ln': 'Tues',
  'elva road': 'Tues',
  'elwell street': 'Mon',
  'emerald st': 'Thur',
  'emerson ave': 'Wed',
  'emerson avenue': 'Wed',
  'emily lane': 'Fri',
  'englewood road': 'Fri',
  'esperanto road': 'Thur',
  'essex avenue': 'Thur',
  'essex street': 'Tues',
  'eveleth road': 'Thur',
  'exchange street': 'Wed',
  'fair street': 'Mon',
  'fairmont road': 'Mon',
  'farrington avenue': 'Mon',
  'fears court': 'Tues',
  'federal street': 'Tues',
  'fenley road': 'Tues',
  'fernald st': 'Tues',
  'fernald street': 'Tues',
  'fernwood lake avenue': 'Thur',
  'ferry street': 'Wed',
  'field road': 'Fri',
  'finch lane': 'Thur',
  'fleetwoods drive': 'Thur',
  'flume rd': 'Fri',
  'foley road': 'Wed',
  'folly point road': 'Thur',
  'forest lane': 'Thur',
  'forest street': 'Tues',
  'fort hill avenue': 'Fri',
  'fort square': 'Tues',
  'foster street': 'Wed',
  'franklin sq': 'Tues',
  'fremont street': 'Fri',
  'friend court': 'Mon',
  'friend street': 'Mon',
  'fuller lane': 'Fri',
  'fuller street': 'Fri',
  'gaffney street': 'Wed',
  'gale road': 'Tues',
  'gardner avenue': 'Mon',
  'gardner road': 'Mon',
  'gardner terrace': 'Thur',
  'gee avenue': 'Thur',
  'gerring road': 'Mon',
  'gibbs hill rd': 'Thur',
  'gilbert court': 'Wed',
  'gilbert road': 'Mon',
  'gilson way': 'Wed',
  'glenmere avenue': 'Wed',
  'gloucester avenue': 'Wed',
  'gloucester place': 'Wed',
  'goodwin road': 'Thur',
  'gould court': 'Tues',
  'grandview road': 'Wed',
  'granite court': 'Wed',
  'granite street': 'Wed',
  'grapevine road': 'Mon',
  'graystone road': 'Mon',
  'great hill road': 'Tues',
  'great ledge lane': 'Tues',
  'green street': 'Mon',
  'grove street': 'Wed',
  'gull lane': 'Tues',
  'hammond street': 'Mon',
  'hampden street': 'Wed',
  'hancock street': 'Tues',
  'harbor road': 'Mon',
  'harbour heights': 'Fri',
  'harold avenue': 'Wed',
  'harold court': 'Wed',
  'harriet road': 'Mon',
  'harrison avenue': 'Mon',
  'harrison terrace': 'Mon',
  'hartz street': 'Mon',
  'harvard street': 'Wed',
  'harvey place': 'Wed',
  'haskell court': 'Mon',
  'haskell street': 'Mon',
  'haven terrace': 'Mon',
  'hawthorne lane': 'Fri',
  'hawthorne road': 'Wed',
  'hayward rd': 'Wed',
  'heath heights': 'Thur',
  'herrick court': 'Mon',
  'hesperus avenue': 'Fri',
  'hesperus circle': 'Fri',
  'hickory street': 'Thur',
  'high popples road': 'Mon',
  'high rock terrace': 'Fri',
  'high street': 'Thur',
  'high street place': 'Thur',
  'highland court': 'Mon',
  'highland place': 'Mon',
  'highland street': 'Mon',
  'hill ave': 'Thur',
  'hillside court': 'Thur',
  'hillside road': 'Mon',
  'hilltop road': 'Tues',
  'hodgkins street': 'Wed',
  'holly street': 'Thur',
  'homans ct': 'Thur',
  'honeysuckle road': 'Wed',
  'horton street': 'Fri',
  'hough avenue': 'Wed',
  'hovey street': 'Wed',
  'howard road': 'Wed',
  'hudson rd': 'Wed',
  'hutchins court': 'Thur',
  'island rock ln': 'Fri',
  'ivy ct': 'Thurs',
  'jacque ln': 'Mon',
  'jer jean circle': 'Tues',
  'joseph way': 'Fri',
  'julian road': 'Thur',
  'julie court': 'Tues',
  'juniper road': 'Wed',
  'jusilla lane': 'Thur',
  'kent circle': 'Fri',
  'kent road': 'Thur',
  'keystone rd': 'Tues',
  'king phillip rd': 'Thur',
  'king road': 'Wed',
  'kirk road': 'Wed',
  'knowlton square': 'Wed',
  'kondelin road': 'Thur',
  'lake avenue': 'Fri',
  'lake road': 'Fri',
  'landing road': 'Tues',
  'lands end': 'Mon',
  'lane road': 'Fri',
  'lanes cove rd': 'Thur',
  'langsford street': 'Thur',
  'langsford way': 'Thur',
  'larady road': 'Wed',
  'larose avenue': 'Thur',
  'laurel street': 'Thur',
  'lawrence court': 'Tues',
  'lawrence ct': 'Tues',
  'lawrence mountain rd': 'Thur',
  'leaman drive': 'Tues',
  'ledge lane': 'Fri',
  'ledge road': 'Mon',
  'ledgemont avenue': 'Mon',
  'leighton court': 'Tues',
  'lendall street': 'Mon',
  'leonard street': 'Fri',
  'leslie o johnson rd': 'Wed',
  'leverett lane': 'Thur',
  'leverett st': 'Thur',
  'lewis court': 'Wed',
  'lexington avenue': 'Fri',
  'liberty street': 'Tues',
  'lighthouse way': 'Fri',
  'lily road': 'Tues',
  'lincoln avenue': 'Wed',
  'lincoln street': 'Tues',
  'lindberg drive': 'Thur',
  'linden avenue': 'Fri',
  'linden road': 'Wed',
  'links lane': 'Mon',
  'links road': 'Mon',
  'linnett place': 'Mon',
  'linwood ave': 'Thur',
  'linwood court': 'Thur',
  'lloyd st': 'Wed',
  'lloyd street': 'Wed',
  'locust lane': 'Fri',
  'loma drve': 'Mon',
  'long beach road': 'Fri',
  'longview road': 'Tues',
  'lookout road': 'Thur',
  'lookout street': 'Wed',
  'loring court': 'Mon',
  'lousi ave': 'Fri',
  'lowe drive': 'Fri',
  'luzitana ave': 'Mon',
  'lyndale avenue': 'Thur',
  'macomber road': 'Thur',
  'madison ave': 'Wed',
  'madison avenue': 'Wed',
  'madison court': 'Wed',
  'madison square': 'Wed',
  'magnolia avenue': 'Fri',
  'main street': 'Tues',
  'malcolm road': 'Thur',
  'mallard way': 'Mon',
  'mansfield court': 'Wed',
  'mansfield street': 'Wed',
  'mansfield way': 'Tues',
  'maple road': 'Fri',
  'maple street': 'Tues',
  'maplewood avenue': 'Wed',
  'maplewood court': 'Wed',
  'marble road': 'Mon',
  'marble street': 'Mon',
  'marchant street': 'Tues',
  'marina drive': 'Mon',
  'marion way': 'Mon',
  'marsh street': 'Wed',
  'marshfield street': 'Thur',
  'mason court': 'Tues',
  'mason sq': 'Thur',
  'mason street': 'Tues',
  'massachusetts avenue': 'Tues',
  'massassoit road': 'Thur',
  'mathieu hill rd': 'Tues',
  'mayflower lane': 'Mon',
  'mclellan street': 'Thur',
  'mechanic place': 'Thur',
  'megan’s way': 'Fri',
  'michaels ln': 'Mon',
  'middle street': 'Wed',
  'millett street': 'Tues',
  'milne way': 'Thur',
  'minnesota st': 'Thur',
  'mollies ln': 'Thur',
  'mollie\'s lane': 'Thur',
  'mondello square': 'Mon',
  'montgomery place': 'Mon',
  'montvale avenue': 'Thur',
  'moorland road': 'Mon',
  'morgan ave': 'Thur',
  'morgan avenue': 'Thur',
  'morton place': 'Wed',
  'mt ann rd': 'Thur',
  'mt vernon st': 'Mon',
  'mt. pleasant ave': 'Mon',
  'mt. pleasant way': 'Mon',
  'mt. vernon st': 'Mon',
  'munsey lane': 'Thur',
  'mussel point rd': 'Fri',
  'myrtle square': 'Wed',
  'mystic avenue': 'Wed',
  'nally avenue': 'Wed',
  'naomi road': 'Fri',
  'nashua avenue': 'Fri',
  'nautical heights': 'Mon',
  'nautilus road': 'Mon',
  'neptune place': 'Mon',
  'new way lane': 'Thur',
  'newton road': 'Fri',
  'nikolane way': 'Thur',
  'niles pond rd': 'Fri',
  'niles pond road': 'Fri',
  'norman avenue': 'Fri',
  'norrock road': 'Fri',
  'norseman avenue': 'Thur',
  'north kilby street': 'Thur',
  'norwood court': 'Mon',
  'norwood heights': 'Fri',
  'oak street': 'Tues',
  'oakes avenue': 'Fri',
  'ocean avenue': 'Fri',
  'ocean highlands': 'Fri',
  'oceanview drive': 'Mon',
  'old bray street': 'Tues',
  'old county road': 'Mon',
  'old farm lane': 'Thurs',
  'old ford road': 'Wed',
  'old salem path': 'Fri',
  'old salem road': 'Fri',
  'orchard road': 'Mon',
  'orchard street': 'Wed',
  'orchard way': 'Wed',
  'overlook avenue': 'Thur',
  'oxford road': 'Fri',
  'page street': 'Mon',
  'palfrey road': 'Fri',
  'park lane': 'Fri',
  'parker court': 'Mon',
  'parker street': 'Mon',
  'parkhurst court': 'Fri',
  'parsons street': 'Tues',
  'patriots cir': 'Wed',
  'patriots circle': 'Fri',
  'pearl street': 'Tues',
  'perkins peak': 'Mon',
  'perkins road': 'Wed',
  'perkins street': 'Mon',
  'perrywinkle ln': 'Wed',
  'pew avenue': 'Thur',
  'pierce avenue': 'Fri',
  'pigeon lane': 'Thur',
  'pine rd': 'Thur',
  'pine street': 'Tues',
  'pinecrest av': 'Thur',
  'pinecrest ave': 'Fri',
  'piraino ln': 'Thur',
  'pirates lane': 'Mon',
  'pleasant street': 'Tues',
  'plum court': 'Thur',
  'plum street': 'Mon',
  'point road': 'Wed',
  'poplar park': 'Wed',
  'poplar street': 'Wed',
  'popular st': 'Wed',
  'porter street': 'Tues',
  'powell court': 'Mon',
  'prentiss road': 'Fri',
  'presson point road': 'Tues',
  'proctor street': 'Tues',
  'prospect square': 'Tues',
  'prospect street': 'Tues',
  'prospect terrace': 'Fri',
  'puerto drive': 'Mon',
  'quarry street': 'Thur',
  'rackliffe street': 'Fri',
  'railroad avenue': 'Tues',
  'ramparts field road': 'Fri',
  'raven lane': 'Fri',
  'raymond street': 'Fri',
  'reservoir road': 'Thur',
  'revere st': 'Thur',
  'revere street': 'Thur',
  'reynard street': 'Thur',
  'riggs point road': 'Thur',
  'riggs street': 'Wed',
  'rio drive': 'Mon',
  'river road': 'Fri',
  'riverdale place': 'Thur',
  'riverdale street': 'Fri',
  'riverside': 'Wed',
  'riverside avenue': 'Wed',
  'riverview road': 'Wed',
  'roberts court': 'Tues',
  'rock island lane': 'Fri',
  'rockholm road': 'Fri',
  'rockland street': 'Wed',
  'rockmoor terrace': 'Fri',
  'rockport road': 'Fri',
  'rockwood lane': 'Thur',
  'rocky neck avenue': 'Fri',
  'rocky pasture road': 'Mon',
  'rogers lane': 'Fri',
  'rogers street': 'Tues',
  'ronna road': 'Wed',
  'rose lane': 'Wed',
  'rouse road': 'Fri',
  'rowley shore': 'Thur',
  'rowley street': 'Thur',
  'russ road': 'Tues',
  'russell avenue': 'Wed',
  'rust island road': 'Tues',
  'ryan road': 'Fri',
  'sadler street': 'Mon',
  'sagamore rd': 'Thur',
  'salt island road': 'Fri',
  'salt marsh lane': 'Tues',
  'samoset road': 'Thur',
  'samuel riggs circle': 'Thur',
  'sand dollar circle': 'Tues',
  'sanderson court': 'Thur',
  'sandy way': 'Tues',
  'sargent st ext': 'Tues',
  'sargent street': 'Tues',
  'saville lane': 'Thur',
  'saville road': 'Tues',
  'sawyer ave': 'Thur',
  'sayward street': 'Mon',
  'school street': 'Tues',
  'schooner ridge': 'Tues',
  'scott street': 'Mon',
  'sea fox lane': 'Tues',
  'sea rule lane': 'Fri',
  'sea view road': 'Mon',
  'seeall street': 'Thur',
  'shapley road': 'Mon',
  'shepherd street': 'Tues',
  'sherman road': 'Mon',
  'ship\'s bell rd': 'Thur',
  'shore hill road': 'Wed',
  'shore road': 'Fri',
  'short street': 'Tues',
  'sibley street': 'Tues',
  'silva court': 'Mon',
  'skipper way': 'Tues',
  'skipper way terrace': 'Tues',
  'skywood terrace': 'Mon',
  'sleep hill drive': 'Fri',
  'sleepy hollow road': 'Tues',
  'smith street': 'Tues',
  'smokey wy': 'Wed',
  'somes avenue': 'Thur',
  'south bend avenue': 'Fri',
  'south kilby street': 'Thur',
  'souther road': 'Mon',
  'spring court': 'Tues',
  'spring street': 'Tues',
  'springfield street': 'Wed',
  'spruce rd': 'Thur',
  'squam lane': 'Wed',
  'squam rock lane': 'Fri',
  'squam rock road': 'Fri',
  'st anthonys ln': 'Mon',
  'st. jospeh ln': 'Fri',
  'st. peter ln': 'Fri',
  'stage fort avenue': 'Fri',
  'stanley court': 'Mon',
  'stanwood avenue': 'Thur',
  'stanwood street': 'Thur',
  'stanwood terrace': 'Mon',
  'starknaught heights': 'Fri',
  'starknaught road': 'Fri',
  'staten street': 'Mon',
  'stevens lane': 'Fri',
  'stewart avenue': 'Mon',
  'stillington drive': 'Fri',
  'stone court': 'Wed',
  'story road': 'Fri',
  'strawberry cove': 'Fri',
  'stuart road': 'Thur',
  'stuart square': 'Thur',
  'sumac lane': 'Fri',
  'summer street': 'Wed',
  'summit street': 'Tues',
  'sumner street': 'Tues',
  'sunset hill road': 'Wed',
  'sunset point road': 'Thur',
  'sylvan court': 'Wed',
  'sylvan street': 'Wed',
  'taylor court': 'Mon',
  'taylor street': 'Mon',
  'terrace lane': 'Fri',
  'thatcher road': 'Mon',
  'thomas court': 'Tues',
  'thompson street': 'Tues',
  'thornhill wy': 'Thur',
  'thurston point road': 'Wed',
  'tolman avenue': 'Fri',
  'tolman street': 'Mon',
  'toronto avenue': 'Fri',
  'tower road': 'Fri',
  'tragabigzanda road': 'Mon',
  'trask street': 'Tues',
  'traverse street': 'Mon',
  'trenel cove road': 'Wed',
  'tucker street': 'Thur',
  'tufts lane': 'Thur',
  'twilight avenue': 'Fri',
  'two penny lane': 'Tues',
  'uncas road': 'Tues',
  'union court': 'Fri',
  'vale court': 'Thur',
  'valley road': 'Tues',
  'veterans way': 'Wed',
  'veteran\'s way': 'Fri',
  'viking street': 'Thur',
  'village road': 'Fri',
  'vine street': 'Thur',
  'vulcan street': 'Thur',
  'walker court': 'Tues',
  'walker street': 'Tues',
  'wall street': 'Mon',
  'wallace ct': 'Thur',
  'walnut street': 'Fri',
  'warner street': 'Tues',
  'warren street': 'Tues',
  'warwick road': 'Fri',
  'washington sq': 'Wed',
  'washington square': 'Wed',
  'washington street': 'Wed',
  'waterman road': 'Tues',
  'waterside lane': 'Fri',
  'wauketa road': 'Tues',
  'way road': 'Mon',
  'webster street': 'Mon',
  'wells st': 'Wed',
  'wesley st': 'Wed',
  'west parish lane': 'Thur',
  'western avenue': 'Wed',
  'wheeler street': 'Wed',
  'wheelers point rd': 'Wed',
  'whipple woods road': 'Thur',
  'whites mtn rd': 'Tues',
  'whittemore street': 'Wed',
  'wildwood rd': 'Wed',
  'wiley street': 'Fri',
  'william road': 'Wed',
  'williams court': 'Mon',
  'willow street': 'Wed',
  'winchester court': 'Tues',
  'windmere rd': 'Mon',
  'windward point': 'Fri',
  'wingaersheek road': 'Tues',
  'winthrop avenue': 'Thur',
  'wintrhop ave': 'Thur',
  'wise place': 'Mon',
  'wishart road': 'Thur',
  'witham street': 'Fri',
  'wolf hill lane': 'Wed',
  'wolf hill ln': 'Wed',
  'wolf hill road': 'Wed',
  'wonson street': 'Fri',
  'woodbury hill': 'Thur',
  'woodbury street': 'Thur',
  'woodman st': 'Thur',
  'woodward avenue': 'Thur',
  'wyoma road': 'Tues',
  'ye old county rd': 'Tues',
  'york road': 'Wed',
  'young avenue': 'Thur',
  'youngs road': 'Thur',
};
