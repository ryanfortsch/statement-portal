'use client';

import { useState, useTransition } from 'react';
import { Section } from '@/components/Section';
import { fetchStats } from './stats-action';
import type { MessagingStats, Fact } from '@/lib/stay-concierge';

type Props = {
  initialStats: MessagingStats | null;
  initialError: string | null;
  initialFacts: Fact[];
  totalFacts: number;
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

export function PerformanceDropdown({ initialStats, initialError, initialFacts, totalFacts }: Props) {
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
          facts={initialFacts}
          totalFacts={totalFacts}
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
  facts,
  totalFacts,
}: {
  stats: MessagingStats;
  window: Window;
  windows: Window[];
  onWindowChange: (w: Window) => void;
  loading: boolean;
  facts: Fact[];
  totalFacts: number;
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
      <LearningSection stats={stats} facts={facts} totalFacts={totalFacts} />
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
  facts,
  totalFacts,
}: {
  stats: MessagingStats;
  facts: Fact[];
  totalFacts: number;
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
            gridTemplateColumns: 'repeat(3, 1fr)',
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
              {totalFacts}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>
              distilled facts the AI now follows
            </div>
          </div>
          <div>
            <div
              className="font-serif"
              style={{ fontSize: 28, fontWeight: 500, color: 'var(--ink)', marginBottom: 4 }}
            >
              {stats.learning.qa_pairs_total}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>
              ground-truth Q&amp;A pairs in the corpus
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
              coaching directives logged
            </div>
          </div>
        </div>
        {stats.learning.qa_latest_captured_at && (
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-4)' }}>
            last Q&amp;A captured {relativeTime(stats.learning.qa_latest_captured_at)}
            {stats.learning.qa_latest_property
              ? ` at ${prettifySlug(stats.learning.qa_latest_property)}`
              : ''}
          </div>
        )}
      </div>

      {facts.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div
            className="eyebrow"
            style={{ color: 'var(--ink-3)', marginBottom: 14 }}
          >
            Facts the AI knows now ({facts.length} most recent)
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {facts.map((f, i) => (
              <FactCard key={`${f.source_heading}-${i}`} fact={f} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FactCard({ fact }: { fact: Fact }) {
  const [showSource, setShowSource] = useState(false);
  return (
    <li
      style={{
        borderTop: '1px solid var(--rule)',
        padding: '16px 4px',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'baseline',
          flexWrap: 'wrap',
          marginBottom: 8,
        }}
      >
        <ScopeChip scope={fact.scope} />
        <span
          className="eyebrow"
          style={{ color: 'var(--ink-4)', fontSize: 10 }}
        >
          {fact.topic.replace(/_/g, ' ')}
        </span>
        {fact.confidence !== 'high' && (
          <span
            className="eyebrow"
            style={{
              color: 'var(--ink-4)',
              fontSize: 10,
              fontStyle: 'italic',
            }}
          >
            {fact.confidence} confidence
          </span>
        )}
        <span
          className="eyebrow"
          style={{
            color: 'var(--ink-4)',
            fontSize: 10,
            marginLeft: 'auto',
          }}
        >
          {fact.source_date}
        </span>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 15,
          lineHeight: 1.5,
          color: 'var(--ink)',
          fontWeight: 600,
        }}
      >
        {fact.fact}
      </p>
      <button
        type="button"
        onClick={() => setShowSource((v) => !v)}
        style={{
          marginTop: 8,
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
        {showSource ? 'Hide source ▴' : 'Show source ▾'}
      </button>
      {showSource && (
        <div
          style={{
            marginTop: 10,
            padding: '12px 14px',
            background: 'var(--paper-2)',
            border: '1px solid var(--rule)',
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--ink-3)',
            whiteSpace: 'pre-wrap',
            fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
          }}
        >
          {fact.source_body_short}
        </div>
      )}
    </li>
  );
}

function ScopeChip({ scope }: { scope: string }) {
  const label = scope === 'all properties'
    ? 'All properties'
    : scope === 'voice'
      ? 'Voice'
      : scope === 'process'
        ? 'Process'
        : prettifySlug(scope) || 'Unknown';
  const isProperty = scope && scope !== 'all properties' && scope !== 'voice' && scope !== 'process';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 9px',
        background: isProperty ? 'var(--signal)' : 'var(--ink)',
        color: 'var(--paper)',
        fontSize: 10,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
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
