'use client';

import { useMemo, useState, useTransition, type CSSProperties } from 'react';
import {
  draftListingCopyFromGuesty,
  stageListingCopyEdit,
  publishListingCopyBatch,
  type ListingCopyRow,
} from '../[id]/stay-cape-ann/actions';

// Mirror of the server-side assessListingCopy so the flag chips update live as
// the operator fixes copy (the server is the source of truth on load/stage).
const OTA_BULLET = /[✔✓✅☑]/;
function assess(tagline: string, description: string, highlights: string[]): string[] {
  const t = tagline.trim();
  const d = description.trim();
  const hs = highlights.map((h) => h.trim()).filter(Boolean);
  const flags: string[] = [];
  if (!t && !d && hs.length === 0) flags.push('no copy');
  if (OTA_BULLET.test(t) || OTA_BULLET.test(d) || hs.some((h) => OTA_BULLET.test(h))) flags.push('OTA bullets');
  if (/!/.test(t) || /!/.test(d)) flags.push('exclamation marks');
  if (/[—–]/.test(t) || /[—–]/.test(d)) flags.push('em dashes');
  if (t.length > 140) flags.push('tagline too long');
  if (d.length > 1600) flags.push('About is a wall');
  if (t && hs.length > 0 && hs.length < 3) flags.push('under 3 highlights');
  return flags;
}

type RowStatus = 'idle' | 'drafting' | 'staging' | 'failed';

type Row = {
  id: string;
  publicName: string;
  internalName: string;
  liveUrl: string;
  tagline: string;
  description: string;
  highlights: string[];
  baseline: string; // signature of the last loaded/staged values
  staged: boolean; // has a pending edit on the batch branch at `baseline`
  status: RowStatus;
  detail?: string;
  open: boolean;
};

function sig(tagline: string, description: string, highlights: string[]): string {
  return JSON.stringify([tagline.trim(), description.trim(), highlights.map((h) => h.trim()).filter(Boolean)]);
}

function toRow(c: ListingCopyRow): Row {
  return {
    id: c.guestyListingId,
    publicName: c.publicName,
    internalName: c.internalName,
    liveUrl: c.liveUrl,
    tagline: c.tagline,
    description: c.description,
    highlights: c.highlights.length ? c.highlights : [''],
    baseline: sig(c.tagline, c.description, c.highlights),
    staged: false,
    status: 'idle',
    open: false,
  };
}

export function ListingCopyStudio({ initialRows }: { initialRows: ListingCopyRow[] }) {
  const [rows, setRows] = useState<Row[]>(() => initialRows.map(toRow));
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [, startTransition] = useTransition();

  const patch = (id: string, p: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const counts = useMemo(() => {
    let flagged = 0;
    let staged = 0;
    let unsaved = 0;
    for (const r of rows) {
      if (assess(r.tagline, r.description, r.highlights).length > 0) flagged++;
      const dirty = sig(r.tagline, r.description, r.highlights) !== r.baseline;
      if (dirty) unsaved++;
      else if (r.staged) staged++;
    }
    return { total: rows.length, flagged, staged, unsaved };
  }, [rows]);

  function runBusy(fn: () => Promise<void>) {
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

  async function redraft(r: Row) {
    patch(r.id, { status: 'drafting', detail: undefined });
    const res = await draftListingCopyFromGuesty(r.id);
    if (!res.ok) {
      patch(r.id, { status: 'failed', detail: res.error });
      return;
    }
    patch(r.id, {
      tagline: res.draft.tagline,
      description: res.draft.description,
      highlights: res.draft.highlights.length ? res.draft.highlights : [''],
      status: 'idle',
      open: true,
      detail: res.aiGenerated
        ? 'Redrafted from Guesty in the Stay Cape Ann voice. Review, then stage.'
        : 'Pulled and cleaned the Guesty copy. Review, then stage.',
    });
  }

  async function stage(r: Row) {
    patch(r.id, { status: 'staging', detail: undefined });
    const res = await stageListingCopyEdit(r.id, {
      tagline: r.tagline,
      description: r.description,
      highlights: r.highlights,
    });
    if (!res.ok) {
      patch(r.id, { status: 'failed', detail: res.error });
      return;
    }
    patch(r.id, {
      status: 'idle',
      staged: true,
      baseline: sig(r.tagline, r.description, r.highlights),
      detail: res.staged ? 'Staged. Publish when you’re done with the others.' : undefined,
    });
  }

  const publishAll = () =>
    runBusy(async () => {
      const res = await publishListingCopyBatch();
      if (!res.ok) {
        setNotice({ kind: 'err', text: res.error });
        return;
      }
      setRows((prev) => prev.map((r) => (r.staged ? { ...r, staged: false, status: 'idle', detail: undefined } : r)));
      setNotice({ kind: 'ok', text: 'Published. The site rebuilds in a couple minutes.' });
    });

  const visible = onlyFlagged
    ? rows.filter((r) => assess(r.tagline, r.description, r.highlights).length > 0)
    : rows;

  return (
    <div style={{ marginTop: 24 }}>
      {/* Action bar */}
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
        <button type="button" style={btnPrimary} disabled={busy || counts.staged === 0} onClick={publishAll}>
          {busy ? 'Publishing…' : `Publish all (${counts.staged})`}
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--ink-3)', cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} style={{ width: 15, height: 15 }} />
          Only flagged
        </label>
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)', marginLeft: 'auto' }}>
          {counts.total} listings · {counts.flagged} flagged
          {counts.unsaved ? ` · ${counts.unsaved} unsaved` : ''}
          {counts.staged ? ` · ${counts.staged} staged` : ''}
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

      <p style={{ fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.55, margin: '14px 0 4px', maxWidth: 820 }}>
        Edit a listing&rsquo;s tagline, About, and highlights, then <strong>Stage</strong> it. Staging collects your
        edits on one branch; <strong>Publish all</strong> merges them in a single PR and the site rebuilds once. Leave a
        field blank to fall back to Guesty&rsquo;s copy for it. Editorial voice: concrete and place-anchored, no
        exclamation marks, no em dashes.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 10 }}>
        {visible.map((r) => {
          const liveFlags = assess(r.tagline, r.description, r.highlights);
          const dirty = sig(r.tagline, r.description, r.highlights) !== r.baseline;
          const rowBusy = r.status === 'drafting' || r.status === 'staging';
          return (
            <div key={r.id} style={{ borderBottom: '1px solid var(--rule)' }}>
              {/* Header line */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 4px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => patch(r.id, { open: !r.open })}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--ink-3)', fontSize: 13, width: 14 }}
                  aria-label={r.open ? 'Collapse' : 'Expand'}
                >
                  {r.open ? '▾' : '▸'}
                </button>
                <div style={{ minWidth: 200, flex: '1 1 240px' }}>
                  <div style={{ fontSize: 15, color: 'var(--ink)' }}>{r.publicName}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-4)' }} className="font-mono">
                    {r.internalName || r.id}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {liveFlags.map((f) => (
                    <span key={f} style={chip}>
                      {f}
                    </span>
                  ))}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto', flexWrap: 'wrap' }}>
                  <StatusPill status={r.status} dirty={dirty} staged={r.staged} flagged={liveFlags.length > 0} />
                  <a href={r.liveUrl} target="_blank" rel="noreferrer" style={link}>
                    Live page ↗
                  </a>
                </div>
              </div>

              {/* Editor */}
              {r.open && (
                <div style={{ padding: '4px 4px 22px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {r.detail && (
                    <div style={{ fontSize: 12, color: r.status === 'failed' ? 'var(--signal)' : 'var(--ink-3)', maxWidth: 720 }}>
                      {r.detail}
                    </div>
                  )}

                  <label style={labelWrap}>
                    <span style={labelStyle}>Tagline</span>
                    <input
                      style={inputStyle}
                      value={r.tagline}
                      disabled={rowBusy}
                      onChange={(e) => patch(r.id, { tagline: e.target.value })}
                      placeholder="8–15 words, the italic subhead on the listing page."
                    />
                  </label>

                  <label style={labelWrap}>
                    <span style={labelStyle}>About the home</span>
                    <textarea
                      style={{ ...inputStyle, minHeight: 120, resize: 'vertical', lineHeight: 1.55 }}
                      value={r.description}
                      disabled={rowBusy}
                      onChange={(e) => patch(r.id, { description: e.target.value })}
                      placeholder="One or two short paragraphs in editorial voice. Leave blank to use Guesty's description."
                    />
                  </label>

                  <div>
                    <span style={labelStyle}>Highlights</span>
                    {r.highlights.map((h, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <input
                          style={inputStyle}
                          value={h}
                          disabled={rowBusy}
                          onChange={(e) =>
                            patch(r.id, { highlights: r.highlights.map((x, j) => (j === i ? e.target.value : x)) })
                          }
                          placeholder={`Highlight ${i + 1}`}
                        />
                        {r.highlights.length > 1 && (
                          <button
                            type="button"
                            style={{ ...btnBase, padding: '0 12px' }}
                            disabled={rowBusy}
                            onClick={() => patch(r.id, { highlights: r.highlights.filter((_, j) => j !== i) })}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      style={{ ...btnBase, padding: '6px 12px' }}
                      disabled={rowBusy}
                      onClick={() => patch(r.id, { highlights: [...r.highlights, ''] })}
                    >
                      + Highlight
                    </button>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
                    <button type="button" style={btnBase} disabled={rowBusy || busy} onClick={() => runBusy(() => redraft(r))}>
                      {r.status === 'drafting' ? 'Redrafting…' : 'Redraft from Guesty'}
                    </button>
                    <button type="button" style={btnPrimary} disabled={rowBusy || busy || !dirty} onClick={() => runBusy(() => stage(r))}>
                      {r.status === 'staging' ? 'Staging…' : r.staged && !dirty ? 'Staged ✓' : 'Stage edit'}
                    </button>
                    {r.status === 'failed' && r.detail && (
                      <span style={{ fontSize: 11.5, color: 'var(--signal)', maxWidth: 360 }}>{r.detail}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusPill({
  status,
  dirty,
  staged,
  flagged,
}: {
  status: RowStatus;
  dirty: boolean;
  staged: boolean;
  flagged: boolean;
}) {
  let t: string;
  let c: string;
  if (status === 'drafting') {
    t = 'Redrafting…';
    c = 'var(--tide-deep)';
  } else if (status === 'staging') {
    t = 'Staging…';
    c = 'var(--tide-deep)';
  } else if (status === 'failed') {
    t = 'Failed';
    c = 'var(--signal)';
  } else if (dirty) {
    t = staged ? 'Edited · restage' : 'Unsaved edits';
    c = 'var(--signal)';
  } else if (staged) {
    t = 'Staged ✓';
    c = 'var(--positive)';
  } else if (flagged) {
    t = 'Needs review';
    c = 'var(--ink-3)';
  } else {
    t = 'Clean';
    c = 'var(--positive)';
  }
  return (
    <span style={{ fontSize: 11, letterSpacing: '.07em', textTransform: 'uppercase', fontWeight: 600, color: c, minWidth: 118, textAlign: 'right' }}>
      {t}
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
const labelWrap: CSSProperties = { display: 'block' };
const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 11,
  letterSpacing: '.13em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  marginBottom: 6,
};
const inputStyle: CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  border: '1px solid var(--rule)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  fontSize: 14,
  fontFamily: 'inherit',
};
const chip: CSSProperties = {
  fontSize: 10.5,
  letterSpacing: '.04em',
  textTransform: 'uppercase',
  fontWeight: 600,
  color: 'var(--signal)',
  border: '1px solid var(--signal)',
  borderRadius: 2,
  padding: '2px 7px',
  whiteSpace: 'nowrap',
};
const link: CSSProperties = {
  fontSize: 12,
  color: 'var(--tide-deep)',
  textDecoration: 'none',
  letterSpacing: '.03em',
};
