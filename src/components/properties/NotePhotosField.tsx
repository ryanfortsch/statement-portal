'use client';

import { useEffect, useRef, useState } from 'react';
import { PhotoUploader } from '@/components/PhotoUploader';

/**
 * Photos on a property note: the oil shutoff behind the boiler, the sofa
 * bed's sheets in the hall closet. The uploader holds the URLs; a hidden
 * field carries them with the form, so the note and its photos save in one
 * submit. Submit waits while a photo is still uploading.
 */
export function NotePhotosField({ propertyId, initial }: { propertyId: string; initial?: string[] | null }) {
  const [photos, setPhotos] = useState<string[]>(initial ?? []);
  const [uploading, setUploading] = useState(false);
  // Holds the form's submit while a batch is still uploading, with words
  // that say why, so a note never saves without the photo just taken.
  const hold = useRef<HTMLInputElement>(null);
  useEffect(() => {
    hold.current?.setCustomValidity(uploading ? 'Wait for the photos to finish uploading.' : '');
  }, [uploading]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span
        className="eyebrow"
        style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 600 }}
      >
        Photos
      </span>
      <input type="hidden" name="photo_urls" value={JSON.stringify(photos)} />
      <input ref={hold} type="text" defaultValue="" aria-hidden tabIndex={-1} style={{ position: 'absolute', opacity: 0, width: 1, height: 1, pointerEvents: 'none' }} />
      <PhotoUploader
        value={photos}
        onChange={setPhotos}
        folder={`properties/${propertyId}/notes`}
        onUploadingChange={setUploading}
      />
      <span style={{ fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.5 }}>Optional. What it looks like, where it is.</span>
    </div>
  );
}
