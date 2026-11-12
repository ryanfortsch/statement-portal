import { z } from 'zod';
import { inspectMessageThreadIdentity } from './thread-identity.ts';
import type { MessageScope } from './transport.ts';

/** Complete bounded listing, twice at the caller. Never infer a thread from an
 * inquiry, a partial page, a title or guest name. Discard message content. */
export async function discoverBookingThread(read: (path: string, maxBytes: number) => Promise<unknown>,
  scope: MessageScope, bookingId: string) {
  const seen = new Set<string>(); let total: number | undefined, match: string | undefined;
  for (let page = 1; page <= 5; page++) {
    const params = new URLSearchParams({ 'pagination[page]': String(page), 'pagination[limit]': '100' });
    const result = z.object({ data: z.array(z.unknown()).max(100), meta: z.object({
      page: z.literal(page), limit: z.number().int().min(1).max(100), total: z.number().int().min(0).max(500),
    }) }).parse(await read(`/message_threads?${params}`, 1_048_576));
    if (total !== undefined && result.meta.total !== total) throw Error('Thread listing changed');
    total = result.meta.total;
    if (result.data.length !== Math.min(result.meta.limit, total - seen.size)) throw Error('Incomplete thread listing');
    for (const raw of result.data) {
      const row = z.object({ id: z.uuid(), type: z.literal('message_thread') }).parse(raw);
      if (seen.has(row.id)) throw Error('Duplicate thread'); seen.add(row.id);
      if (inspectMessageThreadIdentity(raw, scope, { bookingId, threadId: row.id }, true) === null) {
        if (match) throw Error('Ambiguous thread'); match = row.id;
      }
    }
    if (seen.size === total) { if (!match) throw Error('Booking thread unavailable'); return match; }
  }
  throw Error('Thread listing limit');
}
