import type { WaitReason } from './types';

/** Why a waiting card is still waiting, in one line under its header. Red
 *  for a send that failed, ink for the rest. */
export function WaitLine({ wait }: { wait: WaitReason }) {
  const signal = wait.tone === 'failed';
  return (
    <p
      className="rt-wait-line"
      data-tone={wait.tone}
      role={wait.tone === 'failed' ? 'alert' : 'status'}
      title={wait.detail}
      style={{
        margin: 0,
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
        flexWrap: 'wrap',
        fontSize: 13,
        lineHeight: 1.5,
        color: signal ? 'var(--signal)' : 'var(--ink-2)',
        fontWeight: signal ? 600 : 500,
      }}
    >
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{wait.text}</span>
      {wait.action}
    </p>
  );
}
