/**
 * The home's size as the office heard it on the first call: bedrooms (the
 * projection's own column), bathrooms and how many it sleeps. Pure, so the
 * edit form's parser, the workroom's facts line, the prospects list and the
 * readiness checklist read one rule.
 */

/** Bathrooms from the form: a half-bath step, more than 0, at most 20. Blank is null. */
export function parseBathrooms(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > 20 || Math.round(n * 2) !== n * 2) {
    throw new Error(`Bathrooms must be a whole or half number like 1.5, not ${s}`);
  }
  return n;
}

/** Sleeps from the form: a whole number of guests, 1 to 40. Blank is null. */
export function parseSleeps(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > 40) {
    throw new Error(`Sleeps must be a whole number of guests from 1 to 40, not ${s}`);
  }
  return n;
}

/** "1.5 BA", "2 BA". PostgREST may hand a numeric back as a string. */
export function bathsLabel(bathrooms: number | string | null | undefined): string | null {
  const n = Number(bathrooms);
  if (bathrooms == null || bathrooms === '' || !Number.isFinite(n) || n <= 0) return null;
  return `${n} BA`;
}

/**
 * One line of the home's facts, each only when known:
 * "Cottage · 3 BR · 1.5 BA · Sleeps 7". `withType` leads with the property
 * type (the workroom); the prospects list already says enough without it.
 */
export function prospectFactsLine(
  p: {
    property_type?: string | null;
    bedrooms?: number | null;
    bathrooms?: number | string | null;
    sleeps?: number | null;
  },
  opts: { withType?: boolean } = {},
): string {
  const parts: string[] = [];
  if (opts.withType && p.property_type) parts.push(p.property_type);
  if (p.bedrooms) parts.push(`${p.bedrooms} BR`);
  const ba = bathsLabel(p.bathrooms);
  if (ba) parts.push(ba);
  if (p.sleeps) parts.push(`Sleeps ${p.sleeps}`);
  return parts.join(' · ');
}
