import { Suspense } from 'react';
import { InboxSearch } from './InboxSearch';
import { InboxHealth } from './InboxHealth';

/**
 * Search all inboxes and the routine Delivery & sync row, at the foot of a
 * messaging page (2026-10-18). They used to sit between the tabs and the
 * queue on every inbox page, so the first card started three rows down.
 * A delivery problem that could hide incoming messages still renders above
 * the queue (InboxHealth placement="top"); everything routine lives here.
 */
export function InboxBottomTools() {
  return (
    <div style={{ width: '100%', paddingTop: 20 }}>
      <InboxSearch />
      <Suspense fallback={null}>
        <InboxHealth placement="bottom" />
      </Suspense>
    </div>
  );
}
