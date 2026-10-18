'use client';

import { useState } from 'react';
import { ProactiveRemindersPanel, type ProactiveReminderActions } from '@/components/ProactiveRemindersPanel';

/**
 * One Proactive messages panel for the Team inbox on All (2026-10-18), with
 * a Cleaners / Contractors pick in its header, instead of two panels with
 * the same title stacked at the foot of the page. Both stay mounted, so a
 * half-written message to one audience survives a look at the other; each
 * keeps its own server actions (Next server actions are per-route).
 */
export function TeamProactive({ cleaner, contractor }: { cleaner: ProactiveReminderActions; contractor: ProactiveReminderActions }) {
  const [audience, setAudience] = useState<'cleaner' | 'contractor'>('cleaner');
  const pick = (
    <span role="radiogroup" aria-label="Proactive messages for" style={{ display: 'inline-flex', border: '1px solid var(--rule)' }}>
      {(['cleaner', 'contractor'] as const).map((a) => {
        const on = a === audience;
        return (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => setAudience(a)}
            style={{
              fontSize: 10,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              fontWeight: 600,
              padding: '6px 10px',
              border: 'none',
              cursor: 'pointer',
              background: on ? 'var(--ink)' : 'var(--paper)',
              color: on ? 'var(--paper)' : 'var(--ink-3)',
            }}
          >
            {a === 'cleaner' ? 'Cleaners' : 'Contractors'}
          </button>
        );
      })}
    </span>
  );
  return (
    <>
      <div hidden={audience !== 'cleaner'}>
        <ProactiveRemindersPanel audience="cleaner" actions={cleaner} audienceSwitch={pick} />
      </div>
      <div hidden={audience !== 'contractor'}>
        <ProactiveRemindersPanel audience="contractor" actions={contractor} audienceSwitch={pick} />
      </div>
    </>
  );
}
