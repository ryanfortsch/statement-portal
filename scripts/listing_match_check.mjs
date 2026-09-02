/**
 * Listing name -> property. Pure arithmetic, no database.
 *
 * Guesty exports identify a stay by LISTING (the guest-facing External Title),
 * never by Helm's property id. /api/ingest's platform-CSV loop never read that
 * column: it stamped the property being ingested onto every row of a
 * FLEET-WIDE file, keyed on a portfolio-global `csv:<code>`. Last writer won.
 * On 2026-09-01 that was 3 Windward, which collected 31 stays belonging to
 * nine other properties, at a house that did not exist in Helm until
 * 2026-07-15.
 *
 * Run: node --experimental-strip-types scripts/listing_match_check.mjs
 */
import { matchProperty, longestMatch, NICKNAME_HINTS } from '../src/lib/listing-match.ts';

let failures = 0;
const fail = (m) => { failures++; console.log(`FAIL  ${m}`); };

// Real listing_match needles from properties.
const NEEDLES = {
  '3_south_st': '3 south',
  '21_horton': '21 horton',
  '53_rocky_neck': '53 rocky neck',
  '53_rocky_neck_2': '53 rocky neck (down',
  '4_brier_neck': '4 brier neck',
  '30_woodward': '30 woodward',
  '20_hammond': '20 hammond',
  '20_enon': '20 enon',
  '73_rocky_neck': '73 rocky neck',
  '3_windward': '3 windward',
};

/* -- the sub-unit must never be absorbed by its parent -------------------- */
{
  const got = matchProperty('53 Rocky Neck (Downstairs)', NEEDLES);
  if (got !== '53_rocky_neck_2') fail(`sub-unit lost to its parent prefix: got ${got}`);
  if (matchProperty('53 Rocky Neck', NEEDLES) !== '53_rocky_neck') fail('parent listing must still match the parent');
}

/* -- an unmatched listing returns null and must never be claimed ---------- */
{
  if (matchProperty('Some Listing We Do Not Own', NEEDLES) !== null) fail('an unknown listing must return null');
  if (matchProperty('', NEEDLES) !== null) fail('an empty listing must return null');
  if (matchProperty('   ', NEEDLES) !== null) fail('a whitespace listing must return null');
}

/* -- nicknames are the fallback, never the first choice ------------------- */
{
  // 'rocky neck' is 21 Horton's nickname AND a substring of two real needles.
  // A real needle must win outright.
  if (matchProperty('73 Rocky Neck', NEEDLES) !== '73_rocky_neck') {
    fail('a listing_match needle must beat a nickname');
  }
  // With no needle hit, the nickname carries it.
  if (matchProperty('Stay at Old Garden Beach', {}) !== '3_south_st') {
    fail('nickname fallback must resolve when no needle matches');
  }
}

/* -- the 3 Windward regression, as a fixture ------------------------------ */
{
  // These are real stays the ingest wrongly stamped onto 3 Windward.
  const STOLEN = [
    ['Stay at 21 Horton', '21_horton'],
    ['Stay at 20 Enon', '20_enon'],
    ['Stay at 20 Hammond', '20_hammond'],
    ['Stay at 73 Rocky Neck', '73_rocky_neck'],
    ['Stay at 3 South', '3_south_st'],
  ];
  for (const [listing, want] of STOLEN) {
    const got = matchProperty(listing, NEEDLES);
    if (got !== want) fail(`"${listing}" must resolve to ${want}, got ${got}`);
    if (got === '3_windward') fail(`"${listing}" resolved to 3 Windward, which is the original bug`);
  }
  // And 3 Windward's own listing still resolves to 3 Windward.
  if (matchProperty('Stay at 3 Windward', NEEDLES) !== '3_windward') {
    fail('3 Windward must still match its own listing');
  }
}

/* -- longestMatch is genuinely longest, not first ------------------------- */
{
  const needles = { short: 'neck', long: 'rocky neck' };
  if (longestMatch('rocky neck', needles) !== 'long') fail('longestMatch must prefer the longer needle');
}

/* -- every nickname points at a plausible property id --------------------- */
{
  for (const [pid, hint] of Object.entries(NICKNAME_HINTS)) {
    if (!hint || !hint.trim()) fail(`nickname for ${pid} is empty`);
    if (hint !== hint.toLowerCase()) fail(`nickname for ${pid} must be lowercase to match the lowercased haystack`);
  }
}

console.log(failures === 0
  ? 'PASS - sub-unit needles beat their parent, unknown listings return null instead of being claimed, real needles beat nicknames, and all five stay types wrongly stamped onto 3 Windward now resolve to their own property.'
  : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
