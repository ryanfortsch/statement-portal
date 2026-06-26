'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  loadListingPhotosAction,
  generateCaptionsAction,
  saveCaptionAction,
  type ListingPhoto,
} from './actions';

type Props = {
  propertyId: string;
};

type LoadState = 'loading' | 'ready' | 'needs-listing' | 'error';

/**
 * Operator surface for the Guesty photo-caption tool. Lives at
 * /properties/[id]/caption-photos.
 *
 * Flow: load the listing's gallery from Guesty -> AI drafts a caption per
 * photo (grounded in our existing listings' captions) into editable
 * fields -> operator tweaks -> "Save to Guesty" pushes each caption to the
 * live listing. Every write is one explicit click; the AI never pushes.
 */
export function CaptionPhotosClient({ propertyId }: Props) {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  const [photos, setPhotos] = useState<ListingPhoto[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const [brief, setBrief] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saveErr, setSaveErr] = useState<Record<string, string>>({});
  const [savingAll, setSavingAll] = useState(false);

  // Fetch the gallery. First statement is the awaited action, so no
  // setState fires synchronously — safe to call straight from the effect
  // (and from the Retry button, which flips to 'loading' itself first).
  const runLoad = useCallback(async () => {
    const res = await loadListingPhotosAction(propertyId);
    if (!res.ok) {
      setLoadState(res.needsListing ? 'needs-listing' : 'error');
      setLoadError(res.error);
      return;
    }
    setPhotos(res.photos);
    setDrafts(Object.fromEntries(res.photos.map((p) => [p.id, p.caption])));
    setLoadError(null);
    setLoadState('ready');
  }, [propertyId]);

  // Initial gallery load. Disable matches the same effect-load pattern used
  // across the app's client components (BankDepositReview, QuickCapture).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { runLoad(); }, [runLoad]);

  function retry() {
    setLoadState('loading');
    setLoadError(null);
    runLoad();
  }

  const emptyIds = photos.filter((p) => !p.caption.trim()).map((p) => p.id);
  const changedIds = photos.filter((p) => (drafts[p.id] ?? '').trim() !== p.caption.trim()).map((p) => p.id);

  async function generate(scope: 'empty' | 'all') {
    const ids = scope === 'empty' ? emptyIds : photos.map((p) => p.id);
    if (ids.length === 0) return;
    setGenerating(true);
    setGenError(null);
    const res = await generateCaptionsAction(propertyId, ids, brief);
    setGenerating(false);
    if (!res.ok) {
      setGenError(res.error);
      return;
    }
    setDrafts((prev) => {
      const next = { ...prev };
      for (const d of res.drafts) next[d.photoId] = d.caption;
      return next;
    });
  }

  async function saveOne(id: string): Promise<boolean> {
    setSaving((s) => ({ ...s, [id]: true }));
    setSaveErr((e) => {
      const rest = { ...e };
      delete rest[id];
      return rest;
    });
    const caption = (drafts[id] ?? '').trim();
    const res = await saveCaptionAction(propertyId, id, caption);
    setSaving((s) => ({ ...s, [id]: false }));
    if (!res.ok) {
      setSaveErr((e) => ({ ...e, [id]: res.error }));
      return false;
    }
    // Reflect the exact caption Guesty stored (the server may have scrubbed
    // it) as the new "current" AND draft, so the row reads clean and the
    // field shows what's actually live.
    setPhotos((ps) => ps.map((p) => (p.id === id ? { ...p, caption: res.caption } : p)));
    setDrafts((d) => ({ ...d, [id]: res.caption }));
    return true;
  }

  async function saveAllChanged() {
    if (changedIds.length === 0) return;
    const ok = window.confirm(
      `Push ${changedIds.length} caption${changedIds.length === 1 ? '' : 's'} to the live Guesty listing? This updates what guests see on Airbnb, VRBO, and staycapeann.com.`,
    );
    if (!ok) return;
    setSavingAll(true);
    // Sequential to stay gentle on Guesty's photo API and surface a clean
    // per-photo error rather than a burst of 429s.
    for (const id of changedIds) {
      await saveOne(id);
    }
    setSavingAll(false);
  }

  if (loadState === 'loading') {
    return <Notice>Loading photos from Guesty…</Notice>;
  }

  if (loadState === 'needs-listing') {
    return (
      <Notice tone="warn">
        <div style={{ marginBottom: 10 }}>{loadError}</div>
        <Link href={`/properties/${propertyId}/stay-cape-ann`} style={inlineLinkStyle}>
          Open the Stay Cape Ann launch page to set the Guesty listing ID →
        </Link>
      </Notice>
    );
  }

  if (loadState === 'error') {
    return (
      <Notice tone="error">
        <div style={{ marginBottom: 10 }}>{loadError}</div>
        <button type="button" onClick={retry} style={ghostButtonStyle}>
          Retry
        </button>
      </Notice>
    );
  }

  const captionedCount = photos.filter((p) => p.caption.trim()).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <style>{gridCss}</style>

      {/* Controls */}
      <div className="rt-cap-toolbar">
        <div className="rt-cap-counts">
          <strong>{photos.length}</strong> photos · <strong>{captionedCount}</strong> captioned ·{' '}
          <strong>{emptyIds.length}</strong> empty
        </div>
        <div className="rt-cap-actions">
          <button
            type="button"
            onClick={() => generate('empty')}
            disabled={generating || emptyIds.length === 0}
            style={primaryButtonStyle}
          >
            {generating ? 'Drafting…' : `Draft empty (${emptyIds.length})`}
          </button>
          <button
            type="button"
            onClick={() => generate('all')}
            disabled={generating || photos.length === 0}
            style={ghostButtonStyle}
          >
            Draft all
          </button>
          <button
            type="button"
            onClick={saveAllChanged}
            disabled={savingAll || changedIds.length === 0}
            style={changedIds.length > 0 ? saveAllButtonStyle : ghostButtonStyle}
          >
            {savingAll ? 'Saving…' : `Save changed to Guesty (${changedIds.length})`}
          </button>
        </div>
      </div>

      <details className="rt-cap-brief">
        <summary>Add a note to ground the drafts (optional)</summary>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="Anything the photos don't show: the bunk room sleeps four, the deck faces the cove, the kitchen range is a Wolf. Used to make captions more specific."
          style={{ ...inputStyle, resize: 'vertical', marginTop: 10, fontFamily: 'inherit', lineHeight: 1.5 }}
        />
      </details>

      {genError && <Notice tone="error">{genError}</Notice>}

      {/* Photo grid */}
      <div className="rt-cap-grid">
        {photos.map((p) => (
          <PhotoCard
            key={p.id}
            photo={p}
            draft={drafts[p.id] ?? ''}
            onDraftChange={(v) => setDrafts((d) => ({ ...d, [p.id]: v }))}
            onSave={() => saveOne(p.id)}
            saving={!!saving[p.id]}
            error={saveErr[p.id] ?? null}
          />
        ))}
      </div>
    </div>
  );
}

function PhotoCard({
  photo,
  draft,
  onDraftChange,
  onSave,
  saving,
  error,
}: {
  photo: ListingPhoto;
  draft: string;
  onDraftChange: (v: string) => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
}) {
  const src = photo.thumbnail || photo.original || '';
  const changed = draft.trim() !== photo.caption.trim();
  const justSaved = !changed && !!photo.caption.trim();

  return (
    <div className="rt-cap-card">
      <div className="rt-cap-thumb">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={photo.caption || 'Listing photo'} loading="lazy" />
        ) : (
          <div className="rt-cap-thumb-empty">No image</div>
        )}
      </div>

      <div className="rt-cap-card-body">
        <div className="rt-cap-current">
          {photo.caption.trim() ? (
            <>
              <span className="rt-cap-current-label">Current</span> {photo.caption}
            </>
          ) : (
            <span className="rt-cap-current-empty">No caption yet</span>
          )}
        </div>

        <textarea
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          rows={2}
          maxLength={250}
          placeholder="Caption…"
          className="rt-cap-input"
        />

        <div className="rt-cap-card-actions">
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !changed}
            className={`rt-cap-save${changed ? ' rt-cap-save-on' : ''}`}
          >
            {saving ? 'Saving…' : justSaved ? 'Saved ✓' : 'Save to Guesty'}
          </button>
          {changed && <span className="rt-cap-dirty">Unsaved</span>}
        </div>

        {error && <div className="rt-cap-error">{error}</div>}
      </div>
    </div>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone?: 'warn' | 'error' }) {
  const border =
    tone === 'error' ? 'var(--negative)' : tone === 'warn' ? 'var(--signal)' : 'var(--rule)';
  const color = tone === 'error' ? 'var(--negative)' : 'var(--ink-3)';
  return (
    <div
      style={{
        padding: '14px 16px',
        borderLeft: `2px solid ${border}`,
        background: 'var(--paper-2)',
        fontSize: 13.5,
        color,
        lineHeight: 1.6,
      }}
    >
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid var(--rule)',
  borderBottom: '1px solid var(--ink)',
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 14,
  padding: '10px 12px',
  outline: 'none',
  boxSizing: 'border-box',
};

const primaryButtonStyle: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  padding: '11px 18px',
  border: '1px solid var(--ink)',
  cursor: 'pointer',
};

const ghostButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  padding: '11px 18px',
  border: '1px solid var(--rule)',
  cursor: 'pointer',
};

const saveAllButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  background: 'var(--positive)',
  borderColor: 'var(--positive)',
};

const inlineLinkStyle: React.CSSProperties = {
  color: 'var(--tide-deep)',
  fontSize: 13,
  fontWeight: 500,
  textDecoration: 'none',
};

const gridCss = `
  .rt-cap-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--rule);
    padding-bottom: 16px;
  }
  .rt-cap-counts { font-size: 13px; color: var(--ink-3); }
  .rt-cap-counts strong { color: var(--ink); font-weight: 600; }
  .rt-cap-actions { display: flex; gap: 10px; flex-wrap: wrap; }

  .rt-cap-brief > summary {
    font-size: 11px;
    letter-spacing: .14em;
    text-transform: uppercase;
    color: var(--ink-4);
    cursor: pointer;
    list-style: none;
  }
  .rt-cap-brief > summary::-webkit-details-marker { display: none; }
  .rt-cap-brief > summary:hover { color: var(--ink-3); }

  .rt-cap-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 20px;
  }

  .rt-cap-card {
    border: 1px solid var(--rule);
    background: var(--paper);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .rt-cap-thumb {
    aspect-ratio: 4 / 3;
    background: var(--paper-2);
    overflow: hidden;
  }
  .rt-cap-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .rt-cap-thumb-empty {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-4);
  }

  .rt-cap-card-body { padding: 12px 12px 14px; display: flex; flex-direction: column; gap: 10px; }
  .rt-cap-current { font-size: 12px; color: var(--ink-3); line-height: 1.5; min-height: 18px; }
  .rt-cap-current-label {
    font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase;
    color: var(--ink-4); font-weight: 600; margin-right: 6px;
  }
  .rt-cap-current-empty { font-style: italic; color: var(--ink-4); }

  .rt-cap-input {
    width: 100%;
    border: 1px solid var(--rule);
    border-bottom: 1px solid var(--ink);
    background: var(--paper);
    color: var(--ink);
    font-size: 14px;
    font-family: inherit;
    line-height: 1.45;
    padding: 9px 10px;
    outline: none;
    resize: vertical;
    box-sizing: border-box;
  }
  .rt-cap-input:focus { border-color: var(--ink); }

  .rt-cap-card-actions { display: flex; align-items: center; gap: 10px; }
  .rt-cap-save {
    background: transparent;
    border: 1px solid var(--rule);
    color: var(--ink-4);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: .14em;
    text-transform: uppercase;
    padding: 8px 13px;
    cursor: pointer;
    transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
  }
  .rt-cap-save-on { color: var(--paper); background: var(--ink); border-color: var(--ink); }
  .rt-cap-save:disabled { cursor: default; }
  .rt-cap-dirty {
    font-size: 10px; letter-spacing: .12em; text-transform: uppercase;
    color: var(--signal); font-weight: 600;
  }
  .rt-cap-error { font-size: 11.5px; color: var(--negative); line-height: 1.5; }
`;
