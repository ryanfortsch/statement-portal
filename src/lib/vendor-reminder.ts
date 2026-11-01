/** Pure Jobber reminder parsing, shared by every vendor ingest path. */

/**
 * "Aug 25, 2026 11:30AM at 84 Thatcher Road / Gloucester, Massachusetts"
 * Whitespace is irregular in the real texts (double spaces around the time
 * and before the zip, and the zip itself is often mistyped: 1930, 019300,
 * 1966), so nothing after the street is trusted -- the address is taken up
 * to the first "/" and matched on street number + name only.
 */
export const REMINDER_RE =
  /([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s+at\s+([^/\n]+?)\s*\//;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export type VendorAppointment = {
  property_id: string;
  service_date: string;
  service_time: string;
  raw_address: string;
};

/** Address tokens, normalized so the vendor's shorthand lines up with our
 *  property rows: "53R" is the street number 53, and "Down." is the
 *  downstairs sub-unit (A-1 writes "53R Down. Rocky Neck Avenue" for
 *  53_rocky_neck_2 and "53R Rocky Neck Avenue" for the main house --
 *  collapsing those two swaps a whole turnover onto the wrong unit). */
function addressTokens(s: string): string[] {
  const flat = (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(\d+)r\b/g, '$1')
    .replace(/\bdown\b/g, 'downstairs')
    .trim();
  return flat ? flat.split(' ') : [];
}

export type PropertyLite = { id: string; name: string | null; address: string | null };

/** Street number must agree; among survivors the most token overlap wins.
 *  Extra words in the registry are not evidence in the reminder: on an
 *  equal score, the base address wins over its more specific subunits.
 *  Require its tokens to be a subset of EVERY tied candidate, so unrelated
 *  names and sibling units stay ambiguous rather than choosing the shortest
 *  name or whichever row the database returned first. An explicit "Down."
 *  still gives the downstairs unit a higher score than its base address.
 *  Below two matching tokens (or without a number), return null. */
export function matchPropertyByAddress(address: string, properties: PropertyLite[]): string | null {
  const addrTokens = new Set(addressTokens(address));
  const streetNumber = [...addrTokens].find((t) => /^\d+$/.test(t));
  if (!streetNumber) return null;
  let candidates: Array<{ id: string; tokens: Set<string> }> = [];
  let bestScore = 0;
  for (const p of properties) {
    const pTokens = new Set([...addressTokens(p.name ?? ''), ...addressTokens(p.address ?? '')]);
    if (!pTokens.has(streetNumber)) continue;
    let score = 0;
    for (const t of addrTokens) if (pTokens.has(t)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      candidates = [{ id: p.id, tokens: pTokens }];
    } else if (score === bestScore) {
      candidates.push({ id: p.id, tokens: pTokens });
    }
  }
  if (bestScore < 2) return null;
  const base = candidates.filter((candidate) => candidates.every((other) =>
    [...candidate.tokens].every((token) => other.tokens.has(token)),
  ));
  return base.length === 1 ? base[0].id : null;
}

/** Parse one reminder body. Returns null for anything that isn't one. */
export function parseReminder(
  body: string,
  properties: PropertyLite[],
): VendorAppointment | null {
  const m = REMINDER_RE.exec(body || '');
  if (!m) return null;
  const [, mon, day, year, hh, mm, ampm, rawAddress] = m;
  const monthIdx = MONTHS.indexOf(mon.toLowerCase());
  if (monthIdx < 0) return null;
  let hour = Number(hh) % 12;
  if (ampm.toUpperCase() === 'PM') hour += 12;
  const propertyId = matchPropertyByAddress(rawAddress, properties);
  if (!propertyId) return null;
  return {
    property_id: propertyId,
    service_date: `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`,
    service_time: `${String(hour).padStart(2, '0')}:${mm}`,
    raw_address: rawAddress.trim(),
  };
}
