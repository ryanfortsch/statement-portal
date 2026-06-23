'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { compressImage } from '@/lib/image-compress';

type Props = {
  /** Photos already uploaded (their public URLs). */
  value: string[];
  /** Called whenever the photo array changes (add or remove). */
  onChange: (next: string[]) => void;
  /** Folder hint passed to /api/upload (cosmetic). */
  folder?: string;
  /** Disable while a parent action is in flight. */
  disabled?: boolean;
  /** Upload endpoint. Defaults to the staff/SSO route; contractors pass the
   *  contractor-auth route '/api/field/upload'. */
  endpoint?: string;
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
export function PhotoUploader({ value, onChange, folder, disabled, endpoint = '/api/upload' }: Props) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(rawFile: File) {
    setErr(null);
    setUploading(true);

    try {
      const file = await compressImage(rawFile);
      const fd = new FormData();
      fd.append('file', file);
      if (folder) fd.append('folder', folder);

      const res = await fetch(endpoint, { method: 'POST', body: fd });
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
 *  (inspection summary, work slip detail, notes display, etc.). Tapping
 *  any thumb opens a fullscreen lightbox with prev/next + keyboard nav. */
export function PhotoThumbs({ urls, size = 80 }: { urls: string[]; size?: number }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (!urls || urls.length === 0) return null;

  return (
    <>
      <div
        style={{
          display: 'flex',
          gap: 6,
          marginTop: 8,
          flexWrap: 'wrap',
        }}
      >
        {urls.map((url, i) => (
          <button
            key={`${url}-${i}`}
            type="button"
            onClick={() => setLightboxIndex(i)}
            aria-label={`Open photo ${i + 1} of ${urls.length}`}
            style={{
              display: 'block',
              width: size,
              height: size,
              background: 'var(--paper-2)',
              border: '1px solid var(--rule)',
              overflow: 'hidden',
              cursor: 'zoom-in',
              padding: 0,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={`Photo ${i + 1}`}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </button>
        ))}
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          urls={urls}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
}

/**
 * Fullscreen image viewer. Tap outside the image (or hit Esc / the X)
 * to close. Arrow keys + on-screen chevrons step through the set.
 * Touch swipe (left/right) also navigates. Body scroll is locked while
 * the lightbox is open.
 */
function Lightbox({
  urls,
  startIndex,
  onClose,
}: {
  urls: string[];
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const touchStartX = useRef<number | null>(null);

  const total = urls.length;
  const goPrev = useCallback(() => setIndex((i) => (i - 1 + total) % total), [total]);
  const goNext = useCallback(() => setIndex((i) => (i + 1) % total), [total]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && total > 1) goPrev();
      else if (e.key === 'ArrowRight' && total > 1) goNext();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, goPrev, goNext, total]);

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current === null || total <= 1) return;
    const dx = (e.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 40) return;
    if (dx > 0) goPrev();
    else goNext();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${index + 1} of ${total}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20, 28, 32, 0.92)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'env(safe-area-inset-top, 0px) 0 env(safe-area-inset-bottom, 0px) 0',
      }}
    >
      {/* Top bar: counter + close */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: '14px 18px calc(14px + env(safe-area-inset-top, 0px))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: 'var(--paper)',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.4), rgba(0,0,0,0))',
          pointerEvents: 'none',
        }}
      >
        <span
          className="font-mono"
          style={{
            fontSize: 11,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            opacity: 0.85,
          }}
        >
          {index + 1} / {total}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            pointerEvents: 'auto',
            background: 'rgba(0,0,0,0.4)',
            color: 'var(--paper)',
            border: 'none',
            width: 36,
            height: 36,
            borderRadius: 18,
            fontSize: 18,
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

      {/* Prev chevron */}
      {total > 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            goPrev();
          }}
          aria-label="Previous photo"
          style={chevronStyle('left')}
        >
          ‹
        </button>
      )}

      {/* The image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={urls[index]}
        alt={`Photo ${index + 1} of ${total}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '92vw',
          maxHeight: '88vh',
          objectFit: 'contain',
          display: 'block',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      />

      {/* Next chevron */}
      {total > 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            goNext();
          }}
          aria-label="Next photo"
          style={chevronStyle('right')}
        >
          ›
        </button>
      )}
    </div>
  );
}

function chevronStyle(side: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    [side]: 12,
    background: 'rgba(0,0,0,0.4)',
    color: 'var(--paper)',
    border: 'none',
    width: 44,
    height: 44,
    borderRadius: 22,
    fontSize: 28,
    lineHeight: 1,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  } as React.CSSProperties;
}
