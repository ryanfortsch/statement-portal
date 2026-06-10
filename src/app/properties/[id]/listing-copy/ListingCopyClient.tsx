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
export function ListingCopyClient({ propertyId, propertyName }: Props) {
  const [brief, setBrief] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [copy, setCopy] = useState<ListingCopy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setCopy(null);

    const formData = new FormData();
    formData.set('brief', brief);
    for (const f of photos) formData.append('photos', f);

    startTransition(async () => {
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
          hint="Up to 6 photos, 4 MB each. JPG or PNG. The model can describe what's actually visible if you attach them."
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

function ResultPane({ copy }: { copy: ListingCopy }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <Block label="Title" body={copy.title} />
      <Block label="Tagline" body={copy.tagline} />
      <Block label="Description" body={copy.description} multiline />
    </div>
  );
}

function Block({ label, body, multiline = false }: { label: string; body: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="eyebrow" style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 600 }}>
          {label}
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
