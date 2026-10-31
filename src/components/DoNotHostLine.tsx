import type { CSSProperties } from 'react';
import { doNotHostDetail, doNotHostLine, type DoNotHostNote } from '@/lib/do-not-host';

/**
 * The one red line for a guest Helm will not host again, the same on every
 * surface: the guest record, the messaging card, the booking record and
 * row, the New numbers card. The reason rides on the line; who decided and
 * when sit behind it (the title). No hooks, so a server page renders it too.
 */
export function DoNotHostLine({ reason, set_by, set_at, size = 'md', style }: DoNotHostNote & { size?: 'sm' | 'md'; style?: CSSProperties }) {
  return (
    <span
      data-do-not-host=""
      role="note"
      title={doNotHostDetail({ set_by, set_at })}
      style={{
        display: 'block',
        fontSize: size === 'sm' ? 11 : 13,
        fontWeight: 600,
        lineHeight: 1.4,
        color: 'var(--signal)',
        overflowWrap: 'anywhere',
        ...style,
      }}
    >
      {doNotHostLine({ reason })}
    </span>
  );
}
