import type { ReactNode } from 'react';

/** Keep the selected consequence visible even when its supporting details are closed. */
export function InboxFollowup({ title, status, attention = false, ariaLabel, children }: {
  title: string; status: string; attention?: boolean; ariaLabel?: string; children: ReactNode;
}) {
  return <details className="rt-inbox-followup" aria-label={ariaLabel || title} open={attention || undefined}>
    <summary>
      <span className="rt-inbox-followup-title">{title}</span>
      <span className="rt-inbox-followup-status" data-attention={attention || undefined}>{status}</span>
    </summary>
    <div className="rt-inbox-followup-body">{children}</div>
  </details>;
}
