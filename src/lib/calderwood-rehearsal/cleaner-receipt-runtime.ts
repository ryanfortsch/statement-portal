/** Explicit rehearsal configuration. Never reuse production credentials or the live Quo key. */
import { createCleanerDeliveryDb } from './cleaner-delivery-db.ts';
import { createCleanerReceiptInboxDb } from './cleaner-receipt-inbox.ts';
type Environment = Record<string, string | undefined>;
export type ReceiptRuntimeKind = 'preview' | 'worker';
export function cleanerReceiptsEnabled(env: Environment, kind: ReceiptRuntimeKind) {
  if (env.CHANNEX_CLEANER_RECEIPTS_ENABLED !== 'true') return false;
  const storage = env.CHANNEX_STAGING_DB_PROJECT_REF === 'jgkblfozftcvymvwhhii'
    && env.CHANNEX_STAGING_DB_URL === 'https://jgkblfozftcvymvwhhii.supabase.co';
  return storage && (kind === 'preview'
    ? env.CHANNEX_STAGING_ENABLED === 'true' && env.VERCEL_ENV === 'preview'
      && env.VERCEL_GIT_COMMIT_REF === 'codex/channex-staging-pilot'
    : env.CHANNEX_WORKER_MODE === 'isolated-staging' && !env.VERCEL_ENV);
}
export function cleanerReceiptTestKey(env: Environment) {
  const key = env.CHANNEX_CLEANER_RECEIPT_TEST_SIGNING_KEY;
  if (!key || !/^[A-Za-z0-9+/]+={0,2}$/.test(key) || Buffer.from(key, 'base64').length < 32
      || Buffer.from(key, 'base64').toString('base64') !== key) throw Error('Rehearsal signing key unavailable');
  return key;
}
export function createCleanerReceiptRuntime(env: Environment, kind: ReceiptRuntimeKind,
  signal?: AbortSignal, fetcher: typeof fetch = fetch) {
  if (!cleanerReceiptsEnabled(env, kind) || !env.CHANNEX_STAGING_DB_SERVICE_KEY?.trim()) {
    throw Error('Explicit rehearsal storage unavailable');
  }
  const boundedFetch: typeof fetch = (input, init) => fetcher(input, { ...init,
    signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : []), ...(init?.signal ? [init.signal] : [])]),
  });
  return {
    inbox: createCleanerReceiptInboxDb(env.CHANNEX_STAGING_DB_URL!, env.CHANNEX_STAGING_DB_SERVICE_KEY, boundedFetch),
    delivery: createCleanerDeliveryDb(env.CHANNEX_STAGING_DB_URL!, env.CHANNEX_STAGING_DB_SERVICE_KEY, boundedFetch),
  };
}
