'use client';

import { useRef, useState } from 'react';
import { upload } from '@vercel/blob/client';

// A short iPhone clip stays small; the duration cap is the real lever and the
// size cap is a backstop that matches the server token.
const MAX_SECONDS = 30;
const MAX_BYTES = 80 * 1024 * 1024;

/** Read a video file's duration (seconds) from its metadata, client-side, so we
 *  can reject anything over 30s before a single byte uploads. */
function readDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(v.src);
      resolve(Number.isFinite(v.duration) ? v.duration : 0);
    };
    v.onerror = () => {
      URL.revokeObjectURL(v.src);
      reject(new Error('Could not read that video.'));
    };
    v.src = URL.createObjectURL(file);
  });
}

/**
 * Optional intro-video capture for the public apply page. Lets an applicant
 * record or pick a clip on their phone, checks it's a video under 30 seconds,
 * uploads it straight to Vercel Blob (client-direct), and stashes the public
 * URL in a hidden `video_url` field the form submits. No clip = empty field.
 */
export function ApplyVideo() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'idle' | 'checking' | 'uploading' | 'done' | 'error'>('idle');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  async function handleFile(file: File) {
    setErr(null);
    if (!file.type.startsWith('video/')) {
      setErr('Please choose a video file.');
      setStatus('error');
      return;
    }
    setStatus('checking');

    let duration = 0;
    try {
      duration = await readDuration(file);
    } catch {
      // Some phone formats don't report metadata reliably; fall back to the
      // size cap rather than blocking a valid short clip.
    }
    if (duration && duration > MAX_SECONDS + 1) {
      setErr(`That clip is about ${Math.round(duration)} seconds. Please keep it under ${MAX_SECONDS}.`);
      setStatus('error');
      return;
    }
    if (file.size > MAX_BYTES) {
      setErr('That file is too large — a clip under 30 seconds from your phone should fit fine.');
      setStatus('error');
      return;
    }

    setStatus('uploading');
    setPct(0);
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60) || 'clip.mov';
      const blob = await upload(`field-applications/${safe}`, file, {
        access: 'public',
        handleUploadUrl: '/api/field/apply-video',
        contentType: file.type,
        onUploadProgress: (p) => setPct(Math.round(p.percentage)),
      });
      setUrl(blob.url);
      setName(file.name);
      setStatus('done');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed. Please try again.');
      setStatus('error');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function reset() {
    setUrl('');
    setName('');
    setStatus('idle');
    setErr(null);
    setPct(0);
  }

  const busy = status === 'checking' || status === 'uploading';

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 8 }}>
        Short intro video <span style={{ color: 'var(--ink-4)' }}>(optional)</span>
      </div>

      <input type="hidden" name="video_url" value={url} />
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        style={{ display: 'none' }}
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />

      {status === 'done' ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            border: '1px solid var(--rule)',
            borderRadius: 6,
            padding: '11px 14px',
            background: 'var(--paper)',
          }}
        >
          <span style={{ fontSize: 14, color: 'var(--positive, #2e7d4f)' }}>
            ✓ Video attached{name ? <span style={{ color: 'var(--ink-4)' }}> · {name}</span> : null}
          </span>
          <button
            type="button"
            onClick={reset}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--ink-4)', textDecoration: 'underline' }}
          >
            Remove
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          style={{
            width: '100%',
            background: 'transparent',
            border: '1px dashed var(--rule)',
            borderRadius: 6,
            padding: '12px 16px',
            fontSize: 11,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            fontWeight: 500,
            color: 'var(--ink-3)',
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {status === 'checking' ? 'Checking length…' : status === 'uploading' ? `Uploading… ${pct}%` : '+ Record or upload a clip'}
        </button>
      )}

      <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 6, lineHeight: 1.5 }}>
        Totally optional, but a clip on why you&apos;d be a fit goes a long way. Keep it under 30 seconds, straight from your phone.
      </div>

      {err && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--signal)' }}>{err}</div>
      )}
    </div>
  );
}
