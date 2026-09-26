import { listSeamThermostatsSafe } from '@/lib/climate';
import { ClimatePanel } from './ClimatePanel';
import type { ClimateProfile } from '@/lib/climate';

/**
 * Fetches the Seam thermostat list for the climate panel.
 *
 * `ClimatePanel` is a client component, so it cannot do this itself; the
 * property page used to fetch the list in its own `Promise.all`. That put a
 * fleet-wide call to Seam's API on the critical path of every arrival at
 * every property, to populate a device picker inside a section that renders
 * collapsed on the Operations tab.
 *
 * Rendered inside a Suspense boundary, so the page no longer waits for Seam
 * to answer. The call is also bounded now (see seamGet): it previously
 * caught errors without ever setting a deadline, which made an unanswered
 * request indistinguishable from a slow page.
 */
export async function ClimatePanelLoader({
  propertyId,
  profile,
}: {
  propertyId: string;
  profile: ClimateProfile | null;
}) {
  const thermostats = await listSeamThermostatsSafe();
  return <ClimatePanel propertyId={propertyId} profile={profile} thermostats={thermostats} />;
}
