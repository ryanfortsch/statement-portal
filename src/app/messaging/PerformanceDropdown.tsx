'use client';

import { useState, useTransition } from 'react';
import { Section } from '@/components/Section';
import { fetchStats } from './stats-action';
import type { MessagingStats, LearningEntry } from '@/lib/stay-concierge';

type Props = {
  initialStats: MessagingStats | null;
  initialError: string | null;
  initialLearnings: LearningEntry[];
};

type Window = { label: string; hours: number };

const WINDOWS: Window[] = [
  { label: '24h', hours: 24 },
  { label: '7d', hours: 24 * 7 },
  { label: '30d', hours: 24 * 30 },
  { label: 'All', hours: 0 },
];

// Default to All-time. The lifetime numbers are where the honest
// performance signal lives (3 weeks of data). The user can switch to a
// shorter window to see recent trend.
const DEFAULT_WINDOW = WINDOWS[3];

export function PerformanceDropdown({ initialStats, initialError, initialLearnings }: Props) {
  // Default open. The user came to /messaging to see this; the dropdown
  // chip was too easy to miss. Keeping the open/close affordance for
  // density when she's done.
  const [open, setOpen] = useState(true);
  const [stats, setStats] = useState<MessagingStats | null>(initialStats);
  const [error, setError] = useState<string | null>(initialError);
  const [currentWindow, setCurrentWindow] = useState<Window>(DEFAULT_WINDOW);
  const [isPending, startTransition] = useTransition();

  const loadWindow = (w: Window) => {
    setCurrentWindow(w);
    setError(null);
    startTransition(async () => {
      const res = await fetchStats(w.hours);
      if (!res.ok) {
        setError(res.error);
        setStats(null);
        return;
      }
      setStats(res.data);
    });
  };

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    // When opening, refresh the stats if the cached window doesn't match
    // the user's current selection. Initial server fetch is 7d, so this
    // only re-fetches if the user changed window before opening.
    if (next && stats?.window_hours !== currentWindow.hours) {
      loadWindow(currentWindow);
    }
  };

  return (
    <Section
      title="Performance"
      eyebrow={open ? `${currentWindow.label} · how the AI is doing` : 'how the AI is doing'}
      paddingTop={36}
      right={
        <button
          type="button"
          onClick={handleToggle}
          style={{
            fontSize: 10,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            fontWeight: 500,
            color: 'var(--ink-3)',
            background: 'transparent',
            border: '1px solid var(--rule)',
            padding: '6px 12px',
            cursor: 'pointer',
          }}
          aria-expanded={open}
        >
          {open ? 'Hide ▴' : 'Show ▾'}
        </button>
      }
    >
      {!open ? (
        <div
          style={{
            borderTop: '1px solid var(--rule)',
            padding: '16px 0',
            fontSize: 13,
            color: 'var(--ink-3)',
          }}
        >
          One-shot rate, drafts shipped, what the AI has learned. Click <b>Show</b> to expand.
        </div>
      ) : !stats && error ? (
        <ErrorState message={error} />
      ) : !stats ? (
        <LoadingState />
      ) : (
        <StatsBody
          stats={stats}
          window={currentWindow}
          windows={WINDOWS}
          onWindowChange={loadWindow}
          loading={isPending}
          learnings={initialLearnings}
        />
      )}
    </Section>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      style={{
        borderTop: '1px solid var(--rule)',
        padding: '20px 0',
        fontSize: 13,
        color: 'var(--signal)',
      }}
    >
      {message}
    </div>
  );
}

function LoadingState() {
  return (
    <div
      style={{
        borderTop: '1px solid var(--rule)',
        padding: '20px 0',
        fontSize: 13,
        color: 'var(--ink-3)',
      }}
    >
      Loading stats…
    </div>
  );
}

function StatsBody({
  stats,
  window,
  windows,
  onWindowChange,
  loading,
  learnings,
}: {
  stats: MessagingStats;
  window: Window;
  windows: Window[];
  onWindowChange: (w: Window) => void;
  loading: boolean;
  learnings: LearningEntry[];
}) {
  const oneShotPct =
    stats.one_shot_rate == null ? null : Math.round(stats.one_shot_rate * 100);

  return (
    <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 20 }}>
      <WindowToggle windows={windows} current={window} onChange={onWindowChange} disabled={loading} />

      {/* Hero one-shot rate */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.2fr 2fr',
          gap: 24,
          alignItems: 'baseline',
          padding: '24px 0',
          borderBottom: '1px solid var(--rule)',
          marginBottom: 20,
        }}
        className="rt-msg-stats-hero"
      >
        <div>
          <div className="eyebrow" style={{ color: 'var(--ink-4)', marginBottom: 8 }}>
            One-shot rate
          </div>
          <div
            className="font-serif"
            style={{
              fontSize: 56,
              lineHeight: 1,
              fontWeight: 500,
              color: oneShotPct == null ? 'var(--ink-4)' : 'var(--ink)',
              letterSpacing: '-0.02em',
            }}
          >
            {oneShotPct == null ? '—' : `${oneShotPct}%`}
          </div>
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--ink-2)' }}>
          Of the <b>{stats.approved_total}</b>{' '}
          {stats.approved_total === 1 ? 'draft' : 'drafts'} you shipped through Helm,{' '}
          <b>{stats.first_pass_clean}</b> needed no coaching.
          {stats.approved_after_coaching > 0 && (
            <>
              {' '}
              Another <b>{stats.approved_after_coaching}</b> shipped after a coaching round.
            </>
          )}
          {stats.approved_total === 0 && (
            <>
              {' '}
              <span style={{ color: 'var(--ink-4)' }}>
                No drafts shipped through Helm in this window yet — try Approve & send on a low-stakes draft to start the score.
              </span>
            </>
          )}
        </div>
      </div>

      {/* KPI grid: shipped, coached, handled, rejected, expired, escalated */}
      <div
        className="rt-msg-kpi-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 0,
          borderTop: '1px solid var(--rule)',
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <KpiTile
          label="Drafts shipped"
          value={stats.approved_total}
          sub={`${stats.first_pass_clean} clean · ${stats.approved_after_coaching} coached`}
        />
        <KpiTile
          label="Handled in Guesty"
          value={stats.manual_sent}
          sub="you replied directly · captured for learning"
        />
        <KpiTile
          label="Auto-sent"
          value={stats.auto_sent}
          sub="tier 1 + safe topic · no human touch"
        />
        <KpiTile
          label="Coaching rounds"
          value={stats.superseded_total}
          sub="times you nudged the AI"
        />
        <KpiTile
          label="Rejected"
          value={stats.rejected}
          sub="no reply needed"
        />
        <KpiTile
          label="Auto-expired"
          value={stats.auto_rejected_stale}
          sub="dropped after 24h with no action"
          accent={stats.auto_rejected_stale > 0}
        />
      </div>

      {/* Volume / escalation strip */}
      <div
        className="rt-msg-volume-strip"
        style={{
          marginTop: 20,
          display: 'flex',
          gap: 40,
          fontSize: 13,
          color: 'var(--ink-3)',
        }}
      >
        <span>
          <b style={{ color: 'var(--ink)' }}>{stats.drafted}</b> drafts generated
        </span>
        <span>
          <b style={{ color: 'var(--ink)' }}>{stats.escalated}</b> escalated to SMS
        </span>
        <span>
          tiers — {stats.tier_breakdown['1']} / {stats.tier_breakdown['2']} /{' '}
          {stats.tier_breakdown['3']}
        </span>
        <span>
          live queue · <b style={{ color: 'var(--ink)' }}>{stats.pending_now}</b>
        </span>
      </div>

      {/* Learning corpus */}
      <LearningSection stats={stats} learnings={learnings} />
    </div>
  );
}

function WindowToggle({
  windows,
  current,
  onChange,
  disabled,
}: {
  windows: Window[];
  current: Window;
  onChange: (w: Window) => void;
  disabled: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label="Time window"
      style={{ display: 'inline-flex', border: '1px solid var(--ink)', overflow: 'hidden' }}
    >
      {windows.map((w) => {
        const active = w.hours === current.hours;
        return (
          <button
            key={w.label}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(w)}
            style={{
              padding: '8px 14px',
              fontSize: 11,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              fontWeight: 600,
              border: 'none',
              cursor: disabled ? 'wait' : 'pointer',
              background: active ? 'var(--ink)' : 'var(--paper)',
              color: active ? 'var(--paper)' : 'var(--ink)',
              borderRight: '1px solid var(--ink)',
            }}
          >
            {w.label}
          </button>
        );
      })}
    </div>
  );
}

function KpiTile({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: number;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        padding: '20px 24px',
        borderRight: '1px solid var(--rule)',
        borderBottom: '1px solid var(--rule)',
      }}
      className="rt-msg-kpi-tile"
    >
      <div className="eyebrow" style={{ color: 'var(--ink-4)', marginBottom: 6 }}>
        {label}
      </div>
      <div
        className="font-serif"
        style={{
          fontSize: 32,
          lineHeight: 1,
          fontWeight: 500,
          color: accent && value > 0 ? 'var(--signal)' : 'var(--ink)',
          letterSpacing: '-0.01em',
          marginBottom: 6,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>{sub}</div>
    </div>
  );
}

function LearningSection({
  stats,
  learnings,
}: {
  stats: MessagingStats;
  learnings: LearningEntry[];
}) {
  return (
    <div style={{ marginTop: 28 }}>
      <div
        style={{
          padding: '20px 24px',
          background: 'var(--paper-2)',
          border: '1px solid var(--rule)',
        }}
      >
        <div className="eyebrow" style={{ color: 'var(--ink-4)', marginBottom: 10 }}>
          What the AI has learned
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 24,
            fontSize: 14,
            color: 'var(--ink-2)',
          }}
          className="rt-msg-learning-grid"
        >
          <div>
            <div
              className="font-serif"
              style={{ fontSize: 28, fontWeight: 500, color: 'var(--ink)', marginBottom: 4 }}
            >
              {stats.learning.qa_pairs_total}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>
              ground-truth Q&amp;A pairs in the learning corpus
            </div>
          </div>
          <div>
            <div
              className="font-serif"
              style={{ fontSize: 28, fontWeight: 500, color: 'var(--ink)', marginBottom: 4 }}
            >
              {stats.coaching.coaching_notes_total}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>
              coaching directives logged in policy
            </div>
          </div>
        </div>
        {stats.learning.qa_latest_captured_at && (
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-4)' }}>
            last captured {relativeTime(stats.learning.qa_latest_captured_at)}
            {stats.learning.qa_latest_property
              ? ` at ${prettifySlug(stats.learning.qa_latest_property)}`
              : ''}
          </div>
        )}
      </div>

      {learnings.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div
            className="eyebrow"
            style={{ color: 'var(--ink-3)', marginBottom: 12 }}
          >
            Recent directives ({learnings.length} most recent)
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {learnings.map((entry, i) => (
              <LearningCard key={`${entry.date}-${i}`} entry={entry} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function LearningCard({ entry }: { entry: LearningEntry }) {
  const [expanded, setExpanded] = useState(false);

  // Pull the meaningful body out: prefer the > quoted block (which holds
  // Allie's verbatim coaching), fall back to the first non-quote paragraph.
  const summary = extractSummary(entry.body);
  const isLong = entry.body.length > summary.length + 20;

  return (
    <li
      style={{
        borderTop: '1px solid var(--rule)',
        padding: '14px 4px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 6,
          alignItems: 'baseline',
        }}
      >
        <span
          className="font-serif"
          style={{
            fontSize: 15,
            fontWeight: 500,
            color: 'var(--ink)',
            letterSpacing: '-0.005em',
          }}
        >
          {entry.title || entry.heading}
        </span>
        <span
          className="eyebrow"
          style={{
            color: 'var(--ink-4)',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            fontSize: 10,
          }}
        >
          {entry.date}
        </span>
      </div>
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.55,
          color: 'var(--ink-2)',
          whiteSpace: 'pre-wrap',
        }}
      >
        {expanded ? entry.body : summary}
      </div>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            marginTop: 6,
            background: 'transparent',
            border: 'none',
            padding: 0,
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            fontWeight: 500,
            color: 'var(--ink-3)',
            cursor: 'pointer',
          }}
        >
          {expanded ? 'Show less ▴' : 'Show more ▾'}
        </button>
      )}
    </li>
  );
}

function extractSummary(body: string): string {
  // Strip retrospective-coaching boilerplate: skip "Context:" and "Guest
  // message:" prefix lines, surface the actual Coaching: directive.
  const lines = body.split('\n').filter((l) => l.trim());
  const coachingLine = lines.find((l) => l.toLowerCase().includes('coaching:'));
  if (coachingLine) {
    const idx = coachingLine.toLowerCase().indexOf('coaching:');
    return coachingLine.slice(idx + 'coaching:'.length).trim();
  }
  // For non-retrospective entries: take the first quoted paragraph (Allie's
  // verbatim SMS) or the first 240 chars.
  const quoteLine = lines.find((l) => l.startsWith('>'));
  if (quoteLine) {
    return quoteLine.replace(/^>\s*/, '').slice(0, 240);
  }
  return body.slice(0, 240) + (body.length > 240 ? '…' : '');
}

function relativeTime(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const diffMin = Math.max(0, Math.round((Date.now() - then) / 60000));
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    if (diffMin < 60 * 24) return `${Math.round(diffMin / 60)}h ago`;
    return `${Math.round(diffMin / (60 * 24))}d ago`;
  } catch {
    return iso.slice(0, 16);
  }
}

function prettifySlug(slug: string): string {
  // 53_rocky_neck -> 53 Rocky Neck
  return slug
    .split('_')
    .map((p) => (/^\d+$/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}
