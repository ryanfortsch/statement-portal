'use client';

import { ActionReceipt } from './ActionReceipt';
import type { ApprovalReceipt } from '@/lib/approval-receipt';
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Section } from '@/components/Section';
import { QueueRefreshControl } from '@/components/QueueRefreshControl';
import { UndoToast } from './UndoToast';
import { Button } from '@/components/Button';
import type { QueueLoadStatus } from '@/lib/queue-loader';
import type { CardResult, Decision } from './types';

/**
 * The queue around the cards, the same on every inbox: "Needs review (N)",
 * decisions first and scheduled sends in their own group under them, the
 * refresh chip, the follow-up notice an approve can return, and the undo
 * toast after a Mark handled.
 */
export type QueueCardHelpers = {
  onResolved: (warning?: string, receipt?: ApprovalReceipt) => void;
  onDecided: (decision: Decision) => void;
};

export function ApprovalQueue<T extends { id: string; status?: string; send_at?: string }>({
  approvals,
  onRefresh,
  refreshStatus = 'ready',
  undo,
  emptyMessage,
  toolbar,
  after,
  renderCard,
}: {
  approvals: T[];
  /** Fetch the queue now and catch the page up. */
  onRefresh: () => void;
  /** The feed's state, from useApprovalQueue: the Refresh control says
   *  when a refresh failed or the browser is offline, and nothing else. */
  refreshStatus?: QueueLoadStatus;
  /** The audience's undo for a Mark handled. A mixed queue gets the
   *  decision's audience too. */
  undo: (id: string, audience?: string) => Promise<CardResult>;
  emptyMessage: string;
  /** Above the cards, under the title: the Team inbox's filter row. */
  toolbar?: ReactNode;
  /** Under the cards, still in the queue: what waits without a card (an
   *  email held as a pitch). */
  after?: ReactNode;
  renderCard: (approval: T, helpers: QueueCardHelpers) => ReactNode;
}) {
  const receiptRef = useRef<HTMLDivElement>(null);
  const [receipt, setReceipt] = useState<ApprovalReceipt | null>(null);
  useEffect(() => {
    if (receipt) receiptRef.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [receipt]);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastDecision, setLastDecision] = useState<Decision | null>(null);
  const closeToast = useCallback(() => setLastDecision(null), []);
  const onResolved = useCallback(
    (warning?: string, result?: ApprovalReceipt) => {
      if (result) setReceipt(result);
      setNotice(warning && !result?.items.some(item => item.label === warning) ? warning : null);
      onRefresh();
    },
    [onRefresh],
  );

  const queued = approvals
    .filter((a) => a.status === 'scheduled')
    .sort((a, b) => (a.send_at || '').localeCompare(b.send_at || ''));
  const pending = approvals.filter((a) => a.status !== 'scheduled');
  const ordered = [...pending, ...queued];
  const title =
    approvals.length === 0
      ? 'Inbox zero'
      : pending.length === 0
        ? `Scheduled (${queued.length})`
        : `Needs review (${pending.length})`;

  return (
    <>
      {receipt && <div ref={receiptRef} className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', marginTop: 18 }}><ActionReceipt receipt={receipt} onDismiss={() => setReceipt(null)} /></div>}
      {notice && (
        <p
          role="status"
          className="max-w-[1100px] mx-auto px-10"
          style={{ width: '100%', margin: '14px auto 0', fontSize: 13, color: 'var(--signal)', display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}
        >
          <span>{notice}</span>
          <Button variant="quiet" onClick={() => setNotice(null)}>
            Dismiss
          </Button>
        </p>
      )}
      <Section
        id="needs-review"
        title={title}
        right={<QueueRefreshControl onRefresh={onRefresh} status={refreshStatus} />}
        empty={approvals.length === 0 && !toolbar && !after}
        emptyMessage={emptyMessage}
      >
        {toolbar}
        {(toolbar || after) && approvals.length === 0 ? (
          <p style={{ margin: '18px 0 0', fontSize: 13, color: 'var(--ink-3)' }}>{emptyMessage}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {ordered.map((approval, index) => (
              <Fragment key={approval.id}>
                {pending.length > 0 && queued.length > 0 && index === pending.length && (
                  <h3 className="rt-inbox-group-title">Scheduled ({queued.length})</h3>
                )}
                {renderCard(approval, { onResolved, onDecided: setLastDecision })}
              </Fragment>
            ))}
          </div>
        )}
        {after}
      </Section>
      {/* Outside the Section: marking the last card handled empties the
          queue, and an empty Section renders no children. */}
      <UndoToast decision={lastDecision} undo={undo} onClose={closeToast} onUndone={onResolved} />
    </>
  );
}
