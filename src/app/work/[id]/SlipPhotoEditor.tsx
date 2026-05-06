'use client';

import { useState, useTransition } from 'react';
import { PhotoUploader } from '@/components/PhotoUploader';
import { updateWorkSlipPhotos } from '../actions';

type Props = {
  slipId: string;
  propertyId: string;
  initialUrls: string[];
};

/**
 * Editable wrapper around PhotoUploader for a single work slip. The
 * uploader returns the new array on every add/remove; we persist via
 * the server action and surface a tiny "Saved" toast. The component
 * keeps optimistic local state so removals stay snappy even if the
 * write is in flight.
 */
export function SlipPhotoEditor({ slipId, propertyId, initialUrls }: Props) {
  const [urls, setUrls] = useState<string[]>(initialUrls);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function handleChange(next: string[]) {
    setUrls(next);
    setErr(null);
    startTransition(async () => {
      const res = await updateWorkSlipPhotos({ id: slipId, photo_urls: next });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setSavedAt(Date.now());
    });
  }

  return (
    <div>
      <PhotoUploader
        value={urls}
        onChange={handleChange}
        folder={`work-slips/${propertyId}/${slipId}`}
        disabled={pending}
      />

      <div
        style={{
          marginTop: 10,
          minHeight: 18,
          fontSize: 11,
          letterSpacing: '.16em',
          textTransform: 'uppercase',
          color: err ? 'var(--negative)' : 'var(--ink-3)',
        }}
      >
        {err
          ? err
          : pending
            ? 'Saving…'
            : savedAt
              ? `Saved · ${urls.length} photo${urls.length === 1 ? '' : 's'}`
              : urls.length > 0
                ? `${urls.length} photo${urls.length === 1 ? '' : 's'} attached`
                : ''}
      </div>
    </div>
  );
}
