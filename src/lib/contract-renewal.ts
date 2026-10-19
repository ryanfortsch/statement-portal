import type { AirDnaMarket } from './projections-airdna';
import type { Owner } from './projections-types.ts';
import { inferMarketFromCity } from './inquiry-parser.ts';

/**
 * What a renewal draft takes from the managed property and its last register
 * row (`startContractRenewal` in src/app/projections/actions.ts). Two ways
 * the prefill went wrong on 16 Waterman's renewal (2026-10-19) are fixed
 * here, in one pure place:
 *
 * - `properties.city` already carries the state ("Gloucester, MA"). Adding
 *   ", MA" again printed "Gloucester, MA, MA" in the contract's address,
 *   and the market check compared "Rockport, MA" to "Rockport", so a
 *   Rockport or Beverly home fell to the Gloucester default.
 * - The register's party (a person and an LLC, like "Jane Marsh, Harbor
 *   Holdings, LLC") rode only on `prospect_full_legal`. The first
 *   prospect-form save re-derives that column from the first owner card
 *   (`deriveLegacyFromOwners`), and the card had no `full_legal`, so the
 *   party fell back to the person alone and the signed renewal and its
 *   register row would have named the wrong party. The party now sits on
 *   the card, where the save reads it.
 */

/**
 * The town and state from a stored city, the way civic.ts reads it: the
 * town is everything before the first comma. "Gloucester, MA",
 * "Gloucester, MA 01930", "Gloucester MA" and an already-doubled
 * "Gloucester, MA, MA" all give Gloucester, MA. A blank city is
 * Gloucester, the default market.
 */
export function cityAndState(raw: string | null | undefined): { city: string; state: string } {
  const parts = (raw ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  let city = parts[0] ?? '';
  let state = parts.slice(1).map((p) => p.match(/^([A-Za-z]{2})\b/)?.[1]).find(Boolean)?.toUpperCase() ?? 'MA';
  const bare = parts.length === 1 ? city.match(/^(.*\S)\s+([A-Z]{2})$/) : null;
  if (bare) {
    city = bare[1];
    state = bare[2];
  }
  return { city: city || 'Gloucester', state };
}

/** The draft's `property_city` and `market`, each named once. */
export function renewalPlace(rawCity: string | null | undefined): { property_city: string; market: AirDnaMarket } {
  const { city, state } = cityAndState(rawCity);
  return { property_city: `${city}, ${state}`, market: inferMarketFromCity(city) };
}

const named = (o: Owner) => Boolean(o.first_name?.trim() || o.last_name?.trim());

/**
 * The draft's owner cards and the party name it opens with. The party is
 * the register's `owner_party` (the name on the last signed agreement),
 * else the property's owner name. When the register has a party, the first
 * named card carries it as `full_legal` unless that card already has one,
 * so the form's first save keeps the party instead of collapsing it to a
 * first and last name. With no named card on the property, one card is
 * made from the party, the person's name taken from before the first comma.
 */
export function renewalOwners(input: {
  owners: Owner[] | null | undefined;
  registerParty: string | null | undefined;
  ownerFull: string | null | undefined;
  ownerLast: string | null | undefined;
  email: string | null | undefined;
  phone: string | null | undefined;
}): { owners: Owner[]; party: string } {
  const registerParty = input.registerParty?.trim() || null;
  const party = registerParty || input.ownerFull?.trim() || input.ownerLast?.trim() || 'Owner';
  const cards = Array.isArray(input.owners) ? input.owners : [];

  if (cards.some(named)) {
    const first = cards.findIndex(named);
    return {
      owners: cards.map((o, i) =>
        i === first && registerParty && !o.full_legal?.trim() ? { ...o, full_legal: registerParty } : o,
      ),
      party,
    };
  }

  const words = party.split(',')[0].replace(/\(.*\)/, '').trim().split(/\s+/);
  return {
    owners: [
      {
        first_name: words[0] ?? '',
        last_name: words.slice(1).join(' '),
        email: input.email ?? null,
        phone: input.phone ?? null,
        full_legal: party,
      },
    ],
    party,
  };
}
