import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  QUOTE_COLUMNS,
  MAX_QUOTES,
  buildQuoteFilter,
  collectQuoteKeys,
  groupQuotesByApproval,
  type GuestQuoteContext,
  type QuoteKeyed,
  type QuoteRow,
} from '@/lib/guest-quote-context-core';

export type { CardQuote, CardQuoteBlock, GuestQuoteContext } from '@/lib/guest-quote-context-core';

/**
 * A guest's Stay Cape Ann quotes, keyed by the messaging card they belong to.
 *
 * The two modules did not talk. /guests/quotes could be opened FROM a
 * pre-release card, and the quote kept a `source_ref` pointing back, but that
 * pointer only ever surfaced as a debug line on the quote's own detail page.
 * From the queue's side a guest with two live quotes looked identical to one
 * with none, so the operator answered a pricing thread with no idea what had
 * already been quoted (Dotti, 2026-09-21: "are these quotes integrated with
 * the messaging?").
 *
 * This is the I/O half; the filter and the matching live in
 * `guest-quote-context-core` so they can be tested without a database.
 *
 * Read-only, and service-role because sca_quotes is RLS-locked with no anon
 * policies. It degrades to {} on ANY failure: the queue is the point of the
 * page, and a card must render when this does not.
 */
export async function loadGuestQuoteContext(approvals: QuoteKeyed[]): Promise<GuestQuoteContext> {
  const { emails, refs } = collectQuoteKeys(approvals);
  const filter = buildQuoteFilter(emails, refs);
  // Nothing to join on. An all-OTA queue lands here, so it must not cost a
  // query.
  if (!filter) return {};

  let rows: QuoteRow[] = [];
  try {
    const { data, error } = await supabaseAdmin
      .from('sca_quotes')
      .select(QUOTE_COLUMNS)
      .or(filter)
      .is('voided_at', null)
      .order('check_in', { ascending: true })
      .limit(MAX_QUOTES);
    if (error) return {};
    rows = (data ?? []) as unknown as QuoteRow[];
  } catch {
    return {};
  }
  if (rows.length === 0) return {};
  return groupQuotesByApproval(rows, approvals);
}
