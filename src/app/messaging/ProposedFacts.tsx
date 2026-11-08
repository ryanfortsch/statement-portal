'use client';

/**
 * Property facts to file, every audience in one list (UX audit 2026-11-07,
 * slice 3). Before this the Quality lens drew guest-reply facts in one design
 * (TriagedPropertyUpdates) and cleaner, contractor and owner facts in an
 * older one (ProposedPropertyUpdatesCard), up to four sections for one job.
 * Now one block per home, each row naming whose words it came from, and an
 * audience filter when more than one audience is waiting.
 *
 * The history of the triaged path, kept because it explains the block shape:
 * Dotti, 2026-09-21, looking at 224 of these on /messaging: "is this really
 * the best we can do?" The old card was one mined sentence per row, each with
 * a property dropdown and a two-click review. stay-concierge's kb_triage
 * stage now reads each home's whole pending set against its knowledge base,
 * the only vantage point from which merging and contradiction detection are
 * possible. It arrives already decided: facts the KB holds are gone, halves
 * are merged into one written line, and each item says which KB line it
 * fills or contradicts. So a block shows the rulings first, because a
 * contradiction is the only thing here that genuinely needs a person, then
 * the rest as a pre-checked list that files in one press, then the facts
 * reviewed one at a time.
 *
 * Which path a row takes is decided in src/lib/proposed-facts.ts and did not
 * change in the merge: triaged guest statements file through
 * fileTriagedGroup(s) / dismissTriagedGroup; every other row is a
 * CandidateCard (parse, apply, dismiss). Both route through the same Quick
 * Capture parse + apply, so the credential rules are untouched.
 */

import { useMemo, useState, useTransition } from 'react';
import { Section } from '@/components/Section';
import { Button } from '@/components/Button';
import {
  AUDIENCE_LABEL,
  AUDIENCE_PLURAL,
  audienceCounts,
  buildFactBlocks,
  type AudienceUpdate,
  type FactAudience,
  type FactGroup,
} from '@/lib/proposed-facts';
import {
  fileTriagedGroup,
  fileTriagedGroups,
  dismissTriagedGroup,
} from '../owner-messaging/proposed-updates-actions';
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { CandidateCard, ROW_FACE } from './FactCandidateCard';

type Props = {
  rows: AudienceUpdate[];
  /** One line per audience whose read failed. The rest still render. */
  errors: { audience: FactAudience; message: string }[];
  /** Helm's property list, or null when the lookup failed. null is NOT an
   *  empty registry: the list must not then claim a property is unknown. */
  properties: { id: string; name: string }[] | null;
};

export function ProposedFacts({ rows, errors, properties }: Props) {
  const [audience, setAudience] = useState<FactAudience | 'all'>('all');
  const [houseFilter, setHouseFilter] = useState('');
  const counts = useMemo(() => audienceCounts(rows), [rows]);
  const allBlocks = useMemo(() => buildFactBlocks(rows), [rows]);
  const blocks = useMemo(() => {
    const visible = audience === 'all' ? rows : rows.filter((r) => r.audience === audience);
    const q = houseFilter.trim().toLowerCase();
    return buildFactBlocks(visible).filter((b) => !q || b.propertyName.toLowerCase().includes(q));
  }, [rows, audience, houseFilter]);

  const rulings = allBlocks.reduce((n, b) => n + b.groups.filter((g) => g.needsRuling).length, 0);
  const ready = allBlocks.reduce((n, b) => n + b.groups.filter((g) => !g.needsRuling).length, 0);
  const oneByOne = allBlocks.reduce((n, b) => n + b.candidates.length, 0);
  const tally = [
    rulings > 0 ? { key: 'decide', text: `${rulings} to decide`, signal: true } : null,
    ready > 0 ? { key: 'ready', text: `${ready} ready`, signal: false } : null,
    oneByOne > 0 ? { key: 'review', text: `${oneByOne} to review`, signal: false } : null,
  ].filter((t): t is { key: string; text: string; signal: boolean } => t !== null);

  const errorLines = errors.map((e) => (
    <div key={e.audience} role="alert" style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6, padding: '6px 0' }}>
      <span className="eyebrow" style={{ color: 'var(--signal)', marginRight: 8 }}>{AUDIENCE_PLURAL[e.audience]}</span>
      {e.message}
    </div>
  ));

  if (rows.length === 0) {
    return (
      <Section title="Property facts to file" paddingTop={36}>
        <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 18, fontSize: 13, color: 'var(--ink-4)', lineHeight: 1.6 }}>
          {errorLines.length > 0 ? errorLines : 'Nothing to review.'}
        </div>
      </Section>
    );
  }

  return (
    <Section
      title="Property facts to file"
      eyebrow="Checked against each home's knowledge base where the AI could"
      paddingTop={36}
      right={
        <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
          {tally.map((t, i) => (
            <span key={t.key}>
              {i > 0 && ' · '}
              <span style={t.signal ? { color: 'var(--signal)', fontWeight: 600 } : undefined}>{t.text}</span>
            </span>
          ))}
        </span>
      }
    >
      <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 4 }}>
        {errorLines}
        {(counts.length > 1 || allBlocks.length > 1) && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '12px 0 4px' }}>
            {counts.length > 1 && (
              <div role="group" aria-label="Whose facts" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[{ id: 'all' as const, label: 'All', count: rows.length }, ...counts.map((c) => ({ id: c.audience, label: AUDIENCE_PLURAL[c.audience], count: c.count }))].map((c) => (
                  <Button
                    key={c.id}
                    size="sm"
                    variant={audience === c.id ? 'primary' : 'quiet'}
                    aria-pressed={audience === c.id}
                    onClick={() => setAudience(c.id)}
                  >
                    {`${c.label} ${c.count}`}
                  </Button>
                ))}
              </div>
            )}
            {allBlocks.length > 1 && (
              <input
                type="search"
                aria-label="Find a home in property facts"
                placeholder="Find a home"
                value={houseFilter}
                onChange={(e) => setHouseFilter(e.target.value)}
                style={{ padding: '8px 10px', border: '1px solid var(--rule)', fontSize: 14, background: 'var(--paper)', minWidth: 0, flex: '1 1 180px', maxWidth: 280 }}
              />
            )}
          </div>
        )}
        {blocks.map((b) => (
          <PropertyBlock
            key={b.propertyId}
            propertyId={b.propertyId}
            propertyName={b.propertyName}
            groups={b.groups}
            candidates={b.candidates}
            properties={properties}
          />
        ))}
        {blocks.length === 0 && (
          <div style={{ padding: '18px 0', fontSize: 13, color: 'var(--ink-4)' }}>No home matches.</div>
        )}
      </div>
    </Section>
  );
}

function PropertyBlock({
  propertyId,
  propertyName,
  groups,
  candidates,
  properties,
}: {
  propertyId: string;
  propertyName: string;
  groups: FactGroup[];
  candidates: AudienceUpdate[];
  properties: { id: string; name: string }[] | null;
}) {
  const softRefresh = useSoftRefresh();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<Set<string>>(new Set());
  // Ready statements start ticked, so track the ones a person unticked: a
  // statement that comes into view when the audience filter changes is
  // ticked like the rest.
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState(0);
  const [open, setOpen] = useState(groups.some((g) => g.needsRuling));

  // Unknown only when we actually read the registry and it was absent. A
  // failed read leaves triaged filing on; the server action re-validates the
  // property and reports a real problem.
  const filable = properties === null || properties.some((p) => p.id === propertyId);
  const registryChecked = properties !== null;

  const live = groups.filter((g) => !done.has(g.groupId));
  const rulings = live.filter((g) => g.needsRuling);
  const ready = live.filter((g) => !g.needsRuling);
  const readyChecked = ready.filter((g) => !unchecked.has(g.groupId));

  function markDone(ids: string[]) {
    setDone((prev) => {
      const next = new Set(prev);
      ids.forEach((i) => next.add(i));
      return next;
    });
  }

  function fileOne(g: FactGroup) {
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

  function dismissOne(g: FactGroup) {
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

  if (live.length === 0 && candidates.length === 0) {
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

  const counts = [
    rulings.length > 0 ? { key: 'decide', text: `${rulings.length} to decide`, signal: true } : null,
    ready.length > 0 ? { key: 'ready', text: `${ready.length} ready`, signal: false } : null,
    candidates.length > 0 ? { key: 'review', text: `${candidates.length} to review`, signal: false } : null,
  ].filter((t): t is { key: string; text: string; signal: boolean } => t !== null);

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      style={{ padding: '6px 0 18px', borderBottom: '1px solid var(--rule)' }}
    >
      <summary
        style={{ cursor: 'pointer', padding: '12px 0 0', display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', listStyle: 'none' }}
      >
        <span className="font-serif" style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--ink)' }}>
          {propertyName}
        </span>
        <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
          {counts.map((t, i) => (
            <span key={t.key}>
              {i > 0 && ' · '}
              <span style={t.signal ? { color: 'var(--signal)', fontWeight: 600 } : undefined}>{t.text}</span>
            </span>
          ))}
          {!open && ' ▾'}
        </span>
      </summary>

      {!filable && live.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--signal)', lineHeight: 1.5 }}>
          This property is not in Helm&apos;s registry, so filing is off. The facts stay here.
        </div>
      )}
      {!registryChecked && live.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.5 }}>
          Helm could not read its property list just now, so the registry check was skipped.
          Filing still works and will say so if the property is wrong.
        </div>
      )}
      {(properties === null || properties.length === 0) && candidates.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--signal)', lineHeight: 1.6 }}>
          Property list unavailable, so filing the facts reviewed one at a time is disabled. Reload the page or check
          access; you can still dismiss.
        </div>
      )}
      {error && (
        <div role="alert" style={{ marginTop: 8, fontSize: 12, color: 'var(--signal)', lineHeight: 1.5 }}>
          {error}
        </div>
      )}

      {rulings.map((g) => (
        <Ruling key={g.groupId} g={g} pending={pending} filable={filable} onFile={() => fileOne(g)} onDismiss={() => dismissOne(g)} />
      ))}

      {ready.length > 0 && (
        <div style={{ ...ROW_FACE, borderLeftColor: 'var(--positive)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span className="eyebrow" style={{ color: 'var(--tide-deep)', fontWeight: 600 }}>
              {AUDIENCE_PLURAL.guest} · ready to file
            </span>
            <Button
              variant="primary"
              size="sm"
              onClick={fileChecked}
              disabled={pending || !filable || readyChecked.length === 0}
              watchdog={false}
            >
              {pending ? 'Filing…' : `File ${readyChecked.length}`}
            </Button>
          </div>
          <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
            {ready.map((g) => (
              <li key={g.groupId} style={{ display: 'flex', gap: 10, padding: '7px 0', alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  checked={!unchecked.has(g.groupId)}
                  onChange={(e) => {
                    setUnchecked((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.delete(g.groupId);
                      else next.add(g.groupId);
                      return next;
                    });
                  }}
                  style={{ marginTop: 3, flexShrink: 0, accentColor: 'var(--ink)' }}
                  aria-label={g.statement}
                />
                <span style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2)', minWidth: 0 }}>
                  {g.statement}
                  <FactComparison g={g} />
                  <Meta g={g} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {candidates.map((u) => (
        <CandidateCard key={u.id} candidate={u} properties={properties ?? []} />
      ))}
    </details>
  );
}

function Ruling({
  g,
  pending,
  filable,
  onFile,
  onDismiss,
}: {
  g: FactGroup;
  pending: boolean;
  filable: boolean;
  onFile: () => void;
  onDismiss: () => void;
}) {
  const isConflict = g.verdict === 'conflict';
  return (
    <div style={{ ...ROW_FACE, borderLeftColor: isConflict ? 'var(--signal)' : 'var(--tide)' }}>
      <div className="eyebrow" style={{ color: isConflict ? 'var(--signal)' : 'var(--tide-deep)', fontWeight: 600, marginBottom: 6 }}>
        {AUDIENCE_LABEL[g.audience]}
        {' · '}
        {isConflict ? 'The KB says something else' : g.verdict === 'fill' ? 'Fills an empty slot' : 'Worth a look'}
        {g.section ? <span style={{ color: 'var(--ink-4)', fontWeight: 500 }}> · {g.section}</span> : null}
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--ink)' }}>Proposed: {g.statement}</div>
      <FactComparison g={g} />
      {g.reason && (
        <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.5, color: 'var(--ink-4)' }}>{g.reason}</div>
      )}
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <Button variant="secondary" size="sm" onClick={onFile} disabled={pending || !filable} watchdog={false}>
          {isConflict ? 'Use the new wording' : 'File it'}
        </Button>
        <Button variant="quiet" size="sm" onClick={onDismiss} disabled={pending}>
          {isConflict ? 'Keep what the KB has' : 'Dismiss'}
        </Button>
        <Meta g={g} />
      </div>
    </div>
  );
}

function Meta({ g }: { g: FactGroup }) {
  if (g.mined < 2) return null;
  return (
    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>
      merged from {g.mined} replies
    </span>
  );
}

function FactComparison({ g }: { g: FactGroup }) {
  return (
    <span style={{ display: 'block', fontSize: 12, lineHeight: 1.6, color: 'var(--ink-3)', marginTop: 6 }}>
      <span style={{ display: 'block' }}>Current evidence: {g.evidence || 'No existing wording supplied. Review before filing.'}</span>
      {g.quotes.map((quote, i) => (
        <span key={i} style={{ display: 'block' }}>Source: “{quote}”</span>
      ))}
    </span>
  );
}
