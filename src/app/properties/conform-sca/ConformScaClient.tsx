'use client';

import { useMemo, useState, useTransition, type CSSProperties } from 'react';
import {
  conformOneScaListing,
  publishScaConform,
  type ConformCandidate,
} from '../[id]/stay-cape-ann/actions';

type RowStatus =
  | 'idle' // needs conform
  | 'working' // conforming
  | 'conformed' // staged on the conform branch, ready to publish
  | 'skipped' // already structured
  | 'published' // merged live
  | 'failed';

type RowState = { status: RowStatus; detail?: string };

function initialState(c: ConformCandidate): RowState {
  return c.conformed ? { status: 'skipped', detail: 'Already structured' } : { status: 'idle' };
}

export function ConformScaClient({ initialCandidates }: { initialCandidates: ConformCandidate[] }) {
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(initialCandidates.map((c) => [c.guestyListingId, initialState(c)])),
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [, startTransition] = useTransition();

  const setRow = (id: string, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const counts = useMemo(() => {
    const vals = Object.values(rows);
    return {
      total: vals.length,
      todo: vals.filter((r) => r.status === 'idle').length,
      staged: vals.filter((r) => r.status === 'conformed').length,
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
    setRow(id, { status: 'conformed', detail: undefined });
  }

  function runBulk(fn: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
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
      // Sequential so the batched edits accumulate cleanly on one branch and to
      // respect Guesty / GitHub rate limits.
      const ids = initialCandidates.map((c) => c.guestyListingId).filter((id) => rows[id]?.status === 'idle');
      for (const id of ids) {
        await conformOne(id);
      }
    });

  const publish = () =>
    runBulk(async () => {
      const res = await publishScaConform();
      if (!res.ok) {
        setNotice({ kind: 'err', text: res.error });
        return;
      }
      setRows((prev) =>
        Object.fromEntries(
          Object.entries(prev).map(([id, r]) => [id, r.status === 'conformed' ? { status: 'published' as RowStatus } : r]),
        ),
      );
      setNotice({ kind: 'ok', text: 'Published. The site rebuilds in a couple minutes.' });
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
        <button type="button" style={btnBase} disabled={busy || counts.staged === 0} onClick={publish}>
          {`Publish to site (${counts.staged})`}
        </button>
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
          {counts.total} listings · {counts.todo} to conform · {counts.staged} staged
          {counts.published ? ` · ${counts.published} published` : ''}
          {counts.failed ? ` · ${counts.failed} failed` : ''}
        </span>
      </div>

      {notice && (
        <div
          style={{
            marginTop: 14,
            padding: '10px 14px',
            fontSize: 13,
            border: `1px solid ${notice.kind === 'ok' ? 'var(--positive)' : 'var(--signal)'}`,
            color: notice.kind === 'ok' ? 'var(--positive)' : 'var(--signal)',
          }}
        >
          {notice.text}
        </div>
      )}

      <p style={{ fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.55, margin: '14px 0 4px', maxWidth: 780 }}>
        Conform stages each listing&rsquo;s structured About onto one branch (your Guesty &ldquo;The space&rdquo;
        verbatim when it&rsquo;s already structured, AI-generated otherwise). Then Publish merges the batch once and
        the site rebuilds. Listings already structured are skipped. A listing whose Guesty copy isn&rsquo;t
        structured and has no Helm property to draft from is flagged &mdash; structure it in Guesty first.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 10 }}>
        {initialCandidates.map((c) => {
          const r = rows[c.guestyListingId] ?? { status: 'idle' as RowStatus };
          return (
            <div
              key={c.guestyListingId}
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
                  {c.internalName || c.guestyListingId}
                </div>
              </div>

              <StatusPill state={r} />

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto', flexWrap: 'wrap' }}>
                {r.detail && r.status === 'failed' && (
                  <span style={{ fontSize: 11.5, color: 'var(--signal)', maxWidth: 360 }}>{r.detail}</span>
                )}
                <a href={c.liveUrl} target="_blank" rel="noreferrer" style={link}>
                  Live page ↗
                </a>
                {(r.status === 'idle' || r.status === 'failed') && (
                  <button type="button" style={btnSmall} disabled={busy} onClick={() => runBulk(() => conformOne(c.guestyListingId))}>
                    {r.status === 'failed' ? 'Retry' : 'Conform'}
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
    conformed: { t: 'Staged', c: 'var(--tide-deep)' },
    skipped: { t: 'Already structured', c: 'var(--positive)' },
    published: { t: 'Published ✓', c: 'var(--positive)' },
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
