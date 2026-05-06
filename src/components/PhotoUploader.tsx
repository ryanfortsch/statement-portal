'use client';

import { useState, useRef } from 'react';

type Props = {
  /** Photos already uploaded (their public URLs). */
  value: string[];
  /** Called whenever the photo array changes (add or remove). */
  onChange: (next: string[]) => void;
  /** Folder hint passed to /api/upload (cosmetic). */
  folder?: string;
  /** Disable while a parent action is in flight. */
  disabled?: boolean;
};

/**
 * Mobile-first photo uploader. Renders existing thumbnails (with a small
 * remove button) plus a "+ Photo" tile that opens the camera on phones
 * (capture="environment") and the file picker on desktop.
 *
 * Uploads happen one at a time to /api/upload. On success the URL is
 * appended to `value` via onChange. The component does not write to
 * the database directly -- the parent is responsible for persisting
 * the URL list (e.g. via inspection_notes.photo_urls or
 * work_slips.photo_urls).
 */
export function PhotoUploader({ value, onChange, folder, disabled }: Props) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setErr(null);
    setUploading(true);

    const fd = new FormData();
    fd.append('file', file);
    if (folder) fd.append('folder', folder);

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const body = (await res.json()) as { ok?: boolean; url?: string; error?: string };
      if (!res.ok || !body.url) {
        setErr(body.error || `Upload failed (HTTP ${res.status})`);
      } else {
        onChange([...value, body.url]);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function removeAt(index: number) {
    const next = [...value];
    next.splice(index, 1);
    onChange(next);
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        disabled={disabled || uploading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      {value.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
            gap: 8,
            marginBottom: 10,
          }}
        >
          {value.map((url, i) => (
            <div
              key={`${url}-${i}`}
              style={{
                position: 'relative',
                aspectRatio: '1 / 1',
                background: 'var(--paper-2)',
                border: '1px solid var(--rule)',
                overflow: 'hidden',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Photo ${i + 1}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <button
                type="button"
                onClick={() => removeAt(i)}
                disabled={disabled || uploading}
                aria-label="Remove photo"
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  width: 22,
                  height: 22,
                  background: 'var(--ink)',
                  color: 'var(--paper)',
                  border: 'none',
                  borderRadius: 11,
                  fontSize: 14,
                  lineHeight: 1,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || uploading}
        style={{
          background: 'transparent',
          border: '1px dashed var(--rule)',
          padding: '12px 16px',
          fontSize: 11,
          letterSpacing: '.16em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
          cursor: uploading ? 'wait' : 'pointer',
          fontWeight: 500,
          width: '100%',
        }}
      >
        {uploading ? 'Uploading…' : value.length > 0 ? '+ Add another photo' : '+ Take or upload photo'}
      </button>

      {err && (
        <div
          style={{
            marginTop: 8,
            padding: '8px 12px',
            borderLeft: '3px solid var(--negative)',
            background: 'var(--paper-2)',
            fontSize: 12,
            color: 'var(--negative)',
          }}
        >
          {err}
        </div>
      )}
    </div>
  );
}

/** Read-only thumbnail strip — used wherever existing photos are surfaced
 *  (inspection summary, work slip detail, notes display, etc.) */
export function PhotoThumbs({ urls, size = 80 }: { urls: string[]; size?: number }) {
  if (!urls || urls.length === 0) return null;
  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        marginTop: 8,
        flexWrap: 'wrap',
      }}
    >
      {urls.map((url, i) => (
        <a
          key={`${url}-${i}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'block',
            width: size,
            height: size,
            background: 'var(--paper-2)',
            border: '1px solid var(--rule)',
            overflow: 'hidden',
            cursor: 'zoom-in',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={`Photo ${i + 1}`}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </a>
      ))}
    </div>
  );
}
