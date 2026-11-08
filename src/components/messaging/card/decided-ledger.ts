/**
 * One ledger under every inbox queue: Decided recently. It used to sit beside
 * a second one, Follow-up history (7 days of resolved messages that filed
 * work, a note or a schedule change), which printed the same decisions again
 * with a different title, twice on the Team inbox at All (audit 2026-11-07).
 *
 * Now a Decided recently row carries what its message filed, on one "Filed"
 * line. A handled card keeps its Undo; a sent reply that filed something
 * joins the ledger without one (sending is not undone from here). Pure, so
 * the merge is pinned by decided-ledger.test.ts.
 */

import type { MessageOutcomes } from '@/lib/message-outcomes';
import type { RecentFollowup } from '@/lib/recent-followups';

export type DecidedRow = {
  id: string;
  status: string;
  name: string;
  property?: string;
  /** What they wrote, one line. */
  quote?: string;
  at?: string | null;
  decidedBy?: string;
  /** Whose card, on a mixed ledger (the Team inbox). */
  audience?: string;
  /** What this message filed (work, notes, a schedule change). */
  outcomes?: MessageOutcomes;
  /** False for a row that only the follow-ups brought in: nothing to undo. */
  undoable?: boolean;
};

/** The concierge's follow-up feeds, by inbox. */
export type FollowupAudience = 'guests' | 'owners' | 'cleaners' | 'contractors';

/** A resolved message that filed something, tagged with its card audience. */
export type LedgerFollowup = RecentFollowup & { audience?: string };

/** What the ledger's Filed lines start from (loadFollowupFeed, server side);
 *  the ledger then polls /api/messaging/followups for the same audiences. */
export type FollowupFeed = { audiences: FollowupAudience[]; initial: LedgerFollowup[]; error: boolean };

/** The card audience a feed's rows undo through (the Team inbox mixes two). */
export const CARD_AUDIENCE: Record<FollowupAudience, string | undefined> = {
  guests: undefined,
  owners: undefined,
  cleaners: 'cleaner',
  contractors: 'contractor',
};

export function hasFiled(outcomes?: MessageOutcomes): boolean {
  return !!outcomes && !!(outcomes.schedule || outcomes.work.length || outcomes.notes.length || outcomes.error);
}

/**
 * Decided rows first matched to their follow-ups by id (and audience on a
 * mixed ledger); a follow-up with no decided row becomes its own row, with
 * no Undo. Newest first.
 */
export function mergeDecidedLedger(decided: DecidedRow[], followups: LedgerFollowup[]): DecidedRow[] {
  const key = (id: string, audience?: string) => `${audience || ''}:${id}`;
  const byKey = new Map(followups.map((f) => [key(f.id, f.audience), f]));
  const rows: DecidedRow[] = decided.map((row) => {
    const match = byKey.get(key(row.id, row.audience));
    if (!match) return row;
    byKey.delete(key(row.id, row.audience));
    return { ...row, outcomes: match.outcomes };
  });
  for (const f of byKey.values()) {
    rows.push({
      id: f.id,
      status: f.replyStatus,
      name: f.who,
      property: f.property || undefined,
      quote: f.sourceText,
      at: f.resolvedAt,
      audience: f.audience,
      outcomes: f.outcomes,
      undoable: false,
    });
  }
  return rows.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}
