'use client';

import { useState, useTransition, useRef } from 'react';
import Link from 'next/link';
import { generateListingCopyAction, type GenerateListingCopyResult } from './actions';
import type { ListingCopy } from '@/lib/ai/listing-copy';

type Props = {
  propertyId: string;
  propertyName: string;
};

/**
 * Operator-facing form for the AI listing copy generator. Lives at
 * /properties/[id]/listing-copy.
 *
 * Layout: left column is the input form (photos + operator brief +
 * generate button); right column appears once a draft lands and shows
 * title / tagline / description with per-field copy-to-clipboard
 * buttons. Stays on the page so the operator can tweak the brief and
 * regenerate without losing context.
 */
type CopyFormat = 'airbnb' | 'editorial';

const FORMAT_OPTIONS: Array<{ id: CopyFormat; label: string; sub: string }> = [
  { id: 'airbnb', label: 'Airbnb / Guesty', sub: 'One block per Guesty field. ✓ summary, ★ floor-by-floor space, access, neighborhood.' },
  { id: 'editorial', label: 'Stay Cape Ann', sub: 'Editorial paragraphs for staycapeann.com.' },
];

export function ListingCopyClient({ propertyId, propertyName }: Props) {
  const [brief, setBrief] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [format, setFormat] = useState<CopyFormat>('airbnb');
  const [copy, setCopy] = useState<ListingCopy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setCopy(null);

    startTransition(async () => {
      // Downscale every photo in the browser before upload. Phone
      // photos are routinely 3-5MB; posting them raw blows past the
      // server-action body cap and the platform kills the request
      // before our code sees it (the "page couldn't load" failure on
      // 2026-06-10). 1600px / q0.82 lands ~200-400KB per photo.
      let compressed: Blob[];
      try {
        compressed = await Promise.all(photos.map((f) => downscaleImage(f)));
      } catch {
        setError('One of the photos could not be read. Try a JPG or PNG.');
        return;
      }

      const totalBytes = compressed.reduce((s, b) => s + b.size, 0);
      if (totalBytes > 3_500_000) {
        setError(
          'Photos are still too large after compression (over 3.5 MB total). Remove one or two and try again.',
        );
        return;
      }

      const formData = new FormData();
      formData.set('brief', brief);
      formData.set('format', format);
      compressed.forEach((blob, i) => {
        formData.append('photos', new File([blob], `photo-${i + 1}.jpg`, { type: 'image/jpeg' }));
      });

      const result: GenerateListingCopyResult = await generateListingCopyAction(propertyId, formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCopy(result.copy);
    });
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: copy ? '1fr 1fr' : '1fr', gap: 40, alignItems: 'start' }}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <Field label="Format" hint="Airbnb is the structured house style from our live listings. Stay Cape Ann is the editorial paragraph voice from staycapeann.com.">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {FORMAT_OPTIONS.map((opt) => {
              const active = format === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setFormat(opt.id)}
                  style={{
                    textAlign: 'left',
                    padding: '10px 14px',
                    border: active ? '1px solid var(--ink)' : '1px solid var(--rule)',
                    background: active ? 'var(--ink)' : 'transparent',
                    color: active ? 'var(--paper)' : 'var(--ink)',
                    cursor: 'pointer',
                    maxWidth: 260,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase' }}>
                    {opt.label}
                  </div>
                  <div style={{ marginTop: 3, fontSize: 11, opacity: 0.75, lineHeight: 1.4 }}>{opt.sub}</div>
                </button>
              );
            })}
          </div>
        </Field>

        <Field
          label="What makes it special"
          hint="A line or two from your perspective. The flue handle that sticks, the view at low tide, what the kitchen sees in the morning. The model uses this plus the photos to ground the copy in real details."
        >
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={6}
            maxLength={2000}
            placeholder={'Newly renovated kitchen with a Wolf range. Boat house bedroom looks straight at the dock. Owners are particular about the garden, please mention the climbing roses on the south fence.'}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
          />
        </Field>

        <Field
          label="Photos (optional)"
          hint="Up to 6 photos. Straight off your phone is fine, they're compressed in the browser before upload. The model describes what's actually visible."
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []).slice(0, 6);
              setPhotos(files);
            }}
            style={{ fontSize: 13, color: 'var(--ink-3)' }}
          />
          {photos.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {photos.map((f, i) => (
                <PhotoChip key={i} file={f} />
              ))}
            </div>
          )}
        </Field>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
          <button type="submit" disabled={pending} style={primaryButtonStyle}>
            {pending ? 'Drafting…' : copy ? 'Regenerate' : 'Generate listing copy'}
          </button>
          <Link href={`/properties/${propertyId}`} style={secondaryLinkStyle}>
            Back to {propertyName}
          </Link>
        </div>

        {error && (
          <div
            style={{
              padding: '12px 14px',
              borderLeft: '2px solid var(--negative)',
              background: 'var(--paper-2)',
              fontSize: 13,
              color: 'var(--negative)',
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}
      </form>

      {copy && <ResultPane copy={copy} />}
    </div>
  );
}

/**
 * Render whichever fields the generator returned, labeled to match
 * Guesty's description editor 1:1 so each Copy button drops straight
 * into the corresponding Guesty field. Editorial drafts return
 * tagline/description; Airbnb drafts return summary/space/guest
 * access/neighborhood.
 */
const FIELD_ORDER: Array<{ key: keyof ListingCopy; label: string; multiline: boolean; charLimit?: number }> = [
  { key: 'title', label: 'Title', multiline: false, charLimit: 50 },
  { key: 'summary', label: 'Summary', multiline: true, charLimit: 500 },
  { key: 'space', label: 'The space', multiline: true },
  { key: 'guest_access', label: 'Guest access', multiline: true },
  { key: 'neighborhood', label: 'The neighborhood', multiline: true },
  { key: 'tagline', label: 'Tagline', multiline: false },
  { key: 'description', label: 'Description', multiline: true },
];

function ResultPane({ copy }: { copy: ListingCopy }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {FIELD_ORDER.map(({ key, label, multiline, charLimit }) => {
        const body = copy[key];
        // FIELD_ORDER only lists string fields; skip any non-string (the sca
        // format's highlights[] is rendered by the launch form, not here).
        if (typeof body !== 'string' || !body) return null;
        return <Block key={key} label={label} body={body} multiline={multiline} charLimit={charLimit} />;
      })}
    </div>
  );
}

function Block({
  label,
  body,
  multiline = false,
  charLimit,
}: {
  label: string;
  body: string;
  multiline?: boolean;
  charLimit?: number;
}) {
  const [copied, setCopied] = useState(false);
  const overLimit = charLimit != null && body.length > charLimit;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="eyebrow" style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 600 }}>
          {label}
          {charLimit != null && (
            <span style={{ marginLeft: 8, color: overLimit ? 'var(--negative)' : 'var(--ink-4)', letterSpacing: 0, textTransform: 'none', fontWeight: 400 }}>
              {body.length}/{charLimit}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(body);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          style={{
            background: 'transparent',
            border: '1px solid var(--rule)',
            padding: '4px 10px',
            fontSize: 10,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            fontWeight: 500,
            color: copied ? 'var(--positive)' : 'var(--ink-3)',
            cursor: 'pointer',
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div
        style={{
          padding: '12px 14px',
          border: '1px solid var(--rule)',
          background: 'var(--paper)',
          fontSize: multiline ? 14 : 16,
          lineHeight: 1.6,
          color: 'var(--ink)',
          whiteSpace: multiline ? 'pre-wrap' : 'normal',
          fontFamily: multiline ? 'inherit' : 'var(--font-fraunces), Georgia, serif',
        }}
      >
        {body}
      </div>
    </div>
  );
}

function PhotoChip({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  if (!url) {
    const reader = new FileReader();
    reader.onload = () => setUrl(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
  }
  return (
    <div style={{ width: 80, height: 80, border: '1px solid var(--rule)', background: 'var(--paper-2)', overflow: 'hidden' }}>
      {url && <img src={url} alt={file.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
    </div>
  );
}

/**
 * Browser-side photo downscale: longest edge capped at 1600px, JPEG
 * quality 0.82. Uses createImageBitmap + canvas so HEIC-converted JPGs,
 * PNGs, and WebP all come out as a compact JPEG blob. Falls back to
 * the original file when it's already smaller than the re-encode.
 */
async function downscaleImage(file: File): Promise<Blob> {
  const MAX_EDGE = 1600;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.82),
  );
  if (!blob) throw new Error('image encode failed');
  return blob.size < file.size ? blob : file;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span
        className="eyebrow"
        style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 600 }}
      >
        {label}
      </span>
      {children}
      {hint && <span style={{ fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.5 }}>{hint}</span>}
    </label>
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
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '13px 22px',
  border: '1px solid var(--ink)',
  cursor: 'pointer',
};

const secondaryLinkStyle: React.CSSProperties = {
  color: 'var(--ink-3)',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '13px 14px',
  textDecoration: 'none',
};
