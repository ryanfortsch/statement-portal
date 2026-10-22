/** The Guesty token cache belongs to the existing source connection. Changing
 * the pilot calendar database must not pair its URL with the live cache key.
 * This resolves only the token-cache client, never the ordinary application DB.
 */
export function guestyAuthDatabaseConfig(env: {
  publicUrl?: string; serviceRoleKey?: string; isolatedCalendarEnabled?: string;
  vercelEnv?: string; branch?: string; guestyAuthCacheUrl?: string;
}): { url: string; serviceKey: string } {
  if (env.isolatedCalendarEnabled !== 'true') return { url: env.publicUrl || '', serviceKey: env.serviceRoleKey || '' };
  if (env.vercelEnv !== 'preview' || env.branch !== 'codex/channex-staging-pilot' ||
      env.publicUrl !== 'https://jgkblfozftcvymvwhhii.supabase.co' ||
      env.guestyAuthCacheUrl !== 'https://qjueexujiuticjrtqdyj.supabase.co' || !env.serviceRoleKey?.trim()) {
    throw Error('Guesty source token cache is not configured for the isolated preview');
  }
  // Reuse the inherited credential in the server process. Never copy it to the
  // isolated database, public configuration, a response or a new credential slot.
  return { url: env.guestyAuthCacheUrl, serviceKey: env.serviceRoleKey };
}
