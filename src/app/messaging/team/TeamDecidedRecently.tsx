'use client';

import { DecidedRecently, type DecidedRow } from '@/components/messaging/card/DecidedRecently';
import { undoCleanerDecision } from '@/app/cleaner-messaging/actions';
import { undoContractorDecision } from '@/app/contractor-messaging/actions';

/** Decided recently for the Team inbox: one ledger, each row undone by its
 *  own audience's action. */
export function TeamDecidedRecently({ items }: { items: DecidedRow[] }) {
  return (
    <DecidedRecently
      items={items}
      undo={(id, audience) => (audience === 'contractor' ? undoContractorDecision(id) : undoCleanerDecision(id))}
    />
  );
}
