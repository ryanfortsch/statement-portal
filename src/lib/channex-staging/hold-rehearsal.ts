export type PersistentHoldState = {
 status: 'held' | 'scheduled'; updatedAt: string; fireAt: string;
 events: { id: number; action: 'hold' | 'release'; happened_at: string }[];
};
export function persistentHoldEnvironment(env: Record<string, string | undefined>) {
 return env.CHANNEX_STAGING_ENABLED === 'true' && env.VERCEL_ENV === 'preview'
  && env.VERCEL_GIT_COMMIT_REF === 'codex/channex-staging-pilot'
  && env.CHANNEX_STAGING_DB_PROJECT_REF === 'jgkblfozftcvymvwhhii'
  && env.CHANNEX_STAGING_DB_URL === 'https://jgkblfozftcvymvwhhii.supabase.co';
}
export function validPersistentHoldRequest(body: unknown): body is { hold: boolean; expectedUpdatedAt: string } {
 if (!body || typeof body !== 'object') return false;
 const value = body as Record<string, unknown>;
 return typeof value.hold === 'boolean' && typeof value.expectedUpdatedAt === 'string'
  && value.expectedUpdatedAt.length < 80 && Number.isFinite(Date.parse(value.expectedUpdatedAt));
}
