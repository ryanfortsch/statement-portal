import 'server-only';
import { ChannexStagingClient } from './client';
import { readParentCalendar } from './parent-calendar';
import { buildBoardReport, stagingBoardEnabled, type BoardSource } from './board';

export async function loadStagingBoard() {
  // Callers authenticate first. This guard also prevents accidental production use.
  if (!stagingBoardEnabled(process.env)) throw new Error('Staging workspace is disabled');
  const key = process.env.CHANNEX_STAGING_API_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const results = await Promise.allSettled([
    key ? new ChannexStagingClient(key).readSnapshot() : Promise.resolve(null),
    url && serviceKey ? readParentCalendar({ url, key: serviceKey }) : Promise.resolve(null),
  ]);
  const [channexResult, parentResult] = results;
  const snapshot = channexResult.status === 'fulfilled' ? channexResult.value : null;
  const parent = parentResult.status === 'fulfilled' ? parentResult.value : null;
  const channexSource: BoardSource = !key
    ? { state: 'unconfigured', message: 'The Channex staging key is not configured in this environment.' }
    : !snapshot ? { state: 'failed', message: 'Channex could not be verified. Check the staging connection, property mappings and stop-sell settings.' }
    : { state: 'ready', message: 'Current test bookings and inventory read from Channex staging.' };
  const parentSource: BoardSource = !url || !serviceKey
    ? { state: 'unconfigured', message: 'This environment has no connection to Helm’s whole-house calendar copy.' }
    : !parent ? { state: 'failed', message: 'The whole-house calendar could not be verified. Check its Guesty mapping, authority and calendar sync.' }
    : { state: 'ready', message: 'Existing Guesty calendar copy, read from Helm. Each night is checked for missing or stale data.' };
  return buildBoardReport(snapshot, parent, { channex: channexSource, parent: parentSource });
}
