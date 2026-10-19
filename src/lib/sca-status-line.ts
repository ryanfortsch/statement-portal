/**
 * The Stay Cape Ann line at the top of the property page's Guest & listing
 * tab: what it says, its tone, and where it links. Pure, so the cases that
 * have bitten are tested (sca-status-line.test.ts).
 *
 *   - On the site is the site's own registry (src/lib/sca-live.ts, the
 *     launcher's check). A home listed before Helm tracked launches has no
 *     launch record and is still Live, with a link to the listing, never
 *     "Launch it" (21 Horton, 10/19).
 *   - A live listing in demo mode takes bookings that collect nothing (84
 *     Thatcher: four bookings, $41,917, no payment path), so it never reads
 *     as a plain Live; a failed snapshot refresh says so too.
 *   - When the registry cannot be read, the line says so: absence is not a
 *     fact.
 */
import { scaListingUrl } from './sca-config.ts';

export type ScaLaunchFacts = {
  status: string;
  live_url: string | null;
  payment_verify_signal: string | null;
  snapshot_refresh_error: string | null;
} | null;

export type ScaRegistryCheck = { known: boolean; entry: Record<string, unknown> | null };

export type ScaStatusLine = {
  text: string;
  tone: 'positive' | 'negative' | 'signal' | 'muted';
  /** The live listing on staycapeann.com, when the home is on the site. */
  listingUrl: string | null;
  /** The launcher link's words. */
  verb: 'Open the launcher' | 'Launch it';
};

export function scaStatusLine(launch: ScaLaunchFacts, check: ScaRegistryCheck, listingId: string): ScaStatusLine {
  const launchLive = launch?.status === 'live';
  const live = check.entry != null || (!check.known && launchLive);
  const demo = live && launchLive && launch?.payment_verify_signal === 'demo_mode';
  const stale = live && !demo && launchLive && !!launch?.snapshot_refresh_error;
  const review = !live && launch?.status === 'pr_open';
  const unknown = !live && !review && !check.known;
  const text = demo
    ? 'Live, but bookings collect nothing: the last payment check found demo mode'
    : stale
      ? 'Live; the last refresh failed, so the page may be stale'
      : live
        ? 'Live on staycapeann.com'
        : review
          ? 'Launch in review'
          : unknown
            ? 'Could not check staycapeann.com'
            : 'Not on staycapeann.com yet';
  const tone = demo ? 'negative' : stale || review || unknown ? 'signal' : live ? 'positive' : 'muted';
  const id = listingId.trim();
  const listingUrl = live ? launch?.live_url || (id ? scaListingUrl(id) : null) : null;
  return { text, tone, listingUrl, verb: live || review || unknown ? 'Open the launcher' : 'Launch it' };
}
