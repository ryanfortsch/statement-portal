'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Section } from '@/components/Section';
import { fetchStats } from './stats-action';
import {
  editFactAction,
  deleteFactAction,
  restoreFactAction,
  createFactAction,
} from './facts-actions';
import { prettifySlug } from './format';
import { TrendChart } from './TrendChart';
import type { MessagingStats, Fact, TimeseriesPoint } from '@/lib/stay-concierge';

type Props = {
  initialStats: MessagingStats | null;
  initialError: string | null;
  initialFacts: Fact[];
  totalFacts: number;
  initialTimeseries: TimeseriesPoint[];
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

export function PerformanceDropdown({
  initialStats,
  initialError,
  initialFacts,
  totalFacts,
  initialTimeseries,
}: Props) {
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
          timeseries={initialTimeseries}
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
  timeseries,
}: {
  stats: MessagingStats;
  window: Window;
  windows: Window[];
  onWindowChange: (w: Window) => void;
  loading: boolean;
  facts: Fact[];
  totalFacts: number;
  timeseries: TimeseriesPoint[];
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
          <OneShotExplainer stats={stats} />
        </div>
      </div>

      {/* Trend: rolling one-shot rate over the last 30 days. Sits between
          the hero and the KPI grid so the "is it getting better?" answer
          is the second thing the operator reads. */}
      <div style={{ padding: '24px 0', borderBottom: '1px solid var(--rule)', marginBottom: 20 }}>
        <TrendChart series={timeseries} />
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
          gap: 32,
          fontSize: 13,
          color: 'var(--ink-3)',
          flexWrap: 'wrap',
          alignItems: 'baseline',
        }}
      >
        <span>
          <b style={{ color: 'var(--ink)' }}>{stats.drafted}</b> drafts generated
        </span>
        <span>
          <b style={{ color: 'var(--ink)' }}>{stats.escalated}</b> escalated to SMS
        </span>
        <span
          style={{
            display: 'inline-flex',
            gap: 14,
            alignItems: 'baseline',
            paddingLeft: 14,
            borderLeft: '1px solid var(--rule)',
          }}
        >
          <span title="Tier 1: safe to draft and auto-suggest">
            tier 1 · <b style={{ color: 'var(--ink)' }}>{stats.tier_breakdown['1']}</b>
          </span>
          <span title="Tier 2: draft + human approval">
            tier 2 · <b style={{ color: 'var(--ink)' }}>{stats.tier_breakdown['2']}</b>
          </span>
          <span title="Tier 3: escalate, no draft">
            tier 3 · <b style={{ color: 'var(--ink)' }}>{stats.tier_breakdown['3']}</b>
          </span>
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

function OneShotExplainer({ stats }: { stats: MessagingStats }) {
  const helmEngaged = stats.approved_total + stats.escalated;
  const guestyOnly = stats.manual_sent + stats.auto_rejected_stale;
  if (helmEngaged === 0 && guestyOnly === 0) {
    return (
      <span style={{ color: 'var(--ink-4)' }}>
        No inbound activity in this window yet.
      </span>
    );
  }
  return (
    <>
      Of the <b>{helmEngaged}</b>{' '}
      {helmEngaged === 1 ? 'message' : 'messages'} the AI tried to handle,{' '}
      <b>{stats.first_pass_clean}</b> shipped on the first draft.
      {stats.approved_after_coaching > 0 && (
        <>
          {' '}Another <b>{stats.approved_after_coaching}</b> shipped after coaching.
        </>
      )}
      {stats.escalated > 0 && (
        <>
          {' '}
          <span style={{ color: 'var(--signal)', fontWeight: 600 }}>
            The AI punted {stats.escalated} {stats.escalated === 1 ? 'message' : 'messages'} to SMS without drafting
          </span>
          {' '}— the new classifier should drive this toward zero.
        </>
      )}
      {guestyOnly > 0 && (
        <>
          {' '}You also handled <b>{guestyOnly}</b>{' '}
          {guestyOnly === 1 ? 'message' : 'messages'} directly in Guesty
          {stats.auto_rejected_stale > 0 && (
            <>
              {' '}({stats.manual_sent} captured by the poller, {stats.auto_rejected_stale} expired pre-poller)
            </>
          )}
          {' '}— those don&rsquo;t count against the AI score; we can&rsquo;t tell whether the draft was good or you just preferred Guesty.
        </>
      )}
    </>
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

      <div style={{ marginTop: 24 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 14,
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div className="eyebrow" style={{ color: 'var(--ink-3)' }}>
            Facts the AI knows now ({facts.length} most recent)
          </div>
          <AddFactButton />
        </div>
        {facts.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {facts.map((f) => (
              <FactCard key={f.id} fact={f} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FactCard({ fact }: { fact: Fact }) {
  const router = useRouter();
  const [showSource, setShowSource] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(fact.fact);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSaveEdit = () => {
    setError(null);
    startTransition(async () => {
      const res = await editFactAction(fact.id, { fact: draftText });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  const handleDelete = () => {
    setError(null);
    startTransition(async () => {
      const res = await deleteFactAction(fact.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  const handleRestore = () => {
    setError(null);
    startTransition(async () => {
      const res = await restoreFactAction(fact.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <li
      style={{
        borderTop: '1px solid var(--rule)',
        padding: '16px 4px',
        opacity: fact.is_deleted ? 0.5 : 1,
      }}
    >
      <div
        className="rt-msg-fact-meta"
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'baseline',
          flexWrap: 'wrap',
          marginBottom: 8,
        }}
      >
        <ScopeChip scope={fact.scope} />
        {fact.topic && (
          <span
            className="eyebrow rt-msg-fact-topic"
            style={{ color: 'var(--ink-4)', fontSize: 10 }}
          >
            {fact.topic.replace(/_/g, ' ')}
          </span>
        )}
        {fact.is_edited && (
          <span
            className="eyebrow rt-msg-fact-flag"
            style={{ color: 'var(--signal)', fontSize: 10, fontWeight: 600 }}
            title="Operator-edited from the original distillation"
          >
            <span aria-hidden>✎</span>
            <span className="rt-msg-fact-flag-label"> edited</span>
          </span>
        )}
        {fact.is_custom && (
          <span
            className="eyebrow rt-msg-fact-flag"
            style={{ color: 'var(--signal)', fontSize: 10, fontWeight: 600 }}
            title="Added directly by operator"
          >
            <span aria-hidden>+</span>
            <span className="rt-msg-fact-flag-label"> added</span>
          </span>
        )}
        {fact.is_deleted && (
          <span
            className="eyebrow rt-msg-fact-flag"
            style={{ color: 'var(--ink-4)', fontSize: 10, fontWeight: 600 }}
          >
            deleted
          </span>
        )}
        <span
          className="eyebrow rt-msg-fact-time"
          style={{
            color: 'var(--ink-4)',
            fontSize: 10,
            marginLeft: 'auto',
          }}
        >
          {fact.source_date}
        </span>
      </div>

      {editing ? (
        <div>
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            rows={3}
            style={{
              width: '100%',
              padding: 10,
              border: '1px solid var(--ink)',
              background: 'var(--paper)',
              fontFamily: 'inherit',
              fontSize: 14,
              color: 'var(--ink)',
              resize: 'vertical',
              fontWeight: 600,
              lineHeight: 1.5,
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <SmallPrimaryButton onClick={handleSaveEdit} disabled={isPending || !draftText.trim()}>
              Save edit
            </SmallPrimaryButton>
            <SmallSecondaryButton
              onClick={() => {
                setEditing(false);
                setDraftText(fact.fact);
                setError(null);
              }}
              disabled={isPending}
            >
              Cancel
            </SmallSecondaryButton>
          </div>
        </div>
      ) : (
        <p
          style={{
            margin: 0,
            fontSize: 15,
            lineHeight: 1.5,
            color: 'var(--ink)',
            fontWeight: 600,
            textDecoration: fact.is_deleted ? 'line-through' : 'none',
          }}
        >
          {fact.fact}
        </p>
      )}

      {error && (
        <p
          style={{
            marginTop: 8,
            fontSize: 12,
            color: 'var(--signal)',
            fontWeight: 500,
          }}
          role="alert"
        >
          {error}
        </p>
      )}

      {!editing && (
        <div
          className="rt-msg-fact-actions"
          style={{
            marginTop: 8,
            display: 'flex',
            gap: 14,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          {!fact.is_deleted && (
            <SmallTextButton onClick={() => setEditing(true)} disabled={isPending}>
              Edit
            </SmallTextButton>
          )}
          {!fact.is_deleted ? (
            <SmallTextButton onClick={handleDelete} disabled={isPending} tone="danger">
              Delete
            </SmallTextButton>
          ) : (
            <SmallTextButton onClick={handleRestore} disabled={isPending}>
              Restore
            </SmallTextButton>
          )}
          {fact.source_body_short && (
            <SmallTextButton onClick={() => setShowSource((v) => !v)} disabled={isPending}>
              {showSource ? 'Hide source' : 'Show source'}
            </SmallTextButton>
          )}
        </div>
      )}

      {showSource && fact.source_body_short && (
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
          {fact.is_edited && fact.original_fact && (
            <div style={{ marginBottom: 10, color: 'var(--ink-4)' }}>
              <strong style={{ color: 'var(--ink-3)' }}>Original distillation:</strong>{' '}
              {fact.original_fact}
            </div>
          )}
          <div style={{ color: 'var(--ink-4)', marginBottom: 4, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Original coaching
          </div>
          {fact.source_body_short}
        </div>
      )}
    </li>
  );
}

function AddFactButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fact, setFact] = useState('');
  const [scope, setScope] = useState('');
  const [topic, setTopic] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleCreate = () => {
    setError(null);
    startTransition(async () => {
      const res = await createFactAction({ fact, scope, topic });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setFact('');
      setScope('');
      setTopic('');
      router.refresh();
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          fontSize: 11,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          fontWeight: 600,
          color: 'var(--ink)',
          background: 'var(--paper)',
          border: '1px solid var(--ink)',
          padding: '8px 14px',
          cursor: 'pointer',
        }}
      >
        + Add a fact
      </button>
    );
  }
  return (
    <div
      style={{
        width: '100%',
        marginTop: 12,
        padding: 16,
        background: 'var(--paper-2)',
        border: '1px solid var(--ink)',
      }}
    >
      <div className="eyebrow" style={{ color: 'var(--ink-3)', marginBottom: 10 }}>
        New fact
      </div>
      <textarea
        value={fact}
        onChange={(e) => setFact(e.target.value)}
        placeholder="What should the AI know? (e.g. 'For 53 Rocky Neck minimum stay, see lead-time table.')"
        rows={3}
        style={{
          width: '100%',
          padding: 10,
          border: '1px solid var(--rule)',
          background: 'var(--paper)',
          fontFamily: 'inherit',
          fontSize: 14,
          color: 'var(--ink)',
          fontWeight: 600,
          lineHeight: 1.5,
          marginBottom: 10,
        }}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <div>
          <label
            htmlFor="new-fact-scope"
            className="eyebrow"
            style={{ display: 'block', marginBottom: 4, color: 'var(--ink-4)', fontSize: 10 }}
          >
            Scope
          </label>
          <input
            id="new-fact-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            placeholder="53_rocky_neck, all properties, voice, process"
            style={{
              width: '100%',
              padding: '8px 10px',
              border: '1px solid var(--rule)',
              background: 'var(--paper)',
              fontFamily: 'inherit',
              fontSize: 13,
              color: 'var(--ink)',
            }}
          />
        </div>
        <div>
          <label
            htmlFor="new-fact-topic"
            className="eyebrow"
            style={{ display: 'block', marginBottom: 4, color: 'var(--ink-4)', fontSize: 10 }}
          >
            Topic (optional)
          </label>
          <input
            id="new-fact-topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="minimum_stay, pet_policy, etc."
            style={{
              width: '100%',
              padding: '8px 10px',
              border: '1px solid var(--rule)',
              background: 'var(--paper)',
              fontFamily: 'inherit',
              fontSize: 13,
              color: 'var(--ink)',
            }}
          />
        </div>
      </div>
      {error && (
        <p
          style={{
            margin: '0 0 10px 0',
            fontSize: 12,
            color: 'var(--signal)',
            fontWeight: 500,
          }}
          role="alert"
        >
          {error}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <SmallPrimaryButton onClick={handleCreate} disabled={isPending || !fact.trim() || !scope.trim()}>
          Add fact
        </SmallPrimaryButton>
        <SmallSecondaryButton
          onClick={() => {
            setOpen(false);
            setFact('');
            setScope('');
            setTopic('');
            setError(null);
          }}
          disabled={isPending}
        >
          Cancel
        </SmallSecondaryButton>
      </div>
    </div>
  );
}

function SmallPrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? 'var(--ink-4)' : 'var(--ink)',
        color: 'var(--paper)',
        border: 'none',
        padding: '7px 14px',
        fontSize: 10,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.7 : 1,
      }}
    >
      {children}
    </button>
  );
}

function SmallSecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: 'var(--paper)',
        color: 'var(--ink)',
        border: '1px solid var(--ink)',
        padding: '7px 14px',
        fontSize: 10,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

function SmallTextButton({
  children,
  onClick,
  disabled,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'neutral' | 'danger';
}) {
  const color = tone === 'danger' ? 'var(--signal)' : 'var(--ink-3)';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: 'transparent',
        border: 'none',
        padding: 0,
        fontSize: 11,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        fontWeight: 500,
        color,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
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

