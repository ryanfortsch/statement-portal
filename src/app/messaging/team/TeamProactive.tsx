'use client';

import { useState } from 'react';
import { Button } from '@/components/Button';
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
    <span role="radiogroup" aria-label="Proactive messages for" style={{ display: 'inline-flex', gap: 6 }}>
      {(['cleaner', 'contractor'] as const).map((a) => {
        const on = a === audience;
        return (
          <Button key={a} size="sm" variant={on ? 'primary' : 'secondary'} role="radio" aria-checked={on} onClick={() => setAudience(a)}>
            {a === 'cleaner' ? 'Cleaners' : 'Contractors'}
          </Button>
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
