/**
 * The DB fleet, for every surface that used to enumerate the 15-entry
 * PROPERTIES const in src/lib/properties.ts.
 *
 * The const is the statements pipeline's roster and stays where it is (it is
 * in the payout hands-off zone). Everything else, Channels list pages, /book,
 * the marketing memory, campaign context, should read the registry, because
 * a home promoted from the prospect funnel (7 Sumac, 36 Granite, 79 Main,
 * 16 Waterman, 4 Middle) or inserted by hand (65 Calderwood) exists only
 * there.
 *
 * Service role: properties has an anon SELECT policy, but the callers are all
 * server components and actions, and the service-role singleton fails loudly
 * when unconfigured instead of silently reading zero rows.
 */
import 'server-only';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';
import type { CalendarAuthority } from '@/lib/property-scope';

export type FleetProperty = {
  id: string;
  name: string;
  title: string | null;
  address: string;
  city: string;
  region: string;
  calendar_authority: CalendarAuthority;
  cutover_at: string | null;
  automations_enabled: boolean;
  is_active: boolean;
  kind: string;
  is_rising_tide_owned: boolean;
  ical_export_token: string | null;
  guesty_listing_id: string | null;
  former_guesty_listing_id: string | null;
  timezone: string;
  default_checkin_time: string | null;
  default_checkout_time: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
};

export const FLEET_COLS =
  'id, name, title, address, city, region, calendar_authority, cutover_at, automations_enabled, is_active, kind, is_rising_tide_owned, ical_export_token, guesty_listing_id, former_guesty_listing_id, timezone, default_checkin_time, default_checkout_time, bedrooms, bathrooms';

type Raw = Omit<FleetProperty, 'region' | 'calendar_authority' | 'automations_enabled' | 'is_active' | 'kind' | 'is_rising_tide_owned' | 'timezone'> & {
  region: string | null;
  calendar_authority: string | null;
  automations_enabled: boolean | null;
  is_active: boolean | null;
  kind: string | null;
  is_rising_tide_owned: boolean | null;
  timezone: string | null;
};

function shape(r: Raw): FleetProperty {
  return {
    ...r,
    region: r.region ?? 'cape_ann',
    calendar_authority: r.calendar_authority === 'helm' ? 'helm' : 'guesty',
    automations_enabled: !!r.automations_enabled,
    is_active: r.is_active !== false,
    kind: r.kind ?? 'managed',
    is_rising_tide_owned: !!r.is_rising_tide_owned,
    timezone: r.timezone ?? 'America/New_York',
  };
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * Every registry home, ordered so street numbers read naturally ("3 Locust,
 * 3 South, 4 Brier Neck, 17 Beach ..." rather than the lexical "17, 20, 3").
 * Defaults to active managed homes; pass includeInactive / a region / an
 * authority to widen or narrow.
 */
export async function listFleetProperties(opts: {
  includeInactive?: boolean;
  region?: string;
  calendarAuthority?: CalendarAuthority;
  kinds?: string[];
} = {}): Promise<FleetProperty[]> {
  if (!isServiceConfigured) return [];
  const rows = await selectAllPaged<Raw>(
    (from, to) => {
      let q = supabaseAdmin.from('properties').select(FLEET_COLS).order('id', { ascending: true }).range(from, to);
      if (!opts.includeInactive) q = q.eq('is_active', true);
      if (opts.region) q = q.eq('region', opts.region);
      if (opts.calendarAuthority) q = q.eq('calendar_authority', opts.calendarAuthority);
      q = q.in('kind', opts.kinds ?? ['managed']);
      return q;
    },
    { label: 'fleet' },
  );
  return rows.map(shape).sort((a, b) => collator.compare(a.name, b.name));
}

export async function getFleetProperty(id: string): Promise<FleetProperty | null> {
  if (!isServiceConfigured || !id) return null;
  const { data, error } = await supabaseAdmin.from('properties').select(FLEET_COLS).eq('id', id).maybeSingle();
  if (error || !data) return null;
  return shape(data as Raw);
}

/** id -> name for label lookups, one query. */
export async function fleetNameMap(opts: { includeInactive?: boolean } = {}): Promise<Map<string, string>> {
  const rows = await listFleetProperties({ includeInactive: opts.includeInactive ?? true, kinds: ['managed', 'hq', 'prospect'] });
  return new Map(rows.map((r) => [r.id, r.name]));
}
