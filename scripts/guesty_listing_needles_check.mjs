/**
 * Every property Guesty can list must have a needle. Pure arithmetic on the
 * two maps, no database and no network.
 *
 * The needle map used to be a hardcoded object in /api/sync-guesty, and a
 * property missing from it had its listing dropped into `unmatched` on every
 * sync while the sync recorded status "ok". That hid 225 Washington until
 * 2026-08-24 and 4 Middle Road until 2026-09-04, in both cases while the
 * home was taking bookings. The map is now the hardcoded floor plus every
 * properties.listing_match in the database, so this asserts the two
 * invariants that make the layering safe.
 *
 * Run: node --experimental-strip-types scripts/guesty_listing_needles_check.mjs
 */
let failures = 0;
const fail = (m) => { failures++; console.log(`FAIL  ${m}`); };

// The floor, mirrored from src/app/api/sync-guesty/route.ts.
const FLOOR = {
  '3_south_st': '3 south', '21_horton': '21 horton', '53_rocky_neck': '53 rocky neck',
  '53_rocky_neck_2': '53 rocky neck (down', '4_brier_neck': '4 brier neck',
  '30_woodward': '30 woodward', '20_hammond': '20 hammond', '20_enon': '20 enon',
  '73_rocky_neck': '73 rocky neck', '17_beach_rd': '17 beach', '65_calderwood': '65 calderwood',
  '3_locust': '3 locust', '3246_ne_27th': '3246 ne 27th', '36_granite': '36 granite',
  '79_main': '79 main', '16_waterman': '16 waterman', '19_rackliffe': '19 rackliffe',
  '84_thatcher': '84 thatcher', '225_washington': '225 washington', '3_windward': '3 windward',
};

// properties.listing_match as of 2026-09-04, the layer that goes on top.
const DB = {
  '16_waterman': '16 waterman', '17_beach_rd': '17 beach', '19_rackliffe': '19 rackliffe',
  '20_enon': '20 enon', '20_hammond': '20 hammond', '21_horton': '21 horton',
  '225_washington': '225 washington', '3_locust': '3 locust', '3_south_st': '3 south',
  '3_windward': '3 windward', '30_woodward': '30 woodward', '36_granite': '36 granite',
  '4_brier_neck': '4 brier neck', '4_middle': '4 middle', '53_rocky_neck': '53 rocky neck',
  '53_rocky_neck_2': '53 rocky neck (down', '73_rocky_neck': '73 rocky neck',
  '79_main': '79 main', '84_thatcher': '84 thatcher',
};

const needles = { ...FLOOR, ...DB };

// The live Guesty listings on 2026-09-04, nickname + address exactly as the
// sync builds its haystack. 4 Middle is the one that used to fall through.
const LISTINGS = [
  ['65 Calderwood', 'Calderwood Court 65, 06605-3421 Bridgeport, United States', '65_calderwood'],
  ['3 Locust', 'Locust Lane 3, 01930 Gloucester, United States', '3_locust'],
  ['4 Brier Neck', '4 Brier Neck Road, 01930 Gloucester, United States', '4_brier_neck'],
  ['30 Woodward', '30 Woodward Ave, Gloucester, MA 01930, USA', '30_woodward'],
  ['20 Enon', '20 Enon St, Beverly, MA 01915, USA', '20_enon'],
  ['21 Horton', '21 Horton St, Gloucester, MA 01930, USA', '21_horton'],
  ['73 Rocky Neck', '73 Rocky Neck Avenue, Gloucester, Massachusetts 01930, United States', '73_rocky_neck'],
  ['53 Rocky Neck', '53 Rocky Neck Avenue, Gloucester, Massachusetts 01930, United States', '53_rocky_neck'],
  ['20 Hammond', '20 Hammond Street, Gloucester, Massachusetts 01930, United States', '20_hammond'],
  ['3 South', '3 South St b, Rockport, MA 01966, USA', '3_south_st'],
  ['3246 NE 27th', '3246 NE 27th Terrace, Lighthouse Point, FL 33064, USA', '3246_ne_27th'],
  ['17 Beach Road', '17 Beach Rd, Gloucester, MA 01930, USA', '17_beach_rd'],
  ['Back Unit - 17 Beach', '17 Beach Rd, Gloucester, MA 01930, USA', '17_beach_rd'],
  ['Front Unit -17 Beach', '17 Beach Rd, Gloucester, MA 01930, USA', '17_beach_rd'],
  ['79 Main', '79 Main St, Rockport, MA 01966, USA', '79_main'],
  ['36 Granite', '36 Granite St, Rockport, MA 01966, USA', '36_granite'],
  ['19 Rackliffe', '19 Rackliffe St, Gloucester, MA 01930, USA', '19_rackliffe'],
  ['16 Waterman', '16 Waterman Rd, Gloucester, MA 01930, USA', '16_waterman'],
  ['84 Thatcher', '84 Thatcher Rd, Gloucester, MA 01930, USA', '84_thatcher'],
  ['53 Rocky Neck (DOWN)', '53 Rocky Neck Ave, Gloucester, MA 01930, USA', '53_rocky_neck_2'],
  ['3 Windward', '3 Windward Point, Gloucester, MA 01930, USA', '3_windward'],
  ['225 Washington', '225 Washington St, Gloucester, MA 01930, USA', '225_washington'],
  ['4 Middle', '4 Middle Rd, Rockport, MA 01966, USA', '4_middle'],
];

// Longest needle wins, mirroring refreshListingMap.
function match(nickname, address, map) {
  const haystack = `${nickname} ${address}`.toLowerCase();
  let best = null, bestLen = 0;
  for (const [propId, needle] of Object.entries(map)) {
    if (needle.length > bestLen && haystack.includes(needle)) { best = propId; bestLen = needle.length; }
  }
  return best;
}

for (const [nickname, address, want] of LISTINGS) {
  const got = match(nickname, address, needles);
  if (got !== want) fail(`"${nickname}" matched ${got}, expected ${want}`);
}

// The regression itself: on the floor alone, 4 Middle finds nobody.
if (match('4 Middle', '4 Middle Rd, Rockport, MA 01966, USA', FLOOR) !== null) {
  fail('4 Middle is no longer the floor-only miss that motivated this; pick another fixture');
}
if (match('4 Middle', '4 Middle Rd, Rockport, MA 01966, USA', needles) !== '4_middle') {
  fail('the DB layer must map 4 Middle');
}

// A sub-unit needle must stay a superstring of its parent's, or the longest
// match hands the downstairs apartment to the main house.
for (const [child, parent] of [['53_rocky_neck_2', '53_rocky_neck']]) {
  if (!needles[child].startsWith(needles[parent])) {
    fail(`${child}'s needle must contain ${parent}'s`);
  }
}

// Every listing that has a properties row must be reachable from the DB layer
// alone, so the floor is only ever a safety net for the two RT-owned ones.
for (const [nickname, address, want] of LISTINGS) {
  if (!DB[want]) continue;
  if (match(nickname, address, DB) !== want) fail(`"${nickname}" is not reachable from properties.listing_match alone`);
}

console.log(failures === 0
  ? `OK    listing needles: all ${LISTINGS.length} live Guesty listings map, 4 Middle only via the DB layer, sub-unit needles still win`
  : `\n${failures} failure(s).`);
process.exit(failures ? 1 : 0);
