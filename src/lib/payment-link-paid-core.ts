/** Read every page before treating a payment link as unpaid. No financial writes. */
export type CheckoutSession = {
  id: string;
  payment_status: string;
  created?: number;
  customer?: string | null;
  payment_intent?: { payment_method?: string | null } | string | null;
};
export type SessionScan = { ok: true; session: CheckoutSession | null; seen: number } | { ok: false; seen: number };

export async function scanPaidSessions(
  readPage: (after?: string) => Promise<unknown>,
  maxPages = 10,
): Promise<SessionScan> {
  let after: string | undefined;
  let seen = 0;
  const cursors = new Set<string>();
  for (let page = 0; page < maxPages; page++) {
    let raw: unknown;
    try { raw = await readPage(after); } catch { return { ok: false, seen }; }
    if (!raw || typeof raw !== 'object') return { ok: false, seen };
    const result = raw as { data?: unknown; has_more?: unknown };
    if (!Array.isArray(result.data) || typeof result.has_more !== 'boolean') return { ok: false, seen };
    const rows = result.data as CheckoutSession[];
    if (rows.some(s => !s || typeof s.id !== 'string' || !s.id || !['paid', 'unpaid', 'no_payment_required'].includes(s.payment_status))) return { ok: false, seen };
    seen += rows.length;
    const paid = rows.find(s => s.payment_status === 'paid');
    if (paid) return { ok: true, session: paid, seen };
    if (!result.has_more) return { ok: true, session: null, seen };
    const cursor = rows.at(-1)?.id;
    if (!cursor || cursors.has(cursor)) return { ok: false, seen };
    cursors.add(cursor);
    after = cursor;
  }
  return { ok: false, seen };
}

export function paidReceipt(stored: string | null | undefined, session?: CheckoutSession | null): string {
  if (stored) return stored;
  return session?.payment_status === 'paid' && session.created
    ? new Date(session.created * 1000).toISOString() : '';
}
