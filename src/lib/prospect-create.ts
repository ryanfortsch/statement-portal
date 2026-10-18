import type { AirDnaMarket } from './projections-airdna';
import { deriveLegacyFromOwners, type Owner } from './projections-types.ts';
import { inferMarketFromCity, splitAddressLine } from './inquiry-parser.ts';

/**
 * A new prospect is two fields: who owns it and where it is. Everything
 * else is edited in the workroom, so the row is born with the values the
 * old seven-section create form saved when nobody touched it, and a home
 * value of 0, which keeps it out of the forecast (forecast-prospects reads
 * only rows with a home value) until someone enters one.
 */

/** The create form's defaults for every input it no longer asks for. */
export const NEW_PROSPECT_DEFAULTS = {
  property_type: 'House',
  bedrooms: 2,
  home_value: 0,
  neighborhood: null,
  interior_grade: null,
  mgmt_fee_pct: 0.25,
  base_cleaning: 200,
  addl_cleaning_per_br: 50,
  turnovers_per_year: 45,
  year2_growth_pct: 0.1,
  revenue_override_low: null,
  revenue_override_high: null,
  hero_low_override: null,
  hero_high_override: null,
  start_month: 5,
  apply_ramp: false,
  include_monthly_breakdown: false,
  term_start: null,
  term_end: null,
  initial_deposit: 2000,
  min_account_balance: 2000,
  min_availability_days: 270,
  sale_notification_days: 185,
  reputation_fee: 5000,
  custom_clauses: null,
  status: 'draft' as const,
};

/**
 * Owner cards from one typed name. "John Erickson" is one owner; "John and
 * Mary Erickson" or "John Erickson & Mary Smith" are two, and a first name
 * on its own borrows the family name that follows it, the way people write
 * a couple's name.
 */
export function ownersFromName(raw: string): Owner[] {
  const parts = raw
    .split(/\s*(?:,|&|\band\b)\s*/i)
    .map((p) => p.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  const split = parts.map((p) => {
    const words = p.split(' ');
    return words.length === 1
      ? { first_name: words[0], last_name: '' }
      : { first_name: words.slice(0, -1).join(' '), last_name: words[words.length - 1] };
  });
  for (let i = split.length - 2; i >= 0; i--) {
    if (!split[i].last_name) split[i].last_name = split[i + 1].last_name;
  }
  return split.map((o) => ({ ...o, email: null, phone: null, full_legal: null }));
}

/** The presentation month as the office sees today (Eastern), YYYY-MM. */
export function currentPresentationMonth(now: Date): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).slice(0, 7);
}

/**
 * The row a two-field create inserts, before who made it and the onboarding
 * token. "12 Atlantic Road, Rockport" sets the street, the town and the
 * market; a street alone is Gloucester, the densest market, and the market
 * is one click to change in the workroom.
 */
export function newProspectFields(
  input: { ownerName: string; address: string },
  now: Date,
): { ok: true; fields: Record<string, unknown> & { property_address: string; property_city: string; market: AirDnaMarket } } | { ok: false; error: string } {
  const ownerName = input.ownerName.trim().slice(0, 160);
  const address = input.address.trim().slice(0, 200);
  const owners = ownersFromName(ownerName);
  if (owners.length === 0) return { ok: false, error: 'Enter the owner’s name.' };
  const addr = splitAddressLine(address);
  if (addr.street.length < 3) return { ok: false, error: 'Enter the street address, like 12 Atlantic Road.' };
  const market = inferMarketFromCity(addr.city);
  const property_city = addr.city ? `${addr.city}, ${addr.state ?? 'MA'}` : `${market}, MA`;
  return {
    ok: true,
    fields: {
      ...NEW_PROSPECT_DEFAULTS,
      owners,
      ...deriveLegacyFromOwners(owners),
      property_address: addr.street,
      property_city,
      market,
      presentation_month: currentPresentationMonth(now),
    },
  };
}
