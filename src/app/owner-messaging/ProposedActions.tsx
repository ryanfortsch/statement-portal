'use client';

import type { OwnerProposedAction } from '@/lib/stay-concierge';

/** One row's presentation, keyed by kind. A table rather than a ternary
 *  chain: the chain ended in "everything else is a cleaner note", so every
 *  new kind arrived mislabelled as one. An unknown kind now shows its own
 *  name, which is ugly on purpose and better than a wrong label. */
const ACTION_KINDS = ['work_slip', 'cleaner_note', 'guest_notice', 'guest_message'] as const;

const ACTION_STYLE: Record<string, { label: string; color: string; count: (n: number) => string }> = {
  work_slip: {
    label: 'Work slip',
    color: 'var(--ink-2)',
    count: (n) => `${n} work slip${n === 1 ? '' : 's'}`,
  },
  cleaner_note: {
    label: 'Cleaners',
    color: 'var(--ink-3)',
    count: (n) => `${n} cleaner heads-up${n === 1 ? '' : 's'}`,
  },
  guest_notice: {
    label: 'Guest',
    color: 'var(--tide-deep)',
    count: (n) => `${n} guest heads-up${n === 1 ? '' : 's'}`,
  },
  guest_message: {
    label: 'Guest',
    color: 'var(--tide-deep)',
    count: (n) => `${n} message${n === 1 ? '' : 's'} to the guest`,
  },
};

function styleFor(kind: string) {
  return ACTION_STYLE[kind] ?? { label: kind, color: 'var(--ink-3)', count: (n: number) => `${n} ${kind}` };
}

/** The one line the operator reads to know what this action is. */
function actionHeadline(action: OwnerProposedAction): string {
  if (action.kind === 'work_slip') return action.title;
  if (action.kind === 'cleaner_note') return action.summary;
  return action.why;
}

/** Guest-facing wording is shown in full. She should read what a guest will
 *  actually receive before approving, not just why it exists. */
function guestDraft(action: OwnerProposedAction): string {
  return action.kind === 'guest_notice' || action.kind === 'guest_message' ? action.body : '';
}

export function ProposedActions({
  actions,
  enabled,
  onToggle,
}: {
  actions: OwnerProposedAction[];
  enabled: boolean;
  onToggle: (v: boolean) => void;
}) {
  const tally = new Map<string, number>();
  for (const a of actions) tally.set(a.kind, (tally.get(a.kind) ?? 0) + 1);
  // Known kinds first, in a stable order, then anything the service learned
  // to send that this build does not know about yet.
  const ordered = [
    ...ACTION_KINDS.filter((k) => tally.has(k)),
    ...[...tally.keys()].filter((k) => !ACTION_KINDS.includes(k as (typeof ACTION_KINDS)[number])),
  ];
  const summary = ordered.map((k) => styleFor(k).count(tally.get(k) ?? 0)).join(', ');

  const notes = tally.get('cleaner_note') ?? 0;
  const guestCards = (tally.get('guest_notice') ?? 0) + (tally.get('guest_message') ?? 0);

  return (
    <section
      style={{ border: '1px solid var(--rule)', padding: '14px 18px', background: 'var(--paper-2)' }}
      aria-label="What approving also does"
    >
      <div className="eyebrow" style={{ color: 'var(--ink-3)', marginBottom: 10 }}>
        Approving also creates {summary}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
        {actions.map((action, i) => {
          const { label, color } = styleFor(action.kind);
          const draft = guestDraft(action);
          return (
            <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 13 }}>
              <span className="eyebrow" style={{ minWidth: 108, fontWeight: 600, color }}>
                {label}
              </span>
              <span style={{ color: 'var(--ink)', flex: 1 }}>
                {actionHeadline(action)}
                {action.kind === 'work_slip' && action.priority === 'high' && (
                  <span style={{ color: 'var(--signal)', fontWeight: 600 }}> · urgent</span>
                )}
                {action.kind === 'guest_notice' && action.enters_guest_space && (
                  <span style={{ color: 'var(--signal)', fontWeight: 600 }}> · enters the unit</span>
                )}
                {draft && (
                  <span
                    style={{
                      display: 'block',
                      marginTop: 4,
                      fontSize: 12,
                      color: 'var(--ink-3)',
                      lineHeight: 1.5,
                    }}
                  >
                    {action.kind === 'guest_notice' && action.visit_date
                      ? `${action.visit_date}: `
                      : ''}
                    &ldquo;{draft}&rdquo;
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <label
        style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, fontSize: 12, color: 'var(--ink-3)' }}
      >
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        Create these when I approve
      </label>
      {notes > 0 && (
        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--ink-4)' }}>
          A cleaner heads-up lands in the Cleaners queue for approval. It is not sent to anyone yet.
        </p>
      )}
      {guestCards > 0 && (
        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--ink-4)' }}>
          Anything for a guest lands in the Guests queue for approval, addressed to whoever is
          actually in the house. Nothing is created if the house is empty.
        </p>
      )}
    </section>
  );
}
