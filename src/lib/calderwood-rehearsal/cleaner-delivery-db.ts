/** Fixed synthetic fixture in the isolated staging project. No send capability. */
import { createClient } from '@supabase/supabase-js';
import { parse, record, type DeliveryRecord } from './cleaner-delivery-history.ts';
export function createCleanerDeliveryDb(url: string, key: string, fetcher: typeof fetch = fetch) {
  if (typeof window !== 'undefined' || url !== 'https://jgkblfozftcvymvwhhii.supabase.co' || !key.trim()) {
    throw Error('Explicit isolated staging storage required');
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher } });
  const read = async () => {
    const { data, error } = await db.rpc('helm_pilot_cleaner_delivery_read');
    if (error || !data) throw Error('Cleaner delivery history unavailable');
    const verified = parse(data);
    if (verified.envelope.messageId !== 'HELMTEST-cleaner-message'
        || JSON.stringify(verified.envelope.recipientIds) !== JSON.stringify(['HELMTEST-cleaner-a', 'HELMTEST-cleaner-b'])) {
      throw Error('Unexpected cleaner fixture identity');
    }
    return verified;
  };
  return {
    async read() { return (await read()).state; },
    async append(expectedVersion: number, incoming: DeliveryRecord) {
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw Error('Invalid delivery version');
      const item = record(incoming);
      const current = await read();
      if (current.state.version !== expectedVersion) throw Error('Delivery version changed; reload and reconcile');
      const duplicate = current.envelope.records.find(r => r.id === item.id);
      if (duplicate) {
        if (JSON.stringify(duplicate) !== JSON.stringify(item)) throw Error('Conflicting delivery event identity');
        return { appended: false, state: current.state, canSend: false as const };
      }
      const next = parse({ ...current.envelope, records: [...current.envelope.records, item], version: expectedVersion + 1 });
      // No retry: a network error may follow a committed database transaction.
      const { data, error } = await db.rpc('helm_pilot_cleaner_delivery_append', {
        expected_version: expectedVersion, next_history: next.envelope,
      });
      if (error || typeof data !== 'boolean') throw Error('Cleaner delivery save uncertain; reload and reconcile');
      if (!data) throw Error('Delivery version changed; reload and reconcile');
      return { appended: true, state: next.state, canSend: false as const };
    },
  };
}
