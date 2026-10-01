import type { ReactNode } from 'react';

/** Secondary context stays one row until requested, including on phones. */
export function CompactDisclosure({ title, status, attention = false, children }: {
  title: string; status?: string; attention?: boolean; children: ReactNode;
}) {
  return <section className="max-w-[1100px] mx-auto px-10 rt-disclosure-section" aria-label={title}>
    <details className="rt-disclosure">
      <summary className="rt-disclosure-summary">
        <span>{title}</span>
        {status && <span className="rt-disclosure-status" data-attention={attention || undefined}>{status}</span>}
      </summary>
      <div className="rt-disclosure-body">{children}</div>
    </details>
  </section>;
}
