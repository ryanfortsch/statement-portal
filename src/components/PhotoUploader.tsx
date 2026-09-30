'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
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
  /** Lets non-form parents hold their save/next buttons until the batch ends. */
  onUploadingChange?: (uploading: boolean) => void;
  /** Optional parent guard for selected files that still need retry or removal. */
  onFailedUploadsChange?: (count: number) => void;
};

type FailedUpload = { id: number; file: File; error: string };
type UploadProgress = { completed: number; total: number; filename: string };

/**
 * Mobile-first photo uploader. Renders existing thumbnails (with a small
 * remove button) plus a "+ Photo" tile that opens the OS chooser on phones
 * (camera or photo library) and the file picker on desktop.
 *
 * Deliberately NO capture="environment": forcing the camera blocked the
 * photo library, and Delaney's real workflow is shooting as she walks, then
 * filing work slips with those shots when the inspection is done (her own
 * work-slip request, 2026-08-06). The OS sheet keeps "Take Photo" one tap
 * away for the live case.
 *
 * Selected photos upload sequentially to /api/upload. Successful URLs are
 * appended together via onChange, so parents persist once per batch. Failed
 * files stay available for individual retry. The component does not write to
 * the database directly -- the parent is responsible for persisting
 * the URL list (e.g. via inspection_notes.photo_urls or
 * work_slips.photo_urls).
 */
export function PhotoUploader({ value, onChange, folder, disabled, endpoint = '/api/upload', onUploadingChange, onFailedUploadsChange }: Props) {
  const [uploading, setUploading] = useState(false);
  const [failures, setFailures] = useState<FailedUpload[]>([]);
  useEffect(() => { onFailedUploadsChange?.(failures.length); }, [failures.length, onFailedUploadsChange]);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [notice, setNotice] = useState('');
  // Same fullscreen viewer the read-only strips use — an uploaded photo you
  // can't open is half a photo (you can't check what you just shot).
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<AbortController | null>(null);
  const nextId = useRef(0);
  const latest = useRef({ value, onChange, onUploadingChange });

  useEffect(() => { latest.current = { value, onChange, onUploadingChange }; }, [value, onChange, onUploadingChange]);

  useEffect(() => {
    // A form must not save its old photo list while a batch is still running.
    const form = rootRef.current?.closest('form');
    function preventEarlySubmit(event: Event) {
      if (!uploadRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setNotice('Photos are still uploading. Please wait before saving.');
    }
    form?.addEventListener('submit', preventEarlySubmit, true);
    return () => {
      form?.removeEventListener('submit', preventEarlySubmit, true);
      uploadRef.current?.abort();
      latest.current.onUploadingChange?.(false);
    };
  }, []);

  useEffect(() => {
    if (!failures.length && !uploading) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [failures.length, uploading]);

  async function uploadFiles(items: Array<{ id: number; file: File }>) {
    if (disabled || uploadRef.current || items.length === 0) return;
    const controller = new AbortController();
    uploadRef.current = controller;
    latest.current.onUploadingChange?.(true);
    setUploading(true);
    setNotice('');
    const ids = new Set(items.map(item => item.id));
    setFailures(previous => previous.filter(item => !ids.has(item.id)));
    const uploaded: string[] = [];
    const failed: FailedUpload[] = [];

    try {
      for (const [index, item] of items.entries()) {
        if (controller.signal.aborted) return;
        setProgress({ completed: index, total: items.length, filename: item.file.name });
        try {
          const file = await compressImage(item.file);
          if (controller.signal.aborted) return;
          const fd = new FormData();
          fd.append('file', file);
          if (folder) fd.append('folder', folder);

          const res = await fetch(endpoint, { method: 'POST', body: fd, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]) });
          const body = await res.json().catch(() => null) as { url?: string; error?: string } | null;
          if (!res.ok || typeof body?.url !== 'string' || !body.url) {
            throw new Error(body?.error || `Upload failed (HTTP ${res.status}). Please retry.`);
          }
          uploaded.push(body.url);
        } catch (error) {
          if (controller.signal.aborted) return;
          failed.push({ ...item, error: error instanceof Error ? error.message : 'Upload failed. Please retry.' });
        }
      }
      if (controller.signal.aborted) return;
      setFailures(previous => [...previous, ...failed]);
      setNotice(`${uploaded.length} photo${uploaded.length === 1 ? '' : 's'} uploaded.`);
      if (uploaded.length > 0) {
        latest.current.onChange([...latest.current.value, ...uploaded]);
      }
    } finally {
      if (!controller.signal.aborted) {
        setUploading(false);
        setProgress(null);
        latest.current.onUploadingChange?.(false);
      }
      if (uploadRef.current === controller) uploadRef.current = null;
    }
  }

  function removeAt(index: number) {
    const next = [...value];
    next.splice(index, 1);
    onChange(next);
  }

  return (
    <div ref={rootRef}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        disabled={disabled || uploading}
        onChange={(e) => {
          const items = Array.from(e.target.files ?? []).map(file => ({ id: nextId.current++, file }));
          // Reset immediately so picking the same file again still fires change.
          e.target.value = '';
          void uploadFiles(items);
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
              {/* Anchor (not button) so it stays clickable inside the office
                  preview's disabled <fieldset>; plain click opens the viewer,
                  cmd/middle-click opens the raw file in a new tab. */}
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open photo ${i + 1} of ${value.length}`}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                  e.preventDefault();
                  setLightboxIndex(i);
                }}
                style={{ display: 'block', width: '100%', height: '100%', cursor: 'zoom-in' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Photo ${i + 1}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </a>
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
        {uploading ? 'Uploading photos…' : value.length > 0 ? '+ Add photos' : '+ Take or upload photos'}
      </button>

      <div role="status" aria-live="polite" style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: progress || notice ? 8 : 0 }}>
        {progress ? (
          <>
            <div style={{ overflowWrap: 'anywhere' }}>
              Uploading {progress.completed + 1} of {progress.total}: {progress.filename}
            </div>
            <progress aria-label="Photo upload progress" value={progress.completed} max={progress.total} style={{ width: '100%', marginTop: 6 }} />
            {notice && <div>{notice}</div>}
          </>
        ) : notice}
      </div>

      {failures.length > 0 && (
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
          <div role="alert">{failures.length} photo{failures.length === 1 ? '' : 's'} couldn’t upload. Retry or remove below.</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
            {failures.map(item => (
              <li key={item.id} style={{ marginTop: 8 }}>
                <div style={{ overflowWrap: 'anywhere' }}><strong>{item.file.name}</strong>: {item.error}</div>
                <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                  <button type="button" disabled={disabled || uploading} aria-label={`Retry ${item.file.name}`} onClick={() => { void uploadFiles([item]); }} style={retryButtonStyle}>Retry</button>
                  <button type="button" disabled={disabled || uploading} aria-label={`Remove failed photo ${item.file.name}`} onClick={() => setFailures(previous => previous.filter(other => other.id !== item.id))} style={retryButtonStyle}>Remove</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {lightboxIndex !== null && (
        <Lightbox urls={value} startIndex={Math.min(lightboxIndex, value.length - 1)} onClose={() => setLightboxIndex(null)} />
      )}
    </div>
  );
}

const retryButtonStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--rule)', color: 'var(--ink)',
  padding: '8px 12px', minHeight: 36, font: 'inherit', cursor: 'pointer',
};

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
          // An anchor, not a button: buttons go inert inside the office
          // preview's read-only <fieldset disabled>, which silently killed the
          // lightbox there. Plain click opens the viewer; cmd/middle-click
          // opens the full-size image in a new tab.
          <a
            key={`${url}-${i}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey) return;
              e.preventDefault();
              setLightboxIndex(i);
            }}
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
          </a>
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

  // Portaled to <body>: the viewer can open from inside the office preview's
  // read-only <fieldset disabled>, and a portal keeps its close/next buttons
  // outside that subtree (a disabled fieldset inerts every descendant control).
  return createPortal(
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
    </div>,
    document.body,
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
