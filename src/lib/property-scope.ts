/**
 * The single definition of property scope.
 *
 * Three registry columns decide where a home shows up and who runs it:
 *
 *   properties.region              the OPS scope. Cape Ann crew surfaces
 *                                  (turnover rail, cleaner digest, Field
 *                                  packets, inspections roster, the A-1
 *                                  vendor schedule) show region = cape_ann
 *                                  only. Ryan's out-of-region homes (65
 *                                  Calderwood in Bridgeport CT, 3246 NE 27th
 *                                  in Lighthouse Point FL) carry their own
 *                                  region and stay out of those surfaces
 *                                  without a hardcoded id anywhere.
 *   properties.calendar_authority  the CUTOVER switch. 'guesty' means Guesty
 *                                  runs the calendar and Helm mirrors it;
 *                                  'helm' means Helm is authoritative and
 *                                  every Guesty pass skips the home.
 *   properties.kind                'partner' is a home its own host runs and
 *                                  lists on staycapeann.com. It is never
 *                                  Cape Ann ops, and Helm never answers its
 *                                  guests (isPartnerHome, runsGuestsInHelm).
 *
 * Before this module existed the exclusion lived as literal id sets in four
 * files (operations.ts, field-packets.ts, checkout-schedule.ts, the turnovers
 * page) plus two ad hoc filters over the code roster. Editing one and not the
 * others silently desynchronised the turnover rail, the cleaner digest and
 * the Field module. The regression test in property-scope.test.ts scans
 * those files for the literal ids so the sets cannot creep back.
 *
 * Not to be confused with properties.market, the AirDNA comp market from the
 * prospect funnel (gloucester / rockport / beverly).
 *
 * Pure: no imports, so it is safe in client components and node:test.
 */

export const CAPE_ANN_REGION = 'cape_ann';

export type CalendarAuthority = 'guesty' | 'helm';

/** The columns a scope decision needs. Select them with SCOPE_COLS. */
export type ScopedProperty = {
  id: string;
  region?: string | null;
  calendar_authority?: string | null;
  is_active?: boolean | null;
  kind?: string | null;
  is_rising_tide_owned?: boolean | null;
};

/** Append to a properties select so the row satisfies ScopedProperty. */
export const SCOPE_COLS = 'id, region, calendar_authority, is_active, kind, is_rising_tide_owned';

/** Static labels, the fallback when the regions table is not loaded. */
export const REGION_LABELS: Record<string, string> = {
  cape_ann: 'Cape Ann',
  bridgeport_ct: 'Bridgeport, CT',
  lighthouse_point_fl: 'Lighthouse Point, FL',
};

/**
 * properties.kind for a partner home: a Cape Ann home listed on
 * staycapeann.com and run by its own host. Rising Tide does not clean it,
 * inspect it, message its guests, bill it or pay it out. A partner row is
 * always is_active = false (a database constraint holds it), the same ride
 * prospect and HQ rows take, so every surface that filters is_active skips
 * it. The booking path opts partner homes in deliberately; nothing else may.
 * partner-homes.test.ts holds the readers of the properties table to that.
 */
export const PARTNER_KIND = 'partner';

/** A home listed on staycapeann.com that its own host runs. */
export function isPartnerHome(p: Pick<ScopedProperty, 'kind'>): boolean {
  return p.kind === PARTNER_KIND;
}

/**
 * Does the Cape Ann crew run operations at this home? A null or missing
 * region reads as Cape Ann: an older select that never asked for the column
 * must not hide a home from the turnover rail. A partner home is in Cape Ann
 * but the crew never works it, so it is never Cape Ann ops.
 */
export function isCapeAnnOps(p: Pick<ScopedProperty, 'region'> & { kind: string | null | undefined }): boolean {
  return (p.region ?? CAPE_ANN_REGION) === CAPE_ANN_REGION && !isPartnerHome(p);
}

/** Helm is the calendar authority for this home (the flip has happened). */
export function isHelmRun(p: Pick<ScopedProperty, 'calendar_authority'>): boolean {
  return p.calendar_authority === 'helm';
}

/**
 * Helm runs this home's guests: its calendar AND its guest messaging,
 * automations and inbox. A partner home is Helm-run in the calendar sense
 * (Helm holds its calendar for staycapeann.com, so every Guesty pass skips
 * it), but its host talks to its guests, never us. Use isHelmRun for "skip
 * it in Guesty"; use this for "we answer its guests".
 */
export function runsGuestsInHelm(p: Pick<ScopedProperty, 'calendar_authority' | 'kind'>): boolean {
  return isHelmRun(p) && !isPartnerHome(p);
}

/** Guesty still runs the calendar (the default, and shadow mode). */
export function isGuestyRun(p: Pick<ScopedProperty, 'calendar_authority'>): boolean {
  return !isHelmRun(p);
}

/** The ids of every Cape Ann ops home in a loaded roster. */
export function capeAnnIds<T extends Pick<ScopedProperty, 'id' | 'region'> & { kind: string | null | undefined }>(rows: readonly T[]): Set<string> {
  return new Set(rows.filter(isCapeAnnOps).map((r) => r.id));
}

/** The ids of every Helm-run home in a loaded roster. */
export function helmRunIds<T extends Pick<ScopedProperty, 'id' | 'calendar_authority'>>(rows: readonly T[]): Set<string> {
  return new Set(rows.filter(isHelmRun).map((r) => r.id));
}

export function regionLabel(region: string | null | undefined): string {
  const key = region ?? CAPE_ANN_REGION;
  return REGION_LABELS[key] ?? key;
}
