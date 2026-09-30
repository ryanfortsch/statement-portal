'use client';

import { useState, useRef, useEffect, useCallback, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import { compressImage } from '@/lib/image-compress';


// Each file is committed before its upload starts. Uploaded URLs stay in the
// draft until the parent confirms its own save, so a reload between those two
// writes does not lose the attachment.
type PhotoDraft = { id: string; scope: string; file: File; createdAt: number; url?: string };
const PhotoDraftActor = createContext<string | null>(null);
export function PhotoDraftScope({ actor, children }: { actor: string | null; children: React.ReactNode }) {
  return <PhotoDraftActor.Provider value={actor}>{children}</PhotoDraftActor.Provider>;
}
function useDraftScope(local?: string) {
  const actor = useContext(PhotoDraftActor);
  return actor && local ? JSON.stringify([actor, local]) : undefined;
}
async function photoDraftDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open('helm-field-photos', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('photos', { keyPath: 'id' });
      store.createIndex('scope', 'scope');
    };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error('Photo storage is blocked')); };
  });
}
async function draftTransaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore, setResult: (value: T) => void) => void): Promise<T> {
  const db = await photoDraftDB();
  return new Promise<T>((resolve, reject) => {
    let result: T;
    const tx = db.transaction('photos', mode);
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error('Photo storage unavailable')); };
    try { work(tx.objectStore('photos'), value => { result = value; }); }
    catch (error) { tx.abort(); reject(error); }
  });
}
export function readPhotoDrafts(scope: string): Promise<PhotoDraft[]> {
  return draftTransaction('readonly', (store, done) => {
    const request = store.index('scope').getAll(scope);
    request.onsuccess = () => done((request.result as PhotoDraft[]).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)));
  });
}
export function writePhotoDrafts(records: PhotoDraft[]): Promise<void> {
  return draftTransaction('readwrite', store => { for (const record of records) store.put(record); });
}
function removePhotoDrafts(ids: string[]): Promise<void> {
  return draftTransaction('readwrite', store => { for (const id of ids) store.delete(id); });
}
export async function clearPhotoDrafts(scope: string, confirmedUrls: string[]): Promise<void> {
  return draftTransaction('readwrite', store => {
    const cursor = store.index('scope').openCursor(scope);
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (item) {
        if (item.value.url && confirmedUrls.includes(item.value.url)) store.delete(item.primaryKey);
        item.continue();
      }
    };
  });
}
/** Cleanup failure must never turn a confirmed server save into a failed save. */
export function usePhotoDraftCleaner() {
  const actor = useContext(PhotoDraftActor);
  return useCallback(async (local: string, confirmedUrls: string[]) => {
    if (actor) await clearPhotoDrafts(JSON.stringify([actor, local]), confirmedUrls).catch(() => {});
  }, [actor]);
}
export function useClearPhotoDraft(local: string) {
  const scope = useDraftScope(local);
  return useCallback(async (confirmedUrls: string[]) => { if (scope) await clearPhotoDrafts(scope, confirmedUrls).catch(() => {}); }, [scope]);
}
export function ClearPhotoDraft({ draftKey, confirmedUrls }: { draftKey: string; confirmedUrls: string[] }) {
  const clear = useClearPhotoDraft(draftKey);
  useEffect(() => { void clear(confirmedUrls); }, [clear, confirmedUrls]);
  return null;
}

type Props = {
  /** Stable job/form identity, isolated by the authenticated Field actor. */
  draftKey?: string;
  onRecovered?: () => void;
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

type FailedUpload = { id: string; file: File; error: string };
type UploadProgress = { completed: number; total: number; filename: string };

/**
 * Mobile-first photo uploader. Renders existing thumbnails (with a small
 * remove button) plus a "+ Photo" tile that opens the OS chooser on phones
 * (camera or photo library) and the file picker on desktop.
 *
 * The gallery picker stays separate from the explicit camera input, so
 * contractors can attach earlier shots or take a new photo on site.
 *
 * Selected photos upload sequentially to /api/upload. Successful URLs are
 * appended together via onChange, so parents persist once per batch. Failed
 * files stay available for individual retry. The component does not write to
 * the database directly -- the parent is responsible for persisting
 * the URL list (e.g. via inspection_notes.photo_urls or
 * work_slips.photo_urls).
 */
export function PhotoUploader(props: Props) {
  const scope = useDraftScope(props.draftKey);
  return <PhotoUploaderInner key={scope ?? 'volatile'} {...props} scope={scope} />;
}

function PhotoUploaderInner({ value, onChange, folder, disabled, endpoint = '/api/upload', onUploadingChange, onFailedUploadsChange, onRecovered, scope }: Props & { scope?: string }) {
  const [restoring, setRestoring] = useState(!!scope);
  const restoringRef = useRef(!!scope);
  const [storageWarning, setStorageWarning] = useState('');
  const [deviceSaved, setDeviceSaved] = useState(false);
  const draftsRef = useRef(new Map<string, PhotoDraft>());
  const [uploading, setUploading] = useState(false);
  const [failures, setFailures] = useState<FailedUpload[]>([]);
  const failuresRef = useRef<FailedUpload[]>([]);
  function updateFailures(next: FailedUpload[]) {
    failuresRef.current = next;
    setFailures(next);
  }
  useEffect(() => { onFailedUploadsChange?.(failures.length); }, [failures.length, onFailedUploadsChange]);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [notice, setNotice] = useState('');
  // Same fullscreen viewer the read-only strips use — an uploaded photo you
  // can't open is half a photo (you can't check what you just shot).
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<AbortController | null>(null);
  const latest = useRef({ value, onChange, onUploadingChange, onRecovered });

  useEffect(() => { latest.current = { value, onChange, onUploadingChange, onRecovered }; }, [value, onChange, onUploadingChange, onRecovered]);

  useEffect(() => {
    if (!scope) return;
    let active = true;
    latest.current.onUploadingChange?.(true);
    void readPhotoDrafts(scope).then(records => {
      if (!active) return;
      draftsRef.current = new Map(records.map(record => [record.id, record]));
      const pending = records.filter(record => !record.url);
      updateFailures(pending.map(record => ({ id: record.id, file: record.file, error: 'Recovered from this device. Ready to retry.' })));
      const urls = records.flatMap(record => record.url ? [record.url] : []);
      if (urls.length) latest.current.onChange([...new Set([...latest.current.value, ...urls])]);
      if (records.length) {
        setDeviceSaved(true);
        setNotice(`Recovered ${records.length} photo${records.length === 1 ? '' : 's'} from this device. Review them before saving.`);
        latest.current.onRecovered?.();
      }
    }).catch(() => {
      if (active) setStorageWarning('Device storage is unavailable. Keep this screen open until your photos and task are saved.');
    }).finally(() => {
      if (!active) return;
      restoringRef.current = false;
      setRestoring(false);
      latest.current.onUploadingChange?.(false);
    });
    return () => { active = false; };
  }, [scope]);

  useEffect(() => {
    // A form must not save its old photo list while a batch is still running.
    const form = rootRef.current?.closest('form');
    function preventEarlySubmit(event: Event) {
      if (!restoringRef.current && !uploadRef.current && failuresRef.current.length === 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setNotice(restoringRef.current ? 'Restoring photos from this device. Please wait.' : uploadRef.current ? 'Photos are still uploading. Please wait before saving.' : 'Retry or remove the failed photos before saving.');
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

  async function uploadFiles(items: Array<{ id: string; file: File }>) {
    if (disabled || restoringRef.current || uploadRef.current || items.length === 0) return;
    const controller = new AbortController();
    uploadRef.current = controller;
    latest.current.onUploadingChange?.(true);
    setUploading(true);
    setNotice('');
    const ids = new Set(items.map(item => item.id));
    updateFailures(failuresRef.current.filter(item => !ids.has(item.id)));
    const uploaded: string[] = [];
    const failed: FailedUpload[] = [];

    try {
      if (scope) {
        const selectedAt = Date.now();
        const records = items.map((item, index) => ({ ...item, scope, createdAt: draftsRef.current.get(item.id)?.createdAt ?? selectedAt + index / 1000 }));
        for (const record of records) draftsRef.current.set(record.id, record);
        try {
          await writePhotoDrafts(records);
          if (!controller.signal.aborted) setDeviceSaved(true);
        } catch {
          if (!controller.signal.aborted) {
            setDeviceSaved(false);
            setStorageWarning('Couldn’t save photos on this device. Keep this screen open until your photos and task are saved.');
          }
        }
      }
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
          if (scope) {
            const record = { ...item, scope, createdAt: draftsRef.current.get(item.id)?.createdAt ?? Date.now(), url: body.url };
            draftsRef.current.set(item.id, record);
            try { await writePhotoDrafts([record]); }
            catch { setStorageWarning('Couldn’t update the device copy. Keep this screen open until the task is saved.'); }
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          failed.push({ ...item, error: error instanceof Error ? error.message : 'Upload failed. Please retry.' });
        }
      }
      if (controller.signal.aborted) return;
      updateFailures([...failuresRef.current, ...failed]);
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

  async function discard(ids: string[]) {
    if (scope && ids.length > 0) {
      try { await removePhotoDrafts(ids); }
      catch { setStorageWarning('Couldn’t remove the device copy. Try removing it again.'); return false; }
    }
    for (const id of ids) draftsRef.current.delete(id);
    return true;
  }
  async function removeAt(index: number) {
    const ids = [...draftsRef.current.values()].filter(record => record.url === value[index]).map(record => record.id);
    if (!(await discard(ids))) return;
    const next = [...value];
    next.splice(index, 1);
    onChange(next);
  }

  return (
    <div ref={rootRef}>
      {restoring && <p role="status">Restoring photos…</p>}
      {storageWarning && <p role="alert" style={{ fontSize: 13, color: 'var(--negative)' }}>{storageWarning}</p>}
      {scope && deviceSaved && !storageWarning && <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>Photo copies saved on this device until you save the task. Reopen this same form to recover them.</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        disabled={disabled || uploading || restoring}
        onChange={(e) => {
          const items = Array.from(e.target.files ?? []).map(file => ({ id: crypto.randomUUID(), file }));
          // Reset immediately so picking the same file again still fires change.
          e.target.value = '';
          void uploadFiles(items);
        }}
      />

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" aria-label="Take a photo" style={{ display: 'none' }} disabled={disabled || uploading || restoring}
        onChange={e => {
          const items = Array.from(e.target.files ?? []).map(file => ({ id: crypto.randomUUID(), file }));
          e.target.value = '';
          void uploadFiles(items);
        }} />

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
                disabled={disabled || uploading || restoring}
                aria-label="Remove photo"
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  width: 44,
                  height: 44,
                  background: 'var(--ink)',
                  color: 'var(--paper)',
                  border: 'none',
                  borderRadius: 22,
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

      <button type="button" disabled={disabled || uploading || restoring} onClick={() => cameraRef.current?.click()}
        style={{ ...retryButtonStyle, width: '100%', marginBottom: 8 }}>Take photo</button>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || uploading || restoring}
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
          <div role="alert">{failures.length} photo{failures.length === 1 ? '' : 's'} couldn’t upload. {scope && deviceSaved && !storageWarning ? 'Saved on this device. Retry or remove below.' : 'Keep this screen open and retry, or remove below.'}</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
            {failures.map(item => (
              <li key={item.id} style={{ marginTop: 8 }}>
                <div style={{ overflowWrap: 'anywhere' }}><strong>{item.file.name}</strong>: {item.error}</div>
                <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                  <button type="button" disabled={disabled || uploading || restoring} aria-label={`Retry ${item.file.name}`} onClick={() => { void uploadFiles([item]); }} style={retryButtonStyle}>Retry</button>
                  <button type="button" disabled={disabled || uploading || restoring} aria-label={`Remove failed photo ${item.file.name}`} onClick={async () => { if (await discard([item.id])) updateFailures(failuresRef.current.filter(other => other.id !== item.id)); }} style={retryButtonStyle}>Remove</button>
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
  padding: '8px 12px', minHeight: 44, font: 'inherit', cursor: 'pointer',
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
