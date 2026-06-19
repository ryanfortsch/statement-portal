'use client';

import { useMemo, useState, useTransition, type CSSProperties } from 'react';
import {
  conformOneScaListing,
  publishScaUpdate,
  type ConformCandidate,
} from '../[id]/stay-cape-ann/actions';

type RowStatus =
  | 'idle' // needs conform
  | 'working' // conforming
  | 'pr-open' // update PR opened, ready to review + publish
  | 'publishing'
  | 'published'
  | 'skipped' // already structured
  | 'failed';

type RowState = { status: RowStatus; detail?: string; prUrl?: string | null };

function initialState(c: ConformCandidate): RowState {
  if (c.pendingUpdate) return { status: 'pr-open', prUrl: c.prUrl };
  if (c.conformed) return { status: 'skipped', detail: 'Already structured' };
  return { status: 'idle' };
}

export function ConformScaClient({ initialCandidates }: { initialCandidates: ConformCandidate[] }) {
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(initialCandidates.map((c) => [c.propertyId, initialState(c)])),
  );
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const setRow = (id: string, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const counts = useMemo(() => {
    const vals = Object.values(rows);
    return {
      total: vals.length,
      todo: vals.filter((r) => r.status === 'idle').length,
      toPublish: vals.filter((r) => r.status === 'pr-open').length,
      published: vals.filter((r) => r.status === 'published').length,
      skipped: vals.filter((r) => r.status === 'skipped').length,
      failed: vals.filter((r) => r.status === 'failed').length,
    };
  }, [rows]);

  async function conformOne(id: string) {
    setRow(id, { status: 'working', detail: undefined });
    const res = await conformOneScaListing(id);
    if (!res.ok) {
      setRow(id, { status: 'failed', detail: res.error });
      return;
    }
    if (res.status === 'skipped') {
      setRow(id, { status: 'skipped', detail: res.detail ?? 'Already structured' });
      return;
    }
    setRow(id, { status: 'pr-open', prUrl: res.prUrl ?? null, detail: undefined });
  }

  async function publishOne(id: string) {
    setRow(id, { status: 'publishing', detail: undefined });
    const res = await publishScaUpdate(id);
    if (!res.ok) {
      setRow(id, { status: 'failed', detail: res.error ?? 'Publish failed' });
      return;
    }
    setRow(id, { status: 'published', detail: undefined });
  }

  function runBulk(fn: () => Promise<void>) {
    setBusy(true);
    startTransition(async () => {
      try {
        await fn();
      } finally {
        setBusy(false);
      }
    });
  }

  const conformAll = () =>
    runBulk(async () => {
      // Snapshot the ids needing conform so the loop is stable as state updates.
      // Sequential to respect Guesty / GitHub rate limits.
      const ids = initialCandidates.map((c) => c.propertyId).filter((id) => rows[id]?.status === 'idle');
      for (const id of ids) {
        await conformOne(id);
      }
    });

  const publishAll = () =>
    runBulk(async () => {
      // Sequential merges.
      const ids = initialCandidates.map((c) => c.propertyId).filter((id) => rows[id]?.status === 'pr-open');
      for (const id of ids) {
        await publishOne(id);
      }
    });

  return (
    <div style={{ marginTop: 24 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'wrap',
          paddingBottom: 18,
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <button type="button" style={btnPrimary} disabled={busy || counts.todo === 0} onClick={conformAll}>
          {busy ? 'Working…' : `Conform all (${counts.todo})`}
        </button>
        <button type="button" style={btnBase} disabled={busy || counts.toPublish === 0} onClick={publishAll}>
          {`Publish all updates (${counts.toPublish})`}
        </button>
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
          {counts.total} live · {counts.todo} to conform · {counts.toPublish} to publish
          {counts.published ? ` · ${counts.published} published` : ''}
          {counts.failed ? ` · ${counts.failed} failed` : ''}
        </span>
      </div>

      <p style={{ fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.55, margin: '14px 0 4px', maxWidth: 760 }}>
        Conform opens an update PR per listing without taking the page down. Review each one (open the PR or the
        property&rsquo;s preview), then Publish to merge and refresh the live page. Listings already in the
        structured format are skipped.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 10 }}>
        {initialCandidates.map((c) => {
          const r = rows[c.propertyId] ?? { status: 'idle' as RowStatus };
          return (
            <div
              key={c.propertyId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '14px 4px',
                borderBottom: '1px solid var(--rule)',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ minWidth: 220, flex: '1 1 240px' }}>
                <div style={{ fontSize: 15, color: 'var(--ink)' }}>{c.publicName}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-4)' }} className="font-mono">
                  {c.guestyListingId || c.propertyId}
                </div>
              </div>

              <StatusPill state={r} />

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto', flexWrap: 'wrap' }}>
                {r.detail && r.status === 'failed' && (
                  <span style={{ fontSize: 11.5, color: 'var(--signal)', maxWidth: 320 }}>{r.detail}</span>
                )}
                {r.prUrl && (
                  <a href={r.prUrl} target="_blank" rel="noreferrer" style={link}>
                    PR ↗
                  </a>
                )}
                <a href={`/properties/${c.propertyId}/stay-cape-ann`} target="_blank" rel="noreferrer" style={link}>
                  Open page ↗
                </a>
                {(r.status === 'idle' || r.status === 'failed') && (
                  <button type="button" style={btnSmall} disabled={busy} onClick={() => conformOne(c.propertyId)}>
                    {r.status === 'failed' ? 'Retry' : 'Conform'}
                  </button>
                )}
                {r.status === 'pr-open' && (
                  <button type="button" style={btnSmall} disabled={busy} onClick={() => publishOne(c.propertyId)}>
                    Publish
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusPill({ state }: { state: RowState }) {
  const map: Record<RowStatus, { t: string; c: string }> = {
    idle: { t: 'Needs conform', c: 'var(--ink-3)' },
    working: { t: 'Conforming…', c: 'var(--tide-deep)' },
    'pr-open': { t: 'Update PR open', c: 'var(--tide-deep)' },
    publishing: { t: 'Publishing…', c: 'var(--tide-deep)' },
    published: { t: 'Published ✓', c: 'var(--positive)' },
    skipped: { t: 'Already structured', c: 'var(--positive)' },
    failed: { t: 'Failed', c: 'var(--signal)' },
  };
  const s = map[state.status];
  return (
    <span
      style={{
        fontSize: 11,
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        fontWeight: 600,
        color: s.c,
        minWidth: 130,
      }}
    >
      {s.t}
    </span>
  );
}

const btnBase: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '.04em',
  padding: '9px 15px',
  border: '1px solid var(--ink)',
  cursor: 'pointer',
  background: 'var(--paper)',
  color: 'var(--ink)',
};
const btnPrimary: CSSProperties = { ...btnBase, background: 'var(--ink)', color: 'var(--paper)' };
const btnSmall: CSSProperties = { ...btnBase, padding: '5px 11px', fontSize: 11 };
const link: CSSProperties = {
  fontSize: 12,
  color: 'var(--tide-deep)',
  textDecoration: 'none',
  letterSpacing: '.03em',
};
