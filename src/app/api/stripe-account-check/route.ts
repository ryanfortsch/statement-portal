import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase, isServiceConfigured as isConfigured } from '@/lib/supabase-admin';
import { getStripeKeysMap, refusedSecretKeyVars } from '@/lib/stripe-sync';
import { selectAllPaged } from '@/lib/paged-select';

/**
 * Stripe account-identity diagnostic. Answers the question nothing else in
 * Helm asks: WHICH Stripe account does each configured key actually belong
 * to?
 *
 * Exists because of 3 Windward (2026-08): STRIPE_KEY_3_WINDWARD was minted
 * from the wrong Stripe account during onboarding. The key was valid, so
 * stripe-sync ran cleanly and reported charges_found=0 while the property's
 * real account (acct_1U0QB6DtTD9vRdfS) held 3 charges. A wrong-account key
 * is indistinguishable from a quiet month unless something calls
 * GET /v1/account and shows the operator the account id + dashboard name.
 *
 * Per configured key (all of getStripeKeysMap(), or one via ?property_id=):
 *   - GET /v1/account: account id + dashboard display name
 *   - GET /v1/charges created in the last 60 days: a count (capped at 500)
 *   - confirmed Direct/VRBO stays on the books (check_in inside or after the
 *     same 60-day window), from guesty_reservations
 *   - suspect flag: account readable, ZERO charges, but Direct/VRBO stays
 *     exist. That combination is the wrong-account signature.
 *
 * READ-ONLY on both sides: two Stripe list/read calls per key, one Supabase
 * select. Never touches reservations, statements, fees, or any payout math.
 *
 * Auth: Helm session, enforced by src/proxy.ts (this route is deliberately
 * NOT in PUBLIC_API_PREFIXES). No secret ever leaves the server; the
 * response carries account ids and counts only.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
// Fleet-wide run is ~19 keys x (1 account read + up to 5 charge pages),
// parallelized per property. 120s leaves room for a slow Stripe day.
export const maxDuration = 120;

const STRIPE = 'https://api.stripe.com/v1';
const WINDOW_DAYS = 60;
const CHARGE_COUNT_CAP = 500;

async function stripeGetJson(
  key: string,
  path: string,
  params: Record<string, string>,
  errOut?: { status?: number; message?: string },
): Promise<Record<string, unknown> | null> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${STRIPE}/${path}?${qs}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    // Stripe's error text names the missing restricted-key permission, which
    // is exactly what the operator needs to fix the key in the dashboard.
    if (errOut) {
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      errOut.status = res.status;
      errOut.message = data.error?.message || `HTTP ${res.status}`;
    }
    return null;
  }
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

type AccountCheckRow = {
  property_id: string;
  /** acct_... id, or null when GET /v1/account was refused. */
  account_id: string | null;
  /** Stripe dashboard display name (settings.dashboard.display_name,
   *  falling back to business_profile.name). */
  display_name: string;
  account_error: string | null;
  /** Charges created in the last 60 days, or null when the list call failed. */
  charges_60d: number | null;
  /** True when the count hit the 500 cap (real count is higher). */
  charges_capped: boolean;
  charges_error: string | null;
  /** Confirmed Direct/VRBO stays with check_in >= 60 days ago (including
   *  future stays), or null when Supabase is unavailable. */
  direct_stays: number | null;
  /** The wrong-account signature: readable account, zero charges, but
   *  Direct/VRBO stays on the books. */
  suspect: boolean;
};

async function checkOneKey(
  propertyId: string,
  key: string,
  createdGteUnix: number,
  directStays: number | null,
): Promise<AccountCheckRow> {
  const row: AccountCheckRow = {
    property_id: propertyId,
    account_id: null,
    display_name: '',
    account_error: null,
    charges_60d: null,
    charges_capped: false,
    charges_error: null,
    direct_stays: directStays,
    suspect: false,
  };

  const acctErr: { status?: number; message?: string } = {};
  const acct = await stripeGetJson(key, 'account', {}, acctErr);
  if (acct) {
    row.account_id = typeof acct.id === 'string' ? acct.id : null;
    const settings = acct.settings as { dashboard?: { display_name?: string | null } } | undefined;
    const profile = acct.business_profile as { name?: string | null } | undefined;
    row.display_name = settings?.dashboard?.display_name || profile?.name || '';
  } else {
    row.account_error = `${acctErr.status ?? ''} ${acctErr.message ?? 'error'}`.trim();
  }

  // Count-only charge sweep: ids never leave the loop, amounts are not read.
  let count = 0;
  let startingAfter: string | undefined;
  for (let page = 0; page < CHARGE_COUNT_CAP / 100; page++) {
    const params: Record<string, string> = {
      'created[gte]': String(createdGteUnix),
      limit: '100',
    };
    if (startingAfter) params.starting_after = startingAfter;
    const chErr: { status?: number; message?: string } = {};
    const res = await stripeGetJson(key, 'charges', params, chErr);
    if (!res) {
      row.charges_error = `${chErr.status ?? ''} ${chErr.message ?? 'error'}`.trim();
      return row;
    }
    const data = (res.data as { id?: string }[] | undefined) ?? [];
    count += data.length;
    if (!res.has_more || data.length === 0) {
      row.charges_60d = count;
      row.suspect = !!row.account_id && count === 0 && (directStays ?? 0) > 0;
      return row;
    }
    startingAfter = data[data.length - 1]?.id;
  }
  row.charges_60d = count;
  row.charges_capped = true;
  return row;
}

/** Same RT-Stripe channel predicate the statement pipeline uses: VRBO /
 *  HomeAway / Manual / Direct are the channels whose money moves through
 *  the property's own Stripe account. */
function isRtStripeChannel(channel: string | null): boolean {
  const c = String(channel || '').toUpperCase();
  return c.includes('HOMEAWAY') || c === 'VRBO' || c === 'MANUAL' || c === 'DIRECT';
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const onlyPropertyId = (searchParams.get('property_id') || '').trim();

  const keys = getStripeKeysMap();
  const entries = Object.entries(keys).filter(
    ([id]) => !onlyPropertyId || id === onlyPropertyId,
  );
  const ids = entries.map(([id]) => id);

  const cutoffMs = Date.now() - WINDOW_DAYS * 86400000;
  const cutoffIso = new Date(cutoffMs).toISOString().slice(0, 10);

  // Direct/VRBO stays per property, one query for the whole run. Channel
  // values are normalized at write time ('Direct'/'VRBO'), but CSV-fallback
  // rows can carry raw Guesty spellings, so the filter runs in memory with
  // the same predicate the statements pipeline uses.
  const directStaysByProp = new Map<string, number>();
  let staysReadable = false;
  if (isConfigured && ids.length > 0) {
    try {
      const stays = await selectAllPaged<{ property_id: string; channel: string | null }>(
        (from, to) =>
          supabase
            .from('guesty_reservations')
            .select('property_id, channel')
            .in('property_id', ids)
            .eq('status', 'confirmed')
            .gte('check_in', cutoffIso)
            .order('confirmation_code', { ascending: true })
            .range(from, to),
        { label: 'stripe account check: direct stays' },
      );
      for (const s of stays) {
        if (!isRtStripeChannel(s.channel)) continue;
        directStaysByProp.set(s.property_id, (directStaysByProp.get(s.property_id) ?? 0) + 1);
      }
      staysReadable = true;
    } catch {
      // A failed read degrades to direct_stays: null (unknown), never to 0:
      // zero is what arms the suspect flag's "no stays, no worry" side.
      staysReadable = false;
    }
  }

  const properties = await Promise.all(
    entries.map(([propertyId, key]) =>
      checkOneKey(
        propertyId,
        key,
        Math.floor(cutoffMs / 1000),
        staysReadable ? (directStaysByProp.get(propertyId) ?? 0) : null,
      ),
    ),
  );
  properties.sort((a, b) => a.property_id.localeCompare(b.property_id));

  return NextResponse.json({
    ok: true,
    window_days: WINDOW_DAYS,
    checked_at: new Date().toISOString(),
    properties,
    // sk_ pastes are refused by perPropertyKeyVars, so the property shows up
    // as "no key" above. Naming them here makes the wrong-key-KIND paste
    // visible too.
    refused_secret_key_ids: refusedSecretKeyVars(),
  });
}
