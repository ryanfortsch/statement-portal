'use client';

import { useRef, useState } from 'react';
import { compressImage } from '@/lib/image-compress';
import { saveProfilePhoto } from './actions';

function initialsOf(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** Tap the avatar (or the link) to upload/replace a profile photo. Uploads to
 *  the contractor-auth /api/field/upload, then persists the URL.
 *
 *  `size` sizes the circular avatar (default 64). `stacked` puts the
 *  change-photo affordance centered BELOW the avatar instead of beside it, so
 *  it can sit cleanly inside a hero next to the name. */
export function ProfilePhoto({
  current,
  name,
  size = 64,
  stacked = false,
  onDark = false,
}: {
  current: string | null;
  name: string;
  size?: number;
  stacked?: boolean;
  /** Rendered on a navy ground (the hero plate): rings the avatar in soft gold
   *  and lightens the change-photo link so it reads on dark. */
  onDark?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(raw: File) {
    setErr(null);
    setBusy(true);
    try {
      const file = await compressImage(raw);
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/field/upload', { method: 'POST', body: fd });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        setErr(body.error || `Upload failed (HTTP ${res.status})`);
        return;
      }
      await saveProfilePhoto(body.url);
      setUrl(body.url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: stacked ? 'column' : 'row', alignItems: 'center', gap: stacked ? 8 : 12 }}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="user"
        style={{ display: 'none' }}
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      <button
        type="button"
        onClick={() => !busy && inputRef.current?.click()}
        title="Change photo"
        style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', cursor: busy ? 'wait' : 'pointer', background: 'var(--paper-2, #fff)', border: onDark ? 'none' : '1px solid var(--rule)', boxShadow: onDark ? '0 0 0 1px var(--signal-soft)' : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 }}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span className="font-serif" style={{ fontSize: Math.round(size * 0.34), color: 'var(--ink-4)' }}>{initialsOf(name)}</span>
        )}
      </button>
      <div style={{ textAlign: stacked ? 'center' : 'left' }}>
        <button
          type="button"
          onClick={() => !busy && inputRef.current?.click()}
          disabled={busy}
          style={{ background: 'none', border: 'none', cursor: busy ? 'wait' : 'pointer', color: onDark ? 'var(--signal-soft)' : 'var(--signal)', fontSize: 12, fontWeight: 600, padding: 0, textDecoration: 'underline' }}
        >
          {busy ? 'Uploading…' : url ? 'Change photo' : 'Add a photo'}
        </button>
        {err && <div style={{ fontSize: 11, color: 'var(--negative)', marginTop: 2 }}>{err}</div>}
      </div>
    </div>
  );
}
