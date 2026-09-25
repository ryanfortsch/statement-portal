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
 * that has no curbside collection at all. See GLOUCESTER_CART_CUTOVER.
 *
 * CAVEAT ON THE DAY TABLE: the street list below is the 11-16-23 revision.
 * Gloucester's 2026-10-01 switch to automated carts is documented as not
 * changing collection days, but nothing here has re-verified 690 streets
 * against the Casella route list. Confirm with DPW (978-325-5600) before
 * trusting a day for a street the fleet doesn't already occupy.
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
 * Gloucester retired its purple pay-as-you-throw bags on 2026-09-30 and
 * collects with automated Casella carts from 2026-10-01: one 65-gallon
 * trash cart and one 65-gallon recycling cart per unit, $300/yr billed
 * $75/quarter on the property's utility account. Short-term rentals are
 * named explicitly and are not exempt. Collection DAYS did not change and
 * the holiday one-day-later rule survives.
 *
 * The date matters because stays straddle it. A guest whose pickup is
 * 2026-09-28 still needs bags; the same guest's 2026-10-02 pickup needs the
 * cart. So the rule is resolved per render, not frozen into a constant.
 * Every surface that prints it is `force-dynamic`, so this evaluates on each
 * request and flips itself at midnight with nothing for anyone to remember.
 * This mirrors stay-concierge's `CART_CUTOVER` / `_uses_carts`
 * (src/trash_reminders.py), which keys on the PICKUP date for the same
 * reason. The two constants must stay equal.
 *
 * After 2026-10-01 the bag branch below is dead and should be deleted.
 */
export const GLOUCESTER_CART_CUTOVER = '2026-10-01';

/**
 * The canonical Gloucester cart paragraph. Wording is load-bearing, not
 * decorative:
 *
 *  - "lid fully closed" / "nothing beside the cart" replaces the bag-era
 *    habit of leaving overflow next to the barrel. Overflow is not collected.
 *  - "loose bags or personal barrels are no longer picked up" is here because
 *    the homes still physically have barrels a guest will reach for.
 *  - "back in that evening" is the compliance clause, not politeness.
 *    Gloucester STR ordinance Sec. 5-66(q) fines $400 PER OCCURRENCE for a
 *    cart left at the curb, each day a separate offence, and chains to the
 *    Board of Health rental permit via s.3.8. Do not drop it in a rewrite.
 *  - "after 4 PM the day before" satisfies both the current rule and the
 *    pending Chapter 9 Sec. 9-4 7 a.m. deadline. Never write "the night
 *    before" or "out by 7am" on their own.
 *
 * Identical in substance to stay-concierge's cart sentence so a guest who
 * reads the posted note and then texts us hears the same answer twice.
 */
export const GLOUCESTER_CART_RULE =
  'Everything goes in the two City carts with the lids fully closed, since anything left beside a cart is not collected, and loose bags or personal barrels are no longer picked up. Carts go out after 4 PM the day before collection and come back in that evening, which the city requires. A holiday earlier in the week pushes collection one day later, and Friday runs Saturday.';

/** The pre-cutover rule. Dead on 2026-10-01, delete it with the branch. */
const GLOUCESTER_BAG_RULE =
  'Trash goes out in the official purple City bags, which are the only ones collected. Bags go out after 4 PM the day before collection and the barrels come back in that evening, which the city requires. A holiday earlier in the week pushes collection one day later, and Friday runs Saturday. Gloucester switches to automated City carts on October 1, and after that everything goes in the carts instead.';

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

/**
 * Resolve the receptacle rule for a city on a given date. `on` is injectable
 * so the test suite can pin both sides of the cutover without touching the
 * clock.
 */
export function receptacleRuleFor(city: string, on: Date = new Date()): string | null {
  switch (city) {
    case 'Gloucester':
      return gloucesterDateKey(on) >= GLOUCESTER_CART_CUTOVER
        ? GLOUCESTER_CART_RULE
        : GLOUCESTER_BAG_RULE;
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
export function civicForProperty(p: HelmPropertyRow, on: Date = new Date()): CivicInfo {
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
    receptacleRule: receptacleRuleFor(cityShort, on),
  };
}

/**
 * Screen the sentinels that mean "no collection" so they never escape as a
 * printable weekday. The DPW list itself carries a literal "None" on one
 * street, and operators have typed "NA" and "DUMP" into the column for homes
 * with no curbside service.
 */
const NO_SERVICE_DAYS = new Set(['na', 'n/a', 'none', 'no', 'dump', '-', '—']);

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
 * Today's date in Gloucester, as YYYY-MM-DD.
 *
 * The cutover is a calendar date in Massachusetts, not an instant. Vercel runs
 * functions in UTC, so reading the date off the server's own clock would flip
 * the wording at 8 PM Eastern on 2026-09-30, four hours early, and tell a
 * guest to use a cart the city will not empty until Thursday. Pin the zone.
 */
function gloucesterDateKey(on: Date): string {
  // en-CA formats as YYYY-MM-DD, which is what we want to string-compare.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(on);
}

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
  const noSuffix = expanded.replace(/\b(street|st|avenue|ave|road|rd|lane|ln|way|drive|dr|circle|cir|court|ct|place|pl|square|sq|terrace|ter)\b\.?$/, '').trim();
  for (const suffix of ['street', 'avenue', 'road', 'lane', 'way', 'drive', 'circle', 'court', 'place', 'square', 'terrace']) {
    const candidate = `${noSuffix} ${suffix}`.trim();
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
 * Gloucester trash collection schedule. Source: City of Gloucester DPW,
 * "Street List for Trash Collection" (11-16-23 revision). Keys are
 * lowercased canonical street names; values are the 3-letter day code as
 * published. Recycling collection runs the same day on Gloucester's
 * single-stream curbside route.
 *
 * Streets with multiple entries on the published list (e.g. Atlantic
 * Road has both Mon and Fri rows depending on the segment) get the
 * later/conservative day so the inspection note doesn't promise pickup
 * on a day the truck might miss.
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
