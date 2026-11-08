'use client';

import { DecidedRecently, type DecidedRow } from '@/components/messaging/card/DecidedRecently';
import type { FollowupFeed } from '@/components/messaging/card/decided-ledger';
import { undoCleanerDecision } from '@/app/cleaner-messaging/actions';
import { undoContractorDecision } from '@/app/contractor-messaging/actions';

/** Decided recently for the Team inbox: one ledger, each row undone by its
 *  own audience's action. */
export function TeamDecidedRecently({ items, followups }: { items: DecidedRow[]; followups?: FollowupFeed }) {
  return (
    <DecidedRecently
      items={items}
      followups={followups}
      undo={(id, audience) => (audience === 'contractor' ? undoContractorDecision(id) : undoCleanerDecision(id))}
    />
  );
}
