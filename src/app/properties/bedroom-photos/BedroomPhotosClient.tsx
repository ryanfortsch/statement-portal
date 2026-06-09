'use client';

import { useMemo, useState, useTransition, type CSSProperties } from 'react';
import Image from 'next/image';
import { PhotoUploader } from '@/components/PhotoUploader';
import { publishBedroomPhotos, type PublishBedroomResult } from './actions';

/** One bedroom slot in the editor (photos held as an array of Blob URLs). */
export type BedroomSlot = { name?: string; beds?: string; photo: string[] };

/** A Stay Cape Ann listing as surfaced to the picker/editor. */
export type BedroomListing = {
  guestyListingId: string;
  internalName: string;
  publicName: string;
  slug: string;
  /** Bedroom count from the bundled SCA snapshot, when known. */
  bedrooms: number | null;
  /** Existing registry sleeping arrangements (photos normalized to arrays). */
  arrangements: BedroomSlot[];
  /** Photos currently live via the legacy public/photos folder (read-only). */
  legacyPhotoUrls: string[];
};

const inputStyle: CSSProperties = {
  width: '100%',
  background: 'var(--paper-2)',
  border: '1px solid var(--rule)',
  padding: '9px 11px',
  fontSize: 13,
  color: 'var(--ink)',
};

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 10,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  fontWeight: 500,
};

function photoCount(slots: BedroomSlot[]): number {
  return slots.reduce((n, s) => n + s.photo.length, 0);
}

function seedDraft(listing: BedroomListing): BedroomSlot[] {
  if (listing.arrangements.length) {
    // Deep-copy so edits don't mutate the prop.
    return listing.arrangements.map((s) => ({ name: s.name, beds: s.beds, photo: [...s.photo] }));
  }
  const n = Math.max(listing.bedrooms ?? 1, 1);
  return Array.from({ length: n }, () => ({ photo: [] as string[] }));
}

export function BedroomPhotosClient({
  listings: initial,
  initialListingId = null,
}: {
  listings: BedroomListing[];
  initialListingId?: string | null;
}) {
  // When deep-linked from a property page (?listing=<guestyId>), open straight
  // into that listing's editor instead of the picker.
  const preselected = initial.find((l) => l.guestyListingId === initialListingId) ?? null;
  const [listings, setListings] = useState<BedroomListing[]>(initial);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(preselected?.guestyListingId ?? null);
  const [draft, setDraft] = useState<BedroomSlot[]>(preselected ? seedDraft(preselected) : []);
  const [result, setResult] = useState<PublishBedroomResult | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = listings.find((l) => l.guestyListingId === selectedId) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...listings].sort((a, b) => a.internalName.localeCompare(b.internalName));
    if (!q) return sorted;
    return sorted.filter(
      (l) =>
        l.internalName.toLowerCase().includes(q) ||
        l.publicName.toLowerCase().includes(q),
    );
  }, [listings, query]);

  function select(listing: BedroomListing) {
    setSelectedId(listing.guestyListingId);
    setDraft(seedDraft(listing));
    setResult(null);
  }

  function updateSlot(i: number, patch: Partial<BedroomSlot>) {
    setDraft((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }

  function addBedroom() {
    setDraft((prev) => [...prev, { photo: [] }]);
  }

  function removeBedroom(i: number) {
    setDraft((prev) => prev.filter((_, j) => j !== i));
  }

  function publish() {
    if (!selected) return;
    setResult(null);
    startTransition(async () => {
      const res = await publishBedroomPhotos(
        selected.guestyListingId,
        selected.internalName,
        draft.map((s) => ({ name: s.name, beds: s.beds, photo: s.photo })),
      );
      setResult(res);
      // Reflect the saved state back into the list so badges update and a
      // re-open of this listing shows what was just published.
      if (res.ok) {
        setListings((prev) =>
          prev.map((l) =>
            l.guestyListingId === selected.guestyListingId
              ? { ...l, arrangements: draft.map((s) => ({ name: s.name, beds: s.beds, photo: [...s.photo] })) }
              : l,
          ),
        );
      }
    });
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 320px) 1fr', gap: 28, alignItems: 'start' }}>
      {/* LEFT — listing picker */}
      <aside style={{ position: 'sticky', top: 84 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search listings…"
          style={{ ...inputStyle, marginBottom: 12 }}
        />
        <div style={{ borderTop: '1px solid var(--rule)' }}>
          {filtered.map((l) => {
            const isSel = l.guestyListingId === selectedId;
            const registryPhotos = photoCount(l.arrangements);
            const hasAny = registryPhotos > 0 || l.legacyPhotoUrls.length > 0;
            return (
              <button
                key={l.guestyListingId}
                type="button"
                onClick={() => select(l)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '11px 10px',
                  borderBottom: '1px solid var(--rule)',
                  background: isSel ? 'var(--paper-2)' : 'transparent',
                  borderLeft: isSel ? '2px solid var(--signal)' : '2px solid transparent',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500 }}>{l.internalName}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
                  {l.publicName || '—'}
                </div>
                <div style={{ fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', marginTop: 5, color: hasAny ? 'var(--ink-3)' : 'var(--signal)' }}>
                  {hasAny
                    ? `${registryPhotos || l.legacyPhotoUrls.length} photo${(registryPhotos || l.legacyPhotoUrls.length) === 1 ? '' : 's'}${registryPhotos === 0 && l.legacyPhotoUrls.length ? ' (legacy)' : ''}`
                    : 'Needs photos'}
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: '16px 10px', fontSize: 13, color: 'var(--ink-3)' }}>No listings match.</div>
          )}
        </div>
      </aside>

      {/* RIGHT — editor */}
      <section>
        {!selected ? (
          <div style={{ padding: '40px 0', fontSize: 14, color: 'var(--ink-3)' }}>
            Pick a listing on the left to add or replace its bedroom photos. Drop the
            photos straight in — no file names, no commands. Publishing updates
            staycapeann.com for you.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, marginBottom: 4 }}>
              <h2 className="font-serif" style={{ fontSize: 24, fontWeight: 500, color: 'var(--ink)' }}>
                {selected.internalName}
              </h2>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{selected.publicName}</span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 20, lineHeight: 1.5 }}>
              One bedroom per row. Add a photo (or a few) for each. A name and bed
              config are optional — leave them blank and the page shows “Bedroom 1”,
              “Bedroom 2” with whatever Guesty has.
            </p>

            {selected.legacyPhotoUrls.length > 0 && (
              <div style={{ marginBottom: 24, padding: '12px 14px', background: 'var(--paper-2)', border: '1px solid var(--rule)' }}>
                <div style={{ ...labelStyle, marginBottom: 8 }}>
                  Currently on the site (legacy folder) — replaced per bedroom by anything you add below
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {selected.legacyPhotoUrls.map((url, i) => (
                    <span key={url} style={{ position: 'relative', width: 64, height: 64, display: 'block', overflow: 'hidden', border: '1px solid var(--rule)' }}>
                      <Image src={url} alt={`Current photo ${i + 1}`} fill sizes="64px" style={{ objectFit: 'cover' }} unoptimized />
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {draft.map((slot, i) => (
                <div key={i} style={{ border: '1px solid var(--rule)', padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ ...labelStyle }}>Bedroom {i + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeBedroom(i)}
                      disabled={pending}
                      style={{ background: 'transparent', border: 'none', color: 'var(--ink-3)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' }}
                    >
                      Remove
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                    <input
                      style={inputStyle}
                      value={slot.name ?? ''}
                      onChange={(e) => updateSlot(i, { name: e.target.value })}
                      placeholder="Name (optional, e.g. Primary suite)"
                    />
                    <input
                      style={inputStyle}
                      value={slot.beds ?? ''}
                      onChange={(e) => updateSlot(i, { beds: e.target.value })}
                      placeholder="Beds (optional, e.g. 1 King)"
                    />
                  </div>
                  <PhotoUploader
                    value={slot.photo}
                    onChange={(next) => updateSlot(i, { photo: next })}
                    folder={`sca-bedrooms-${selected.guestyListingId}`}
                    disabled={pending}
                  />
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addBedroom}
              disabled={pending}
              style={{ marginTop: 14, background: 'transparent', border: '1px dashed var(--rule)', padding: '10px 16px', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)', cursor: 'pointer', width: '100%', fontWeight: 500 }}
            >
              + Add bedroom
            </button>

            <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 16 }}>
              <button
                type="button"
                onClick={publish}
                disabled={pending}
                style={{ background: 'var(--ink)', color: 'var(--paper)', border: 'none', padding: '12px 26px', fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600, cursor: pending ? 'wait' : 'pointer' }}
              >
                {pending ? 'Publishing…' : 'Publish to Stay Cape Ann'}
              </button>
              {result && <ResultNote result={result} />}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function ResultNote({ result }: { result: PublishBedroomResult }) {
  if (!result.ok) {
    return (
      <span style={{ fontSize: 13, color: 'var(--negative)', borderLeft: '3px solid var(--negative)', paddingLeft: 10 }}>
        {result.error}
      </span>
    );
  }
  if (result.noChange) {
    return <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>No changes to publish.</span>;
  }
  if (result.published) {
    return (
      <span style={{ fontSize: 13, color: 'var(--ink)' }}>
        Published — staycapeann.com rebuilds in ~1–2 min.{' '}
        <a href={result.liveUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--signal)' }}>
          View page
        </a>
      </span>
    );
  }
  return (
    <span style={{ fontSize: 13, color: 'var(--ink)' }}>
      PR opened but not auto-merged.{' '}
      <a href={result.prUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--signal)' }}>
        Open the PR to merge
      </a>
    </span>
  );
}
