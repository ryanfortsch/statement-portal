import type { MessageScope, MessageTarget } from './transport.ts';

const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
  ? v as Record<string, unknown> : {};
const relation = (row: Record<string, unknown>, key: string) => {
  const data = object(object(object(row.relationships)[key]).data);
  return data.type === key ? data.id : undefined;
};

/** One identity contract for the read-only review and the dispatch-time check.
 * Inquiry threads without a booking are never usable reservation destinations. */
export function inspectMessageThreadIdentity(raw: unknown, scope: MessageScope, target: MessageTarget, requireOpen: boolean) {
  const row = object(raw), attrs = object(row.attributes);
  if (row.id !== target.threadId || row.type !== 'message_thread'
    || relation(row, 'property') !== scope.propertyId || relation(row, 'channel') !== scope.channelId
    || relation(row, 'booking') !== target.bookingId || attrs.provider !== scope.provider
    || typeof attrs.is_closed !== 'boolean') return 'target_mismatch' as const;
  if (requireOpen && attrs.is_closed) return 'thread_closed' as const;
  return null;
}
