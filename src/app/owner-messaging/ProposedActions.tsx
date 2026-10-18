'use client';

import type { OwnerProposedAction } from '@/lib/stay-concierge';
import type { AlsoItem } from '@/components/messaging/card/types';

/** One row's presentation, keyed by kind. A table rather than a ternary
 *  chain: the chain ended in "everything else is a cleaner note", so every
 *  new kind arrived mislabelled as one. An unknown kind now shows its own
 *  name, which is ugly on purpose and better than a wrong label. */
const ACTION_STYLE: Record<string, { label: string; color: string }> = {
  work_slip: {
    label: 'Work slip',
    color: 'var(--ink-2)',
  },
  cleaner_note: {
    label: 'Cleaners',
    color: 'var(--ink-3)',
  },
  turnover_note: {
    label: 'Turnover',
    color: 'var(--ink-3)',
  },
  guest_notice: {
    label: 'Guest',
    color: 'var(--tide-deep)',
  },
  guest_message: {
    label: 'Guest',
    color: 'var(--tide-deep)',
  },
  statement_recipient: {
    label: 'Statements',
    color: 'var(--ink-2)',
  },
};

function styleFor(kind: string) {
  return ACTION_STYLE[kind] ?? { label: kind, color: 'var(--ink-3)' };
}

/** The one line the operator reads to know what this action is. */
function actionHeadline(action: OwnerProposedAction): string {
  if (action.kind === 'work_slip') return action.title;
  if (action.kind === 'cleaner_note') return action.summary;
  if (action.kind === 'turnover_note') return action.note_en;
  if (action.kind === 'statement_recipient') {
    const who = action.name ? `${action.name} (${action.email})` : action.email;
    return action.op === 'remove'
      ? `Stop sending statements to ${who}`
      : `Add ${who} to the statement emails`;
  }
  return action.why;
}

/** The words that will actually reach someone outside the office, shown in
 *  full. She should read what a guest or the crew receives before approving,
 *  not just the reason it exists. A turnover note shows its Portuguese,
 *  because that is what lands on the phone. */
function outboundWording(action: OwnerProposedAction): string {
  if (action.kind === 'guest_notice' || action.kind === 'guest_message') return action.body;
  if (action.kind === 'turnover_note') return action.note_pt;
  return '';
}

/**
 * What approving an owner card will also do, as Also on approve lines: one
 * line per action ("Work slip: Replace the soap dispenser"), the words a
 * guest or the crew would receive under it, and one tick box for the set.
 * An owner reporting a peeling soap dispenser should leave a work slip
 * behind; before 2026-09-23 the reply was the only artifact. Untick to send
 * the reply and file nothing.
 */
export function proposedActionItems(
  actions: OwnerProposedAction[],
  enabled: boolean,
  onToggle: (v: boolean) => void,
): AlsoItem[] {
  if (actions.length === 0) return [];
  const tally = new Map<string, number>();
  for (const a of actions) tally.set(a.kind, (tally.get(a.kind) ?? 0) + 1);
  const notes = tally.get('cleaner_note') ?? 0;
  const guestCards = (tally.get('guest_notice') ?? 0) + (tally.get('guest_message') ?? 0);
  const turnoverNotes = tally.get('turnover_note') ?? 0;
  const recipients = tally.get('statement_recipient') ?? 0;
  const status = enabled ? 'Create when approved or handled' : 'Skip';

  const items: AlsoItem[] = actions.map((action, i) => {
    const { label, color } = styleFor(action.kind);
    const draft = outboundWording(action);
    const urgent = action.kind === 'work_slip' && action.priority === 'high';
    const entersUnit = action.kind === 'guest_notice' && action.enters_guest_space;
    return {
      key: `action-${i}`,
      line: (
        <>
          <span className="eyebrow" style={{ fontWeight: 600, color, marginRight: 8 }}>{label}</span>
          {actionHeadline(action)}
          {urgent && <span style={{ color: 'var(--signal)', fontWeight: 600 }}> · urgent</span>}
          {entersUnit && <span style={{ color: 'var(--signal)', fontWeight: 600 }}> · enters the unit</span>}
        </>
      ),
      status,
      attention: urgent || entersUnit,
      body: draft ? (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          {action.kind === 'guest_notice' && action.visit_date ? `${action.visit_date}: ` : ''}
          &ldquo;{draft}&rdquo;
        </p>
      ) : undefined,
    };
  });

  const explain = [
    notes > 0 && 'A cleaner heads-up lands in the Cleaners queue for approval. It is not sent to anyone yet.',
    turnoverNotes > 0 && 'A turnover note joins the cleaners\u2019 schedule message for the day the crew is next at that house. That message still needs approving before it sends.',
    recipients > 0 && 'A recipient change updates the statement send list and the owner contacts on every property this owner receives statements for, so replies from that address reach this queue too.',
    guestCards > 0 && 'Anything for a guest lands in the Guests queue for approval, addressed to whoever is actually in the house. Nothing is created if the house is empty.',
  ].filter(Boolean) as string[];

  items.push({
    key: 'action-toggle',
    line: (
      <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--ink-3)', cursor: 'pointer' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        Create these when I approve or mark handled
      </label>
    ),
    body: explain.length ? (
      <>
        {explain.map((t) => (
          <p key={t} style={{ margin: '0 0 6px', fontSize: 11, color: 'var(--ink-4)' }}>{t}</p>
        ))}
      </>
    ) : undefined,
  });
  return items;
}
