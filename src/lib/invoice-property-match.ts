/**
 * One place that decides which property a Cape Ann Elite cleaning invoice
 * belongs to.
 *
 * Cape Ann Elite bills through QuickBooks and greets each invoice with the
 * property's street address ("Dear Allie O'Brien:21 Horton St,"). Two
 * consumers parse that greeting:
 *
 *   - `/api/sync-invoices` -- corroborates a bank cleaning row with the
 *     invoice that explains it, or files the invoice as an orphan.
 *   - `src/lib/forecast-cleaning.ts` -- the trailing-12-month cost grid.
 *
 * Both used to carry their own hardcoded needle map, and the two had drifted
 * apart by eight properties. A property missing from a map parses with
 * property_id = null: the sync skips the invoice (its cleaning row stays
 * uncorroborated) and its spend lands in "Unattributed" on /forecast.
 *
 * NONE of this touches owner statements. The statement PDF prints one
 * Cleaning line and `cleaning_total` comes from the bank, which stays the
 * source of truth. Invoices are attribution only.
 *
 * Needles now come from `properties`, in three layers, later layers winning
 * a needle collision:
 *
 *   1. FALLBACK_NEEDLES below -- what shipped hardcoded, kept so a database
 *      that is unreachable or not yet migrated degrades to today's behavior
 *      instead of attributing nothing.
 *   2. Derived from each row's `name` and `address`. This is what makes an
 *      ordinary new property attribute correctly with no stamping at all.
 *   3. `properties.invoice_match` -- explicit overrides for spellings the
 *      address does not yield: abbreviations ("53r rocky neck"), sub-units
 *      ("53 rocky neck (down"), suffix variants ("4 middle road").
 *
 * Matching is LONGEST-match, always. A sub-unit needle is a superstring of
 * its parent's ("53 rocky neck down" contains "53 rocky neck"), so a
 * first-hit scan silently bills the downstairs apartment to the main house.
 */

import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';

/** needle (lowercase) -> property_id slug. */
export type InvoiceNeedles = Record<string, string>;

/**
 * The hardcoded map as of the DB migration, kept as the floor rather than
 * the source. Do not add new properties here -- set `invoice_match` on the
 * row, or rely on the name/address derivation. This exists so a failed or
 * pre-migration database still attributes the fleet it already knew.
 */
export const FALLBACK_NEEDLES: InvoiceNeedles = {
  '21 horton': '21_horton',
  '21 horton st': '21_horton',
  '3 south': '3_south_st',
  '3 south st': '3_south_st',
  '53 rocky neck': '53_rocky_neck',
  '53r rocky neck': '53_rocky_neck',
  // Downstairs apartment -- its own property since 2026-07. Superstrings of
  // the parent's needles, which longest-match handles. Cover the spellings
  // Cape Ann Elite might use in the greeting.
  '53 rocky neck (down': '53_rocky_neck_2',
  '53 rocky neck down': '53_rocky_neck_2',
  '53 rocky neck downstairs': '53_rocky_neck_2',
  '53r rocky neck down': '53_rocky_neck_2',
  '73 rocky neck': '73_rocky_neck',
  '73r rocky neck': '73_rocky_neck',
  '4 brier neck': '4_brier_neck',
  '30 woodward': '30_woodward',
  '20 hammond': '20_hammond',
  '20 enon': '20_enon',
  '17 beach': '17_beach_rd',
  '17 beach rd': '17_beach_rd',
  '36 granite': '36_granite',
  '36 granite st': '36_granite',
  '16 waterman': '16_waterman',
  '16 waterman st': '16_waterman',
  '19 rackliffe': '19_rackliffe',
  '19 rackliffe st': '19_rackliffe',
  '79 main': '79_main',
  '79 main st': '79_main',
  '4 middle': '4_middle',
  '4 middle rd': '4_middle',
  '4 middle road': '4_middle',
  '84 thatcher': '84_thatcher',
  '84 thatcher rd': '84_thatcher',
  '84 thatcher road': '84_thatcher',
  '3 locust': '3_locust',
  '3 locust ln': '3_locust',
  '3 windward': '3_windward',
  '3 windward pt': '3_windward',
  '3 windward point': '3_windward',
  '225 washington': '225_washington',
  '225 washington st': '225_washington',
};

/** Collapse whitespace and case so needles compare against invoice text. */
function normalize(raw: string | null | undefined): string {
  return (raw ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Needles implied by a property's own name and address.
 *
 * Deliberately restricted to street-address forms: the greeting is an
 * address, so a needle that does not open with a house number ("Marina",
 * "The Cottage") is not one, and as a bare substring it would match any
 * invoice whose text happens to contain the word. The 4-character floor
 * keeps a stub row from claiming everything.
 */
function deriveNeedles(name: string | null, address: string | null): string[] {
  const out: string[] = [];
  for (const candidate of [normalize(name), normalize(address)]) {
    if (candidate.length >= 4 && /^\d/.test(candidate)) out.push(candidate);
  }
  return out;
}

/**
 * Build the needle map from the property registry, layered over the
 * hardcoded fallback.
 *
 * Never throws and never returns empty: an unreachable database, an
 * unconfigured service key, or a table without the column all degrade to
 * FALLBACK_NEEDLES. Attributing the fleet we already knew beats attributing
 * nothing, and the blast radius of a wrong answer here is a reporting bucket,
 * not a payout.
 */
export async function loadInvoiceNeedles(): Promise<InvoiceNeedles> {
  const merged: InvoiceNeedles = { ...FALLBACK_NEEDLES };

  if (!isServiceConfigured) return sortNeedles(merged);

  try {
    // No is_active filter on purpose: an offboarded property still owns its
    // historical invoices, which the trailing-12-month grid still shows.
    // Ordered so the merge is deterministic -- getCleaningCosts keys its
    // cache on this object, and an unstable order would thrash the key.
    const { data, error } = await supabaseAdmin
      .from('properties')
      .select('id, name, address, invoice_match')
      .order('id');

    if (error) {
      console.error('[invoice-property-match] properties read failed:', error.message);
      return sortNeedles(merged);
    }

    for (const row of data ?? []) {
      const id = typeof row.id === 'string' ? row.id : null;
      if (!id) continue;
      for (const needle of deriveNeedles(row.name, row.address)) {
        merged[needle] = id;
      }
    }
    // Explicit needles land in a second pass so they outrank a derived
    // needle from a DIFFERENT property, not just from their own row.
    for (const row of data ?? []) {
      const id = typeof row.id === 'string' ? row.id : null;
      if (!id) continue;
      const explicit = Array.isArray(row.invoice_match) ? row.invoice_match : [];
      for (const raw of explicit) {
        const needle = normalize(typeof raw === 'string' ? raw : '');
        if (needle) merged[needle] = id;
      }
    }
  } catch (err) {
    console.error('[invoice-property-match] properties read threw:', err);
  }

  return sortNeedles(merged);
}

/** Key-sorted copy, so the map is byte-stable for use as a cache key. */
function sortNeedles(needles: InvoiceNeedles): InvoiceNeedles {
  const out: InvoiceNeedles = {};
  for (const key of Object.keys(needles).sort()) out[key] = needles[key];
  return out;
}

/**
 * Attribute a scrap of invoice text to a property, or null.
 *
 * LONGEST match wins, never insertion order: sub-unit needles contain their
 * parent's, and a first-hit scan would bill the downstairs apartment to the
 * main house.
 */
export function matchInvoiceProperty(
  text: string,
  needles: InvoiceNeedles
): string | null {
  const lower = text.toLowerCase();
  let best: string | null = null;
  let bestLen = 0;
  for (const [needle, propId] of Object.entries(needles)) {
    if (needle.length > bestLen && lower.includes(needle)) {
      best = propId;
      bestLen = needle.length;
    }
  }
  return best;
}

/**
 * Pull the property out of an invoice snippet. Tries the greeting first
 * ("Dear Allie O'Brien:21 Horton St,"), then the whole snippet, since the
 * address is sometimes elsewhere in the preview text.
 */
export function parseInvoiceProperty(
  snippet: string,
  needles: InvoiceNeedles
): string | null {
  const greeting = snippet.match(/Dear\s+[^:]+:([^,]+)/i);
  if (greeting) {
    const matched = matchInvoiceProperty(greeting[1].trim(), needles);
    if (matched) return matched;
  }
  return matchInvoiceProperty(snippet, needles);
}
