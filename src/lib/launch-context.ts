import 'server-only';
import { supabaseAdmin as supabase, isServiceConfigured } from '@/lib/supabase-admin';
import { PROPERTIES, type HelmPropertyRow } from '@/lib/properties';
import { loadInvoiceNeedles } from '@/lib/invoice-property-match';
import { selectAllPaged } from '@/lib/paged-select';
import { isHelmRun, type ScopedProperty } from '@/lib/property-scope';
import {
  resolveLaunchSteps,
  summarizeLaunch,
  type EffectiveLaunchStep,
  type LaunchDerivationContext,
  type LaunchStepRow,
  type LaunchSummary,
} from '@/lib/launch-checklist';

/**
 * The one loader behind the launch checklist's derived state.
 *
 * Three surfaces read the checklist (the launch page, the property page's
 * launch chip, and the fleet onboarding board) and they must agree to the
 * step. Before this module each page carried its own copy of the loaders
 * and the derivation context, which is how the chip and the page drifted
 * apart once (1/18 vs 5/18). Now every surface calls loadLaunchForFleet
 * (or its single-property wrapper) and resolves through the same
 * resolveLaunchSteps.
 *
 * Every read here is best-effort and degrades to "not derived" on error,
 * so a missing table on a preview env never takes a page down. The
 * consequence of a failed read is a step that asks the operator instead
 * of ticking itself, never a wrong tick.
 */

export type LaunchPropertyLite = Pick<
  HelmPropertyRow,
  | 'id'
  | 'title'
  | 'owner_full'
  | 'owner_emails'
  | 'owner_phone'
  | 'management_fee_pct'
  | 'bank_last4'
  | 'tax_cert_id'
  | 'guesty_listing_id'
  | 'is_active'
  | 'activated_at'
> &
  /** Optional: callers that already selected the scope columns pass them
   *  through; otherwise loadLaunchForFleet reads them itself. */
  Partial<Pick<ScopedProperty, 'region' | 'calendar_authority'>>;

export type LaunchFacts = {
  /** Check-in date of the earliest confirmed stay that has already begun, or null. */
  firstStayCheckIn: string | null;
  /** Confirmed stays with a check-in today or later. */
  upcomingStays: number;
};

export type LaunchLoad = {
  rows: LaunchStepRow[];
  ctx: LaunchDerivationContext;
  facts: LaunchFacts;
  effective: EffectiveLaunchStep[];
  summary: LaunchSummary;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadRows(ids: string[]): Promise<Map<string, LaunchStepRow[]>> {
  const out = new Map<string, LaunchStepRow[]>();
  if (!isServiceConfigured || ids.length === 0) return out;
  try {
    const rows = await selectAllPaged<LaunchStepRow>(
      (from, to) =>
        supabase
          .from('property_launch_steps')
          .select('*')
          .in('property_id', ids)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'launch steps' },
    );
    for (const r of rows) {
      const list = out.get(r.property_id) ?? [];
      list.push(r);
      out.set(r.property_id, list);
    }
  } catch {
    // Degrade to no rows: every step derives or asks.
  }
  return out;
}

async function loadScaStatus(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!isServiceConfigured || ids.length === 0) return out;
  try {
    const { data } = await supabase
      .from('sca_launches')
      .select('property_id, status')
      .in('property_id', ids);
    for (const r of (data ?? []) as Array<{ property_id: string; status: string | null }>) {
      if (r.status) out.set(r.property_id, r.status);
    }
  } catch {
    // no SCA table on this env
  }
  return out;
}

/** cleaner_phones rows: empty property_ids = catch-all cleaner serving every home. */
async function loadCleanerMappings(): Promise<Array<string[]>> {
  if (!isServiceConfigured) return [];
  try {
    const { data } = await supabase.from('cleaner_phones').select('property_ids').limit(500);
    return ((data ?? []) as Array<{ property_ids: string[] | null }>).map((r) => r.property_ids ?? []);
  } catch {
    return [];
  }
}

async function loadLockCounts(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!isServiceConfigured || ids.length === 0) return out;
  try {
    const { data } = await supabase.from('lock_devices').select('property_id').in('property_id', ids);
    for (const r of (data ?? []) as Array<{ property_id: string | null }>) {
      if (!r.property_id) continue;
      out.set(r.property_id, (out.get(r.property_id) ?? 0) + 1);
    }
  } catch {
    // Seam dark on this env
  }
  return out;
}

/** Property ids the invoice registry can route to (derived + explicit needles). */
async function loadInvoiceMapped(): Promise<Set<string>> {
  try {
    const needles = await loadInvoiceNeedles();
    return new Set(Object.values(needles));
  } catch {
    return new Set();
  }
}

/** Scope columns for the ids, so a caller's narrower select still gets a
 *  correct n_a derive. A failed read leaves the map empty: the derive then
 *  treats the home as a Guesty-run Cape Ann home, which asks, never lies. */
async function loadScope(ids: string[]): Promise<Map<string, Pick<ScopedProperty, 'region' | 'calendar_authority'>>> {
  const out = new Map<string, Pick<ScopedProperty, 'region' | 'calendar_authority'>>();
  if (!isServiceConfigured || ids.length === 0) return out;
  try {
    const { data } = await supabase.from('properties').select('id, region, calendar_authority').in('id', ids);
    for (const r of (data ?? []) as Array<{ id: string; region: string | null; calendar_authority: string | null }>) {
      out.set(r.id, { region: r.region, calendar_authority: r.calendar_authority });
    }
  } catch {
    // degrade to no scope
  }
  return out;
}

/**
 * Distinct non-null nightly prices over the next 60 days. For a Guesty-run
 * home that is the Guesty calendar mirror (property_calendar_days.price);
 * for a Helm-run home it is Helm's own rate calendar
 * (property_rate_days.nightly_cents, null = plan default and so not a
 * price of its own). 1 means a flat base rate on every night (the
 * listing-live-on-defaults state that underpriced 3 Windward's launch);
 * 2+ means dynamic pricing is flowing.
 *
 * Exported so the property page's onboarding context can read the same
 * number instead of carrying its own copy of the Guesty-only query.
 */
export async function loadForwardDistinctPrices(
  propertyId: string,
  opts?: { helmRun?: boolean },
): Promise<number> {
  if (!isServiceConfigured) return 0;
  try {
    const start = todayIso();
    const end = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10);
    if (opts?.helmRun) {
      const { data, error } = await supabase
        .from('property_rate_days')
        .select('nightly_cents')
        .eq('property_id', propertyId)
        .gte('date', start)
        .lt('date', end)
        .not('nightly_cents', 'is', null);
      if (error || !data) return 0;
      return new Set((data as Array<{ nightly_cents: number | string }>).map((r) => String(r.nightly_cents))).size;
    }
    const { data, error } = await supabase
      .from('property_calendar_days')
      .select('price')
      .eq('property_id', propertyId)
      .gte('date', start)
      .lt('date', end)
      .not('price', 'is', null);
    if (error || !data) return 0;
    return new Set((data as Array<{ price: number | string }>).map((r) => String(r.price))).size;
  } catch {
    return 0;
  }
}

/** Earliest confirmed stay that has already begun (canonical rows only). */
async function loadFirstStayCheckIn(propertyId: string): Promise<string | null> {
  if (!isServiceConfigured) return null;
  try {
    const { data } = await supabase
      .from('bookings')
      .select('check_in')
      .eq('property_id', propertyId)
      .eq('status', 'confirmed')
      .is('duplicate_of', null)
      .lte('check_in', todayIso())
      .order('check_in', { ascending: true })
      .limit(1);
    const first = (data ?? [])[0] as { check_in: string } | undefined;
    return first?.check_in ? String(first.check_in).slice(0, 10) : null;
  } catch {
    return null;
  }
}

async function loadUpcomingStays(propertyId: string): Promise<number> {
  if (!isServiceConfigured) return 0;
  try {
    const { count } = await supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('property_id', propertyId)
      .eq('status', 'confirmed')
      .is('duplicate_of', null)
      .gte('check_in', todayIso());
    return count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Load rows + derivation context for a set of properties in one pass. The
 * fleet-wide tables (launch rows, SCA status, cleaner phones, locks, the
 * invoice registry) are read once; the per-property calendar and booking
 * probes fan out in parallel.
 */
export async function loadLaunchForFleet(
  properties: ReadonlyArray<LaunchPropertyLite>,
): Promise<Map<string, LaunchLoad>> {
  const ids = properties.map((p) => p.id);
  // Scope first: the pricing probe needs to know which calendar to read.
  // Rows that already carry both columns skip the extra read.
  const needScope = properties.some((p) => p.region === undefined || p.calendar_authority === undefined);
  const scopeById = needScope ? await loadScope(ids) : new Map<string, Pick<ScopedProperty, 'region' | 'calendar_authority'>>();
  const scopeFor = (p: LaunchPropertyLite): Pick<ScopedProperty, 'region' | 'calendar_authority'> => {
    const read = scopeById.get(p.id);
    return {
      region: p.region !== undefined ? p.region : read?.region ?? null,
      calendar_authority: p.calendar_authority !== undefined ? p.calendar_authority : read?.calendar_authority ?? null,
    };
  };
  const [rowsById, scaById, cleanerMappings, locksById, invoiceMapped, perProperty] = await Promise.all([
    loadRows(ids),
    loadScaStatus(ids),
    loadCleanerMappings(),
    loadLockCounts(ids),
    loadInvoiceMapped(),
    Promise.all(
      properties.map(async (p) => {
        const [forwardDistinctPrices, firstStayCheckIn, upcomingStays] = await Promise.all([
          loadForwardDistinctPrices(p.id, { helmRun: isHelmRun(scopeFor(p)) }),
          loadFirstStayCheckIn(p.id),
          loadUpcomingStays(p.id),
        ]);
        return { id: p.id, forwardDistinctPrices, firstStayCheckIn, upcomingStays };
      }),
    ),
  ]);
  const perById = new Map(perProperty.map((x) => [x.id, x]));

  const out = new Map<string, LaunchLoad>();
  for (const p of properties) {
    const per = perById.get(p.id);
    const rows = rowsById.get(p.id) ?? [];
    const scope = scopeFor(p);
    const ctx: LaunchDerivationContext = {
      property: {
        title: p.title ?? null,
        owner_full: p.owner_full ?? null,
        owner_emails: p.owner_emails ?? null,
        owner_phone: p.owner_phone ?? null,
        management_fee_pct: p.management_fee_pct ?? null,
        bank_last4: p.bank_last4 ?? null,
        tax_cert_id: p.tax_cert_id ?? null,
        guesty_listing_id: p.guesty_listing_id ?? null,
        is_active: !!p.is_active,
        activated_at: p.activated_at ?? null,
        region: scope.region ?? null,
        calendar_authority: scope.calendar_authority ?? null,
      },
      scaLaunchStatus: scaById.get(p.id) ?? null,
      hasQuoCleanerMapping: cleanerMappings.some((list) => list.length === 0 || list.includes(p.id)),
      locksMapped: locksById.get(p.id) ?? 0,
      forwardDistinctPrices: per?.forwardDistinctPrices ?? 0,
      firstStayStarted: !!per?.firstStayCheckIn,
      invoiceNeedleMapped: invoiceMapped.has(p.id),
      inCodeRoster: !!PROPERTIES[p.id],
    };
    const effective = resolveLaunchSteps(rows, ctx);
    out.set(p.id, {
      rows,
      ctx,
      facts: {
        firstStayCheckIn: per?.firstStayCheckIn ?? null,
        upcomingStays: per?.upcomingStays ?? 0,
      },
      effective,
      summary: summarizeLaunch(effective),
    });
  }
  return out;
}

/** Single-property convenience over loadLaunchForFleet. */
export async function loadLaunchForProperty(p: LaunchPropertyLite): Promise<LaunchLoad> {
  const map = await loadLaunchForFleet([p]);
  const load = map.get(p.id);
  if (load) return load;
  // Unreachable in practice (the fleet loader always emits one entry per
  // input), but keep the type honest without a non-null assertion.
  const ctx: LaunchDerivationContext = {
    property: {
      title: p.title ?? null,
      owner_full: p.owner_full ?? null,
      owner_emails: p.owner_emails ?? null,
      owner_phone: p.owner_phone ?? null,
      management_fee_pct: p.management_fee_pct ?? null,
      bank_last4: p.bank_last4 ?? null,
      tax_cert_id: p.tax_cert_id ?? null,
      guesty_listing_id: p.guesty_listing_id ?? null,
      is_active: !!p.is_active,
      activated_at: p.activated_at ?? null,
      region: p.region ?? null,
      calendar_authority: p.calendar_authority ?? null,
    },
    scaLaunchStatus: null,
    hasQuoCleanerMapping: false,
    locksMapped: 0,
    forwardDistinctPrices: 0,
    firstStayStarted: false,
    invoiceNeedleMapped: false,
    inCodeRoster: !!PROPERTIES[p.id],
  };
  const effective = resolveLaunchSteps([], ctx);
  return {
    rows: [],
    ctx,
    facts: { firstStayCheckIn: null, upcomingStays: 0 },
    effective,
    summary: summarizeLaunch(effective),
  };
}
