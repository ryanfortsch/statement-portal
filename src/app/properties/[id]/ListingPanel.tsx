'use client';

import { useActionState, useRef, useState, useTransition } from 'react';
import {
  addPhotoUrlAction,
  deletePhotoAction,
  movePhotoAction,
  saveListingContentAction,
  setHeroAction,
  updatePhotoAction,
  uploadPhotoAction,
  type ListingActionResult,
  type ListingFormState,
} from './listing-actions';
import { RoomsEditor } from './RoomsEditor';
import type { ListingContentRow, ListingPhotoRow } from '@/lib/listing-content';
import type { PropertyRoom } from '@/lib/property-rooms-shared';

/**
 * The property Listing tab: Guesty's Details & layout, Overview and
 * Marketing screens as one record Helm owns (property_listing_content +
 * property_listing_photos, rooms from public.property_rooms).
 *
 * Every field prints who consumes it (staycapeann.com snapshot, the guest
 * AI through kb-facts, message automations, the OTA push layer to come), so
 * the operator knows what an edit reaches. OTA copy itself is still edited
 * in the OTA app until a push layer exists; this record is what that layer
 * will read.
 *
 * Server-only helpers (bedSummary, the catalog, the consumer map) are
 * computed on the page and passed in, so this client bundle never imports
 * the service-role client.
 */

export type ListingPanelProps = {
  propertyId: string;
  content: ListingContentRow | null;
  photos: ListingPhotoRow[];
  rooms: PropertyRoom[];
  bedSummaryText: string;
  catalog: ReadonlyArray<{ group: string; items: string[] }>;
  consumers: Record<string, string[]>;
  helmRun: boolean;
  registry: { title: string | null; bedrooms: number | null; bathrooms: number | null };
};

const fold = (s: string): string => s.toLowerCase().replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();

export function ListingPanel({ propertyId, content, photos, rooms, bedSummaryText, catalog, consumers, helmRun, registry }: ListingPanelProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 30, paddingBottom: 8 }}>
      <div style={{ borderLeft: `3px solid ${helmRun ? 'var(--positive)' : 'var(--signal)'}`, padding: '10px 14px', background: 'var(--paper-2)', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
        <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>
          {helmRun ? 'This record feeds staycapeann.com, the guest AI and automations for this home.' : 'Draft record: Guesty still holds the live listing for this home.'}
        </div>
        Per-channel copy (Airbnb, Vrbo, Booking.com) is edited in each OTA until a push layer exists. Each field below says who reads it today.
        {content?.source === 'guesty_seed' && (
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-3)' }}>
            Seeded from Guesty listing <span className="font-mono">{content.source_ref}</span>; edits here make it Helm's.
          </div>
        )}
      </div>

      <ContentForm propertyId={propertyId} content={content} catalog={catalog} consumers={consumers} registry={registry} />

      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SectionHead title="Rooms and beds" note={bedSummaryText || 'no beds on file'} />
        <ConsumedBy who={consumers.rooms} />
        <RoomsEditor propertyId={propertyId} rooms={rooms} />
      </section>

      <Gallery propertyId={propertyId} photos={photos} consumers={consumers} />
    </div>
  );
}

// ── Content ─────────────────────────────────────────────────────────────────

function ContentForm({
  propertyId,
  content,
  catalog,
  consumers,
  registry,
}: {
  propertyId: string;
  content: ListingContentRow | null;
  catalog: ListingPanelProps['catalog'];
  consumers: Record<string, string[]>;
  registry: ListingPanelProps['registry'];
}) {
  const action = saveListingContentAction.bind(null, propertyId);
  const [state, formAction, pending] = useActionState<ListingFormState, FormData>(action, { error: null });
  const have = new Set((content?.amenities ?? []).map(fold));
  const catalogKeys = new Set(catalog.flatMap((g) => g.items.map(fold)));
  const extras = (content?.amenities ?? []).filter((a) => !catalogKeys.has(fold(a)));
  const formKey = content?.updated_at ?? 'new';

  return (
    <form key={formKey} action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <SectionHead title="Content" note={content?.updated_at ? `Saved ${fmtStamp(content.updated_at)}${content.updated_by ? ` by ${content.updated_by}` : ''}` : 'Not saved yet'} />

      <TextField name="title" label="Title" hint="the guest-facing name; the registry title is the fallback" consumers={consumers.title} defaultValue={content?.title ?? registry.title ?? ''} />
      <TextField name="summary" label="Summary" hint="the short pitch; ✓ lines become staycapeann.com highlights" consumers={consumers.summary} defaultValue={content?.summary ?? ''} rows={4} />
      <TextField name="space" label="The space" hint="room by room; ☆ headings and → bullets render as sections" consumers={consumers.space} defaultValue={content?.space ?? ''} rows={10} />
      <TextField name="access" label="Guest access" hint="what the guest may use; never the door code" consumers={consumers.access} defaultValue={content?.access ?? ''} rows={3} />
      <TextField name="interaction" label="Interaction with guests" consumers={consumers.interaction} defaultValue={content?.interaction ?? ''} rows={2} />
      <TextField name="neighborhood" label="Neighborhood" consumers={consumers.neighborhood} defaultValue={content?.neighborhood ?? ''} rows={5} />
      <TextField name="house_rules" label="House rules" hint="the guest-facing text; the policy copy lives on Rates & taxes" consumers={consumers.house_rules} defaultValue={content?.house_rules ?? ''} rows={5} />
      <TextField name="notes" label="Other things to note" hint="Guesty's Notes field; cancellation wording lived here" consumers={consumers.notes} defaultValue={content?.notes ?? ''} rows={3} />

      <div>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Facts</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px 18px' }}>
          <Small name="property_type" label="Property type" defaultValue={content?.property_type ?? ''} placeholder="House" consumers={consumers.property_type} />
          <Small name="room_type" label="Room type" defaultValue={content?.room_type ?? ''} placeholder="Entire home/apt" consumers={consumers.room_type} />
          <Small name="accommodates" label="Accommodates" defaultValue={content?.accommodates ?? ''} placeholder="6" consumers={consumers.accommodates} numeric />
          <Small name="bedrooms" label="Bedrooms" defaultValue={content?.bedrooms ?? registry.bedrooms ?? ''} consumers={consumers.bedrooms} numeric />
          <Small name="bathrooms" label="Bathrooms" defaultValue={content?.bathrooms ?? registry.bathrooms ?? ''} consumers={consumers.bathrooms} numeric />
          <Small name="beds" label="Beds" defaultValue={content?.beds ?? ''} consumers={consumers.beds} numeric />
        </div>
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
          <div className="eyebrow">Amenities</div>
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{content?.amenities.length ?? 0} on file</span>
        </div>
        <ConsumedBy who={consumers.amenities} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 16, marginTop: 10 }}>
          {catalog.map((g) => (
            <div key={g.group}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>{g.group}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {g.items.map((item) => (
                  <label key={item} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--ink-2)', cursor: 'pointer' }}>
                    <input type="checkbox" name="amenities" value={item} defaultChecked={have.has(fold(item))} /> {item}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, marginTop: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={labelStyle}>Other amenities</span>
            <textarea name="amenities_extra" rows={3} defaultValue={extras.join('\n')} placeholder="One per line, anything not in the list" style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={labelStyle}>Not included</span>
            <textarea name="amenities_not_included" rows={3} defaultValue={(content?.amenities_not_included ?? []).join('\n')} placeholder="One per line, e.g. No washer" style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }} />
          </label>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <button type="submit" disabled={pending} style={{ ...primaryBtn, opacity: pending ? 0.6 : 1 }}>
          {pending ? 'Saving…' : 'Save listing'}
        </button>
        {state.error && <span style={{ fontSize: 12, color: 'var(--negative)' }}>{state.error}</span>}
        {!state.error && state.ok && state.message && <span style={{ fontSize: 12, color: 'var(--positive)' }}>{state.message}</span>}
      </div>
    </form>
  );
}

function TextField({ name, label, hint, consumers, defaultValue, rows }: { name: string; label: string; hint?: string; consumers?: string[]; defaultValue: string; rows?: number }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span style={labelStyle}>{label}</span>
        <ConsumedBy who={consumers} inline />
      </div>
      {rows && rows > 1 ? (
        <textarea name={name} rows={rows} defaultValue={defaultValue} style={{ ...input, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
      ) : (
        <input name={name} defaultValue={defaultValue} style={input} />
      )}
      {hint && <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{hint}</span>}
    </label>
  );
}

function Small({ name, label, defaultValue, placeholder, consumers, numeric }: { name: string; label: string; defaultValue: string | number; placeholder?: string; consumers?: string[]; numeric?: boolean }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={labelStyle}>{label}</span>
      <input name={name} defaultValue={defaultValue} placeholder={placeholder} inputMode={numeric ? 'decimal' : undefined} style={input} />
      <ConsumedBy who={consumers} inline />
    </label>
  );
}

// ── Gallery ─────────────────────────────────────────────────────────────────

function Gallery({ propertyId, photos, consumers }: { propertyId: string; photos: ListingPhotoRow[]; consumers: Record<string, string[]> }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [url, setUrl] = useState('');
  const [urlCaption, setUrlCaption] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [fileCaption, setFileCaption] = useState('');

  const run = (id: string, fn: () => Promise<ListingActionResult>) => {
    setBusy(id);
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.error });
      setBusy(null);
    });
  };

  const ordered = [...photos].sort((a, b) => a.sort_order - b.sort_order);
  const hero = photos.find((p) => p.is_hero) ?? null;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SectionHead title="Photos" note={`${photos.length} in the gallery${hero ? '' : photos.length ? ', no hero yet' : ''}`} />
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12, color: 'var(--ink-3)' }}>
        <ConsumedBy who={consumers.photos} inline label="Gallery" />
        <ConsumedBy who={consumers.hero} inline label="Hero" />
      </div>

      {ordered.length === 0 && (
        <div style={{ borderTop: '1px solid var(--rule)', padding: '18px 0', fontSize: 12, color: 'var(--ink-4)' }}>
          No photos yet. Upload below or paste a URL. A seeded home gets its Guesty gallery copied to Blob by the seed script.
        </div>
      )}

      {ordered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {ordered.map((p, i) => (
            <PhotoCard
              key={p.id}
              photo={p}
              index={i}
              count={ordered.length}
              busy={busy === p.id && pending}
              onMove={(dir) => run(p.id, () => movePhotoAction(propertyId, p.id, dir))}
              onHero={() => run(p.id, () => setHeroAction(propertyId, p.id))}
              onDelete={() => {
                if (typeof window !== 'undefined' && !window.confirm('Remove this photo from the gallery?')) return;
                run(p.id, () => deletePhotoAction(propertyId, p.id));
              }}
              onSave={(caption, roomHint) => run(p.id, () => updatePhotoAction(propertyId, p.id, { caption, room_hint: roomHint }))}
            />
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginTop: 4 }}>
        <div style={{ border: '1px solid var(--rule)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="eyebrow">Upload</div>
          <input ref={fileRef} type="file" accept="image/*" style={{ fontSize: 12, color: 'var(--ink-2)' }} />
          <input value={fileCaption} onChange={(e) => setFileCaption(e.target.value)} placeholder="Caption (optional)" style={input} />
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const f = fileRef.current?.files?.[0];
              if (!f) {
                setMsg({ ok: false, text: 'Pick a photo first.' });
                return;
              }
              const fd = new FormData();
              fd.set('file', f);
              fd.set('caption', fileCaption);
              run('upload', async () => {
                const r = await uploadPhotoAction(propertyId, fd);
                if (r.ok) {
                  if (fileRef.current) fileRef.current.value = '';
                  setFileCaption('');
                }
                return r;
              });
            }}
            style={{ ...primaryBtn, alignSelf: 'flex-start', opacity: pending ? 0.6 : 1 }}
          >
            {busy === 'upload' && pending ? 'Uploading…' : 'Upload to gallery'}
          </button>
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>Stored on Vercel Blob under listings/{propertyId}/. JPEG, PNG, WebP or HEIC, 12 MB max.</span>
        </div>
        <div style={{ border: '1px solid var(--rule)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="eyebrow">Add by URL</div>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" style={input} />
          <input value={urlCaption} onChange={(e) => setUrlCaption(e.target.value)} placeholder="Caption (optional)" style={input} />
          <button
            type="button"
            disabled={pending || !url.trim()}
            onClick={() =>
              run('url', async () => {
                const r = await addPhotoUrlAction(propertyId, { url, caption: urlCaption });
                if (r.ok) {
                  setUrl('');
                  setUrlCaption('');
                }
                return r;
              })
            }
            style={{ ...ghostBtn, alignSelf: 'flex-start', opacity: pending || !url.trim() ? 0.6 : 1 }}
          >
            {busy === 'url' && pending ? 'Adding…' : 'Add photo'}
          </button>
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>For a photo already hosted (Drive export, the SCA repo). The seed script copies Guesty photos here itself.</span>
        </div>
      </div>
      {msg && <div style={{ fontSize: 12, color: msg.ok ? 'var(--positive)' : 'var(--negative)' }}>{msg.text}</div>}
    </section>
  );
}

function PhotoCard({
  photo,
  index,
  count,
  busy,
  onMove,
  onHero,
  onDelete,
  onSave,
}: {
  photo: ListingPhotoRow;
  index: number;
  count: number;
  busy: boolean;
  onMove: (dir: -1 | 1) => void;
  onHero: () => void;
  onDelete: () => void;
  onSave: (caption: string, roomHint: string) => void;
}) {
  const [caption, setCaption] = useState(photo.caption ?? '');
  const [roomHint, setRoomHint] = useState(photo.room_hint ?? '');
  const dirty = caption !== (photo.caption ?? '') || roomHint !== (photo.room_hint ?? '');
  return (
    <div style={{ border: `1px solid ${photo.is_hero ? 'var(--signal)' : 'var(--rule)'}`, display: 'flex', flexDirection: 'column', opacity: busy ? 0.6 : 1 }}>
      <div style={{ position: 'relative', aspectRatio: '4 / 3', background: 'var(--paper-3)', overflow: 'hidden' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.thumbnail_url ?? photo.url} alt={photo.caption ?? ''} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        <div style={{ position: 'absolute', top: 6, left: 6, display: 'flex', gap: 4 }}>
          <span className="font-mono" style={{ fontSize: 10, background: 'var(--paper)', color: 'var(--ink-3)', padding: '2px 6px' }}>{index + 1}</span>
          {photo.is_hero && <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', background: 'var(--signal)', color: 'var(--paper)', padding: '3px 6px' }}>Hero</span>}
          {photo.source !== 'helm' && <span style={{ fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', background: 'var(--paper)', color: 'var(--ink-4)', padding: '3px 6px' }}>{photo.source.replace('_', ' ')}</span>}
        </div>
      </div>
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption" style={{ ...input, fontSize: 12, padding: '6px 8px' }} />
        <input value={roomHint} onChange={(e) => setRoomHint(e.target.value)} placeholder="Room (e.g. Bedroom 2) for the sleeping card" style={{ ...input, fontSize: 12, padding: '6px 8px' }} />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => onMove(-1)} disabled={busy || index === 0} style={quietLink} title="Move earlier">↑</button>
            <button type="button" onClick={() => onMove(1)} disabled={busy || index === count - 1} style={quietLink} title="Move later">↓</button>
            {!photo.is_hero && <button type="button" onClick={onHero} disabled={busy} style={quietLink}>Make hero</button>}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {dirty && <button type="button" onClick={() => onSave(caption, roomHint)} disabled={busy} style={{ ...quietLink, color: 'var(--ink)' }}>Save</button>}
            <button type="button" onClick={onDelete} disabled={busy} style={{ ...quietLink, color: 'var(--negative)' }}>Remove</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────

function ConsumedBy({ who, inline, label }: { who?: string[]; inline?: boolean; label?: string }) {
  if (!who || who.length === 0) return null;
  return (
    <span style={{ fontSize: 10, letterSpacing: '.06em', color: 'var(--ink-4)', display: inline ? 'inline' : 'block' }}>
      {label ? `${label} ` : ''}consumed by {who.join(', ')}
    </span>
  );
}

function SectionHead({ title, note }: { title: string; note?: string | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid var(--ink)', paddingBottom: 8 }}>
      <h3 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', margin: 0, color: 'var(--ink)' }}>{title}</h3>
      {note && <span style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em' }}>{note}</span>}
    </div>
  );
}

function fmtStamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
};

const input: React.CSSProperties = {
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  padding: '8px 10px',
  fontSize: 13,
  color: 'var(--ink)',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const primaryBtn: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: '1px solid var(--ink)',
  padding: '9px 16px',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  border: '1px solid var(--rule)',
  padding: '9px 14px',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};

const quietLink: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  fontSize: 11,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: 'var(--ink-4)',
  cursor: 'pointer',
  fontWeight: 500,
};
