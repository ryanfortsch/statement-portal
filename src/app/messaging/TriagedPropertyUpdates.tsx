'use client';

/**
 * "Proposed property updates", reviewed a property at a time.
 *
 * Dotti, 2026-09-21, looking at 224 of these on /messaging: "is this really
 * the best we can do? Can't you understand / reason, think through what
 * should be added to the knowledge base in an automated, seamless, elegant,
 * sophisticated way?"
 *
 * The old card was one mined sentence per row, each with a property dropdown
 * and a two-click review, 342 of them and growing faster than anyone could
 * clear it. Four rows in one screenshot were the same property, mined from
 * the same reply; two were halves of one pet policy; one ("Wingaersheek
 * sleeps eight") was already in that KB verbatim. Nothing had ever read the
 * knowledge base back.
 *
 * stay-concierge's kb_triage stage now does, once per property over its whole
 * pending set, which is the only vantage point from which merging and
 * contradiction detection are possible. It arrives here already decided:
 * facts the KB holds are gone, halves are merged into one written line, and
 * each item says which KB line it fills or contradicts.
 *
 * So this shows one block per property with the rulings first, because a
 * contradiction is the only thing here that genuinely needs a person, and the
 * rest as a pre-checked list that files in one press. Filing routes through
 * the same Quick Capture parse + apply as before, so the credential rules are
 * untouched. Candidates the sweep has not reached keep the old card.
 */

import { useMemo, useState, useTransition } from 'react';
import { Section } from '@/components/Section';
import type { ProposedPropertyUpdate } from '@/lib/stay-concierge';
import {
  fileTriagedGroup,
  fileTriagedGroups,
  dismissTriagedGroup,
} from '../owner-messaging/proposed-updates-actions';
import { useSoftRefresh } from '@/lib/use-soft-refresh';

type Props = {
  initial: ProposedPropertyUpdate[];
  initialError: string | null;
  properties: { id: string; name: string }[];
  source?: 'owner' | 'cleaner' | 'contractor' | 'guest';
};

/** One triaged statement, with every candidate merged into it. */
type Group = {
  groupId: string;
  propertyId: string;
  propertyName: string;
  candidateIds: string[];
  statement: string;
  section: string;
  evidence: string;
  reason: string;
  verdict: string;
  confidence: string;
  needsRuling: boolean;
  category: string;
  /** How many mined messages this was written from. */
  mined: number;
};

function toGroups(updates: ProposedPropertyUpdate[]): { groups: Group[]; untriaged: ProposedPropertyUpdate[] } {
  const byGroup = new Map<string, Group>();
  const untriaged: ProposedPropertyUpdate[] = [];
  for (const u of updates) {
    const t = u.triage;
    if (!t || !t.statement) {
      untriaged.push(u);
      continue;
    }
    const existing = byGroup.get(t.group_id);
    if (existing) {
      if (!existing.candidateIds.includes(u.id)) existing.candidateIds.push(u.id);
      existing.mined = existing.candidateIds.length;
      continue;
    }
    byGroup.set(t.group_id, {
      groupId: t.group_id,
      propertyId: t.property_id || u.property_id,
      propertyName: u.property_name || t.property_id || u.property_id,
      candidateIds: [u.id],
      statement: t.statement,
      section: t.kb_section,
      evidence: t.evidence,
      reason: t.reason,
      verdict: t.verdict,
      confidence: t.confidence,
      needsRuling: t.needs_ruling || t.verdict === 'conflict',
      category: u.category,
      mined: 1,
    });
  }
  return { groups: [...byGroup.values()], untriaged };
}

export function TriagedPropertyUpdates({ initial, initialError, properties, source = 'guest' }: Props) {
  const { groups, untriaged } = useMemo(() => toGroups(initial ?? []), [initial]);

  const byProperty = useMemo(() => {
    const m = new Map<string, Group[]>();
    for (const g of groups) {
      const key = g.propertyId || '(unassigned)';
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(g);
    }
    // Properties with a ruling waiting come first; then the biggest piles.
    return [...m.entries()].sort((a, b) => {
      const ra = a[1].filter((g) => g.needsRuling).length;
      const rb = b[1].filter((g) => g.needsRuling).length;
      if (ra !== rb) return rb - ra;
      return b[1].length - a[1].length;
    });
  }, [groups]);

  const rulings = groups.filter((g) => g.needsRuling).length;
  const ready = groups.length - rulings;

  if (initialError) {
    return (
      <Section title="Proposed property updates" paddingTop={36}>
        <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 18, fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
          {initialError}
        </div>
      </Section>
    );
  }

  if (groups.length === 0 && untriaged.length === 0) {
    return (
      <Section title="Proposed property updates" paddingTop={36}>
        <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 18, fontSize: 13, color: 'var(--ink-4)', lineHeight: 1.6 }}>
          Nothing to review. Facts mined from your own replies are checked against each
          property&apos;s knowledge base first, so only what the KB is actually missing,
          or contradicts, reaches this list.
        </div>
      </Section>
    );
  }

  return (
    <Section
      title="Proposed property updates"
      eyebrow="Checked against each property's knowledge base"
      paddingTop={36}
      right={
        <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
          {rulings > 0 && (
            <span style={{ color: 'var(--signal)', fontWeight: 600 }}>{rulings} to decide</span>
          )}
          {rulings > 0 && ready > 0 && ' · '}
          {ready > 0 && `${ready} ready`}
        </span>
      }
    >
      <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 4 }}>
        {byProperty.map(([pid, gs]) => (
          <PropertyBlock
            key={pid}
            propertyId={pid}
            propertyName={gs[0]?.propertyName || pid}
            groups={gs}
            filable={properties.some((p) => p.id === pid)}
          />
        ))}
        {untriaged.length > 0 && (
          <div style={{ padding: '14px 0 0', fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.6 }}>
            {untriaged.length} newer {untriaged.length === 1 ? 'fact has' : 'facts have'} not been
            checked against a knowledge base yet. {source === 'guest' ? 'The sweep runs every six hours.' : ''}
          </div>
        )}
      </div>
    </Section>
  );
}

function PropertyBlock({
  propertyId,
  propertyName,
  groups,
  filable,
}: {
  propertyId: string;
  propertyName: string;
  groups: Group[];
  filable: boolean;
}) {
  const softRefresh = useSoftRefresh();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(groups.filter((g) => !g.needsRuling).map((g) => g.groupId)),
  );
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState(0);
  const [open, setOpen] = useState(true);

  const live = groups.filter((g) => !done.has(g.groupId));
  const rulings = live.filter((g) => g.needsRuling);
  const ready = live.filter((g) => !g.needsRuling);
  const readyChecked = ready.filter((g) => checked.has(g.groupId));

  function markDone(ids: string[]) {
    setDone((prev) => {
      const next = new Set(prev);
      ids.forEach((i) => next.add(i));
      return next;
    });
  }

  function fileOne(g: Group) {
    setError(null);
    start(async () => {
      const res = await fileTriagedGroup(g.candidateIds, propertyId, g.statement, g.category);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      markDone([g.groupId]);
      setFiled((n) => n + 1);
      softRefresh();
    });
  }

  function dismissOne(g: Group) {
    setError(null);
    start(async () => {
      const res = await dismissTriagedGroup(g.candidateIds);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      markDone([g.groupId]);
      softRefresh();
    });
  }

  function fileChecked() {
    setError(null);
    const batch = readyChecked;
    if (batch.length === 0) return;
    start(async () => {
      const res = await fileTriagedGroups(
        propertyId,
        batch.map((g) => ({ candidateIds: g.candidateIds, statement: g.statement, category: g.category })),
      );
      const failedStatements = new Set(res.failed.map((f) => f.statement));
      markDone(batch.filter((g) => !failedStatements.has(g.statement)).map((g) => g.groupId));
      setFiled((n) => n + res.filed);
      if (res.failed.length) {
        setError(
          res.failed.length === 1
            ? res.failed[0].error
            : `${res.failed.length} could not be filed. ${res.failed[0].error}`,
        );
      }
      softRefresh();
    });
  }

  if (live.length === 0) {
    return (
      <div style={{ padding: '12px 0', borderBottom: '1px solid var(--rule-soft)' }}>
        <span className="font-serif" style={{ fontSize: 15, color: 'var(--ink-3)' }}>
          {propertyName}
        </span>
        <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--positive)', fontWeight: 600 }}>
          {filed > 0 ? `${filed} filed` : 'Cleared'}
        </span>
      </div>
    );
  }

  return (
    <div style={{ padding: '18px 0', borderBottom: '1px solid var(--rule)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'baseline', gap: 10 }}
        >
          <span className="font-serif" style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--ink)' }}>
            {propertyName}
          </span>
          <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
            {rulings.length > 0 && (
              <span style={{ color: 'var(--signal)', fontWeight: 600 }}>
                {rulings.length} to decide
              </span>
            )}
            {rulings.length > 0 && ready.length > 0 && ' · '}
            {ready.length > 0 && `${ready.length} ready`}
            {!open && ' ▾'}
          </span>
        </button>
        {open && ready.length > 0 && (
          <button
            type="button"
            onClick={fileChecked}
            disabled={pending || !filable || readyChecked.length === 0}
            style={{
              background: 'var(--ink)',
              color: 'var(--paper)',
              border: '2px solid var(--ink)',
              padding: '9px 16px',
              fontSize: 11,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              fontWeight: 700,
              cursor: pending || !filable || readyChecked.length === 0 ? 'not-allowed' : 'pointer',
              opacity: pending || !filable || readyChecked.length === 0 ? 0.5 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            {pending ? 'Filing…' : `File ${readyChecked.length}`}
          </button>
        )}
      </div>

      {!filable && open && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--signal)', lineHeight: 1.5 }}>
          This property is not in Helm&apos;s registry, so filing is off. The facts stay here.
        </div>
      )}
      {error && (
        <div role="alert" style={{ marginTop: 8, fontSize: 12, color: 'var(--signal)', lineHeight: 1.5 }}>
          {error}
        </div>
      )}

      {open && (
        <>
          {rulings.map((g) => (
            <Ruling key={g.groupId} g={g} pending={pending} filable={filable} onFile={() => fileOne(g)} onDismiss={() => dismissOne(g)} />
          ))}

          {ready.length > 0 && (
            <ul style={{ listStyle: 'none', margin: '14px 0 0', padding: 0 }}>
              {ready.map((g) => (
                <li key={g.groupId} style={{ display: 'flex', gap: 10, padding: '7px 0', alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={checked.has(g.groupId)}
                    onChange={(e) => {
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(g.groupId);
                        else next.delete(g.groupId);
                        return next;
                      });
                    }}
                    style={{ marginTop: 3, flexShrink: 0, accentColor: 'var(--ink)' }}
                    aria-label={g.statement}
                  />
                  <span style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2)', minWidth: 0 }}>
                    {g.statement}
                    <Meta g={g} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function Ruling({
  g,
  pending,
  filable,
  onFile,
  onDismiss,
}: {
  g: Group;
  pending: boolean;
  filable: boolean;
  onFile: () => void;
  onDismiss: () => void;
}) {
  const isConflict = g.verdict === 'conflict';
  return (
    <div
      style={{
        marginTop: 14,
        borderLeft: `3px solid ${isConflict ? 'var(--signal)' : 'var(--tide)'}`,
        background: 'var(--paper-2)',
        padding: '12px 14px',
      }}
    >
      <div className="eyebrow" style={{ color: isConflict ? 'var(--signal)' : 'var(--tide-deep)', fontWeight: 600, marginBottom: 6 }}>
        {isConflict ? 'The KB says something else' : g.verdict === 'fill' ? 'Fills an empty slot' : 'Worth a look'}
        {g.section ? <span style={{ color: 'var(--ink-4)', fontWeight: 500 }}> · {g.section}</span> : null}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--ink)' }}>{g.statement}</div>
      {g.evidence && (
        <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.5, color: 'var(--ink-3)' }}>
          <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>KB today</span>{' '}
          <span style={{ fontStyle: 'italic' }}>{g.evidence}</span>
        </div>
      )}
      {g.reason && (
        <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.5, color: 'var(--ink-4)' }}>{g.reason}</div>
      )}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onFile}
          disabled={pending || !filable}
          style={{
            background: 'var(--paper)',
            color: 'var(--ink-2)',
            border: '1px solid var(--ink-3)',
            padding: '8px 14px',
            fontSize: 11,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            fontWeight: 500,
            cursor: pending || !filable ? 'not-allowed' : 'pointer',
            opacity: pending || !filable ? 0.5 : 1,
          }}
        >
          {isConflict ? 'Use the new wording' : 'File it'}
        </button>
        <button type="button" onClick={onDismiss} disabled={pending} className="rt-quiet-btn">
          {isConflict ? 'Keep what the KB has' : 'Dismiss'}
        </button>
        <Meta g={g} />
      </div>
    </div>
  );
}

function Meta({ g }: { g: Group }) {
  if (g.mined < 2) return null;
  return (
    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>
      merged from {g.mined} replies
    </span>
  );
}
