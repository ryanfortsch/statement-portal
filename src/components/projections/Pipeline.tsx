import type { ProjectionRow, GmailTouchEntry } from '@/lib/projections-types';

/**
 * Prospect pipeline.
 *
 * Renders the six-stage timeline that walks a prospect from first contact
 * through to managed property. Each stage is a self-contained card with:
 *
 *   - a status dot on the left rail (done / active / locked)
 *   - stage number + title at the top
 *   - one-line status text on the right (e.g. "Sent May 1 by Allie")
 *   - optional body (meta numbers, redlines slot, intake summary, etc.)
 *   - one or two primary actions at the bottom
 *
 * The page passes each stage's content in via the `children` of the Stage
 * component — the pipeline doesn't know about projections, deliverable PDFs,
 * or redlines. It's a layout primitive.
 */

export type StageState = 'done' | 'active' | 'locked';

export function Pipeline({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{pipelineCss}</style>
      <ol className="rt-pipeline">{children}</ol>
    </>
  );
}

export function Stage({
  num,
  title,
  state,
  status,
  children,
}: {
  num: string;          // "01", "02", ...
  title: string;
  state: StageState;
  status?: React.ReactNode;  // right-aligned, small caps — e.g. "Sent May 1 by Allie"
  children?: React.ReactNode;
}) {
  return (
    <li className="rt-stage" data-state={state}>
      <div className="rt-stage-dot" aria-hidden="true" />
      <div className="rt-stage-card">
        <div className="rt-stage-head">
          <div className="rt-stage-head-l">
            <span className="rt-stage-num">{num}</span>
            <h3 className="rt-stage-title">{title}</h3>
          </div>
          {status && <div className="rt-stage-status">{status}</div>}
        </div>
        {children && <div className="rt-stage-body">{children}</div>}
      </div>
    </li>
  );
}

/**
 * Small caps date text used in stage status lines + activity log entries.
 * Formats an ISO timestamp as "May 1, 2026 · 4:23 PM".
 *
 * Pinned to America/New_York because this is server-rendered on Vercel
 * (UTC) and every Rising Tide user is on Eastern — without the tz hint
 * timestamps would read 4–5 hours ahead of local.
 */
export function fmtTouchTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

/** Short date for stage status lines: "May 1, 2026". Eastern-pinned for
 *  the same reason as fmtTouchTs — a Gmail send at 11pm EDT would
 *  otherwise display as the next day. */
export function fmtTouchDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/New_York',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

/**
 * Standard "Sent {date} by {who}" status line built from a Gmail touch
 * entry. Falls back to "Marked sent {date}" if the touch lacks a from_user
 * (older entries that pre-dated multi-mailbox).
 */
export function gmailStatus(touch: GmailTouchEntry | undefined, fallback?: { sentAt?: string | null }): React.ReactNode {
  if (touch) {
    const by = touch.from_user ? ` by ${touch.from_user}` : '';
    return <>Sent {fmtTouchDate(touch.sent_at)}{by}</>;
  }
  if (fallback?.sentAt) {
    return <>Marked sent {fmtTouchDate(fallback.sentAt)}</>;
  }
  return null;
}

/**
 * Right-side meta on a Promote stage that's still locked — explains which
 * prerequisites are outstanding so it's obvious *why* the button is dimmed.
 */
export function lockedReason(p: ProjectionRow): React.ReactNode {
  const missing: string[] = [];
  if (!p.contract_signed_at) missing.push('signed contract');
  if (!p.onboarding_submitted_at) missing.push('onboarding submission');
  if (missing.length === 0) return null;
  return <>Awaiting {missing.join(' + ')}</>;
}

// ─── CSS ────────────────────────────────────────────────────────────────────
const pipelineCss = `
  .rt-pipeline {
    list-style: none;
    margin: 0;
    padding: 0;
    position: relative;
  }

  /* Connecting rail: a thin vertical line through every stage dot. Drawn
     via a pseudo-element on the ol so it spans the full height of all
     children without per-stage segment math. Sits behind the dots. */
  .rt-pipeline::before {
    content: '';
    position: absolute;
    left: 11px;       /* 12px dot, lined up with its center */
    top: 24px;        /* matches the first dot's top offset */
    bottom: 24px;     /* and the last */
    width: 2px;
    background: var(--rule);
    z-index: 0;
  }

  .rt-stage {
    position: relative;
    padding: 0 0 0 44px;   /* room for the dot + breathing space */
    margin-bottom: 18px;
  }
  .rt-stage:last-child { margin-bottom: 0; }

  /* Status dot. 'done' = filled signal; 'active' = signal ring on paper;
     'locked' = muted ink-4. */
  .rt-stage-dot {
    position: absolute;
    left: 5px;
    top: 22px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--paper);
    border: 2px solid var(--ink-4);
    z-index: 1;
  }
  .rt-stage[data-state="done"] .rt-stage-dot {
    background: var(--signal);
    border-color: var(--signal);
  }
  .rt-stage[data-state="active"] .rt-stage-dot {
    background: var(--paper);
    border-color: var(--signal);
    box-shadow: 0 0 0 3px var(--paper), 0 0 0 4px var(--signal);
  }

  .rt-stage-card {
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 4px;
    padding: 16px 20px;
  }
  .rt-stage[data-state="active"] .rt-stage-card {
    border-color: var(--ink-3);
  }
  .rt-stage[data-state="locked"] .rt-stage-card {
    opacity: 0.65;
  }

  .rt-stage-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 14px;
    flex-wrap: wrap;
  }
  .rt-stage-head-l {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  .rt-stage-num {
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    font-size: 11px;
    color: var(--ink-4);
    letter-spacing: 0.08em;
  }
  .rt-stage[data-state="done"] .rt-stage-num,
  .rt-stage[data-state="active"] .rt-stage-num {
    color: var(--signal);
  }
  .rt-stage-title {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 20px;
    font-weight: 400;
    color: var(--ink);
    margin: 0;
    letter-spacing: -0.01em;
  }
  .rt-stage-status {
    font-size: 11px;
    letter-spacing: 0.06em;
    color: var(--ink-3);
  }
  .rt-stage[data-state="done"] .rt-stage-status {
    color: var(--positive);
  }
  .rt-stage[data-state="locked"] .rt-stage-status {
    color: var(--ink-4);
  }

  .rt-stage-body {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--rule);
    font-size: 13px;
    color: var(--ink);
    line-height: 1.55;
  }
  /* Empty body — when there's no inner content, drop the rule so the card
     stays tight. */
  .rt-stage-body:empty { display: none; }
`;
