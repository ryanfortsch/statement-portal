/** Pure configuration guard. Secrets stay in the existing deployment environment. */
export type ServerDatabaseEnvironment = {
  publicUrl?: string;
  serviceRoleKey?: string;
  isolatedCalendarEnabled?: string;
  stagingUrl?: string;
  stagingServiceKey?: string;
  vercelEnv?: string;
  branch?: string;
};

const ISOLATED_URL = 'https://jgkblfozftcvymvwhhii.supabase.co';
const PILOT_BRANCH = 'codex/channex-staging-pilot';

/**
 * The ordinary app and the staging worker must read the same isolated database
 * during the full-app rehearsal. Reuse the already provisioned server secret;
 * never export it, put it in NEXT_PUBLIC configuration, or fall back to the live
 * credential when the isolated binding is incomplete. Google auth is unchanged.
 * The explicit flag is deployment-scoped, not a request/cookie/query option.
 */
export function serverDatabaseConfig(env: ServerDatabaseEnvironment): { url: string; serviceKey: string } {
  if (env.isolatedCalendarEnabled !== 'true') {
    return { url: env.publicUrl || '', serviceKey: env.serviceRoleKey || '' };
  }
  if (env.vercelEnv !== 'preview' || env.branch !== PILOT_BRANCH) {
    throw new Error('Isolated calendar database requires the approved pilot preview branch.');
  }
  if (env.publicUrl !== ISOLATED_URL || env.stagingUrl !== ISOLATED_URL) {
    throw new Error('Isolated calendar database requires matching isolated public and server URLs.');
  }
  if (!env.stagingServiceKey?.trim()) {
    throw new Error('Isolated calendar database credential is not configured.');
  }
  return { url: ISOLATED_URL, serviceKey: env.stagingServiceKey };
}
