'use client';

import { useRef, useState, useTransition } from 'react';
import { PhotoUploader } from '@/components/PhotoUploader';
import { updateWorkSlipPhotos } from '../actions';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';

type Props = {
  slipId: string;
  propertyId: string;
  initialUrls: string[];
  /** Start as a one-line "+ Photos" affordance instead of the full
   *  uploader dropzone. Used when the slip has no photos yet. */
  collapsed?: boolean;
};

/**
 * Editable wrapper around PhotoUploader for a single work slip. The
 * uploader returns the new array on every add/remove; we persist via
 * the server action. Keep the desired list separate from the confirmed
 * list so a failed save can retry without uploading the files again.
 */
export function SlipPhotoEditor({ slipId, propertyId, initialUrls, collapsed = false }: Props) {
  const [urls, setUrls] = useState<string[]>(initialUrls);
  const [confirmedUrls, setConfirmedUrls] = useState<string[]>(initialUrls);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(!collapsed);
  const saving = useRef(false);
  const dirty = urls.length !== confirmedUrls.length || urls.some((url, i) => url !== confirmedUrls[i]);

  useUnsavedWorkGuard(uploading || pending || dirty || !!err);

  function handleChange(next: string[]) {
    if (pending || saving.current) return;
    saving.current = true;
    setUrls(next);
    setErr(null);
    setSavedAt(null);
    startTransition(async () => {
      try {
        const res = await updateWorkSlipPhotos({ id: slipId, photo_urls: next });
        if (!res.ok) {
          setErr(res.error);
          return;
        }
        setConfirmedUrls(next);
        setSavedAt(Date.now());
      } catch {
        setErr('Could not confirm the photo save. Retry saving the photos below.');
      } finally {
        saving.current = false;
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          fontSize: 11,
          letterSpacing: '.16em',
          textTransform: 'uppercase',
          fontWeight: 600,
          color: 'var(--ink-3)',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        + Photos
        <span style={{ marginLeft: 8, letterSpacing: 0, textTransform: 'none', color: 'var(--ink-4)', fontWeight: 400 }}>
          take or upload
        </span>
      </button>
    );
  }

  return (
    <div>
      <PhotoUploader
        value={urls}
        onChange={handleChange}
        folder={`work-slips/${propertyId}/${slipId}`}
        disabled={pending}
        onUploadingChange={setUploading}
      />

      <div
        role="status"
        aria-live="polite"
        style={{
          marginTop: 10,
          minHeight: 18,
          fontSize: 11,
          letterSpacing: '.16em',
          textTransform: 'uppercase',
          color: err ? 'var(--negative)' : 'var(--ink-3)',
        }}
      >
        {uploading
          ? 'Uploading photos…'
          : pending
            ? 'Saving…'
            : err || dirty
              ? 'Photo changes are not confirmed saved.'
            : savedAt
              ? `Saved · ${urls.length} photo${urls.length === 1 ? '' : 's'}`
              : urls.length > 0
                ? `${urls.length} photo${urls.length === 1 ? '' : 's'} attached`
                : ''}
      </div>
      {err && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--negative)' }}>
          <p role="alert" style={{ margin: '0 0 8px' }}>{err}</p>
          <button
            type="button"
            onClick={() => handleChange(urls)}
            disabled={pending || uploading}
            style={{ background: 'transparent', border: '1px solid var(--rule)', color: 'var(--ink)', padding: '8px 12px', font: 'inherit', cursor: pending || uploading ? 'wait' : 'pointer' }}
          >
            Retry saving photos
          </button>
        </div>
      )}
    </div>
  );
}
