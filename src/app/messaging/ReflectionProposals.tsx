'use client';

/**
 * "Rules the AI keeps being taught", the weekly reflection pass as decisions.
 *
 * The pass was already right and had no way to say so. It reads the coaching
 * log and the AI-drafted-vs-human-sent diffs, finds what is being corrected
 * repeatedly without landing, and writes proposed rules to
 * prompts/reference/reflection_report.md. By design it never applies them
 * itself: a layer that edits its own rules is how you get confidently wrong
 * twice. But nothing else applied them either. The file had no reader, and
 * api_attention hid the alert on the grounds that it "has its own weekly
 * report", so 25 proposals accumulated across 5 runs with no path to the
 * prompt.
 *
 * The bill for that: on 2026-09-15 the pass filed "Default to K-cup coffee
 * makers across all properties" at [high] confidence, citing two coachings by
 * name. Eleven days and four more coffee coachings later the rule still had
 * not shipped. Across the whole log that one correction had been given 39
 * times, on 12 different properties, and generalized zero times, because
 * per-property scoping is right for a WiFi password and wrong for a fact that
 * has never once varied across the fleet.
 *
 * So this card shows the evidence first, since the operator is being asked to
 * agree the pattern is real, then the rule as an editable field. Promote
 * writes her wording into the canonical layer through the same path as a
 * manual curated edit, and it defaults to fleet scope because that is the
 * whole reason a proposal reached this card.
 */

import { useState, useTransition } from 'react';
import { Section } from '@/components/Section';
import type { ReflectionProposal } from '@/lib/stay-concierge';
import { promoteProposal, dismissProposal } from './reflection-actions';
import { useSoftRefresh } from '@/lib/use-soft-refresh';

type Props = {
  initial: ReflectionProposal[];
  initialError: string | null;
  openCount: number;
  promotedCount: number;
};

const BTN: React.CSSProperties = {
  border: '2px solid var(--ink)',
  padding: '9px 16px',
  fontSize: 11,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  fontWeight: 700,
  whiteSpace: 'nowrap',
};

function confidenceColor(c: string): string {
  if (c === 'high') return 'var(--signal)';
  if (c === 'medium') return 'var(--ink-3)';
  return 'var(--ink-4)';
}

function ProposalCard({ p }: { p: ReflectionProposal }) {
  const [rule, setRule] = useState(p.proposed_rule);
  const [scope, setScope] = useState('all properties');
  const [topic, setTopic] = useState('');
  const [reason, setReason] = useState('');
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const softRefresh = useSoftRefresh();

  const edited = rule.trim() !== p.proposed_rule.trim();

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) softRefresh();
      else setError(res.error);
    });
  }

  return (
    <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 18, paddingBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span
          className="font-serif"
          style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--ink)' }}
        >
          {p.title}
        </span>
        {p.confidence && (
          <span
            className="eyebrow"
            style={{ color: confidenceColor(p.confidence), fontWeight: 600 }}
          >
            {p.confidence}
          </span>
        )}
        <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
          {p.batch}
        </span>
      </div>

      {p.evidence && (
        <div style={{ marginTop: 10, fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
          <span className="eyebrow" style={{ color: 'var(--ink-4)', marginRight: 8 }}>
            Why
          </span>
          {p.evidence}
        </div>
      )}

      <label
        className="eyebrow"
        style={{ display: 'block', marginTop: 16, marginBottom: 6, color: 'var(--ink-4)' }}
      >
        Rule {edited && <span style={{ color: 'var(--signal)' }}>· edited</span>}
      </label>
      <textarea
        value={rule}
        onChange={(e) => setRule(e.target.value)}
        rows={3}
        disabled={pending}
        style={{
          width: '100%',
          padding: 12,
          fontSize: 14,
          lineHeight: 1.6,
          color: 'var(--ink)',
          background: 'var(--paper)',
          border: '1px solid var(--rule)',
          borderRadius: 2,
          resize: 'vertical',
          fontFamily: 'inherit',
        }}
      />

      <div style={{ display: 'flex', gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
        <div>
          <label className="eyebrow" style={{ display: 'block', marginBottom: 6, color: 'var(--ink-4)' }}>
            Scope
          </label>
          <input
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            disabled={pending}
            style={{
              padding: '8px 10px',
              fontSize: 13,
              color: 'var(--ink)',
              background: 'var(--paper)',
              border: '1px solid var(--rule)',
              borderRadius: 2,
              minWidth: 180,
              fontFamily: 'inherit',
            }}
          />
        </div>
        <div>
          <label className="eyebrow" style={{ display: 'block', marginBottom: 6, color: 'var(--ink-4)' }}>
            Topic (optional)
          </label>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="amenities"
            disabled={pending}
            style={{
              padding: '8px 10px',
              fontSize: 13,
              color: 'var(--ink)',
              background: 'var(--paper)',
              border: '1px solid var(--rule)',
              borderRadius: 2,
              minWidth: 160,
              fontFamily: 'inherit',
            }}
          />
        </div>
      </div>

      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.5 }}>
        {scope.trim().toLowerCase() === 'all properties'
          ? 'Fleet-wide: rides on every draft, for every home.'
          : `Scoped: shows only on drafts for ${scope.trim() || 'that property'}.`}{' '}
        Promoting puts this in the canonical layer, above the property knowledge base.
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          disabled={pending || !rule.trim()}
          onClick={() => run(() => promoteProposal(p.id, rule, scope, topic))}
          style={{
            ...BTN,
            background: 'var(--ink)',
            color: 'var(--paper)',
            cursor: pending || !rule.trim() ? 'not-allowed' : 'pointer',
            opacity: pending || !rule.trim() ? 0.5 : 1,
          }}
        >
          {pending ? 'Working' : 'Promote to canon'}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setDismissing((v) => !v)}
          style={{
            ...BTN,
            background: 'transparent',
            color: 'var(--ink)',
            cursor: pending ? 'not-allowed' : 'pointer',
            opacity: pending ? 0.5 : 1,
          }}
        >
          Dismiss
        </button>
      </div>

      {dismissing && (
        <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why not? (optional, tells the weekly pass)"
            disabled={pending}
            style={{
              flex: 1,
              minWidth: 260,
              padding: '9px 10px',
              fontSize: 13,
              color: 'var(--ink)',
              background: 'var(--paper)',
              border: '1px solid var(--rule)',
              borderRadius: 2,
              fontFamily: 'inherit',
            }}
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => dismissProposal(p.id, reason))}
            style={{
              ...BTN,
              background: 'transparent',
              color: 'var(--signal)',
              borderColor: 'var(--signal)',
              cursor: pending ? 'not-allowed' : 'pointer',
              opacity: pending ? 0.5 : 1,
            }}
          >
            {pending ? 'Working' : 'Confirm dismiss'}
          </button>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--signal)', lineHeight: 1.5 }}>{error}</div>
      )}
    </div>
  );
}

export function ReflectionProposals({ initial, initialError, openCount, promotedCount }: Props) {
  if (initialError) {
    return (
      <Section title="Rules the AI keeps being taught" paddingTop={36}>
        <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 18, fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
          {initialError}
        </div>
      </Section>
    );
  }

  if (initial.length === 0) {
    return (
      <Section title="Rules the AI keeps being taught" paddingTop={36}>
        <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 18, fontSize: 13, color: 'var(--ink-4)', lineHeight: 1.6 }}>
          Nothing waiting. The weekly pass reads your coaching and the edits you make to
          drafts, and files a rule here when the same correction keeps coming back.
          {promotedCount > 0 && ` ${promotedCount} adopted so far.`}
        </div>
      </Section>
    );
  }

  return (
    <Section
      title="Rules the AI keeps being taught"
      eyebrow="From repeated coaching the canon never absorbed"
      paddingTop={36}
      right={
        <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
          <span style={{ color: 'var(--signal)', fontWeight: 600 }}>{openCount} to decide</span>
          {promotedCount > 0 && ` · ${promotedCount} adopted`}
        </span>
      }
    >
      {initial.map((p) => (
        <ProposalCard key={p.id} p={p} />
      ))}
    </Section>
  );
}
