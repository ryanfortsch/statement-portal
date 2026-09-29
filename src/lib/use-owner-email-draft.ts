'use client';

import { useRef, useState } from 'react';
import { useDraftNavigationGuard } from './use-draft-navigation-guard';

/** Keep a confirmed draft reachable even when the browser blocks its popup. */
export function useOwnerEmailDraft(endpoint: string, field: string, id: string | null) {
  const key = JSON.stringify([endpoint, field, id]);
  const current = useRef(key);
  current.current = key;
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState({ key, url: '', error: '' });
  const draftUrl = result.key === key ? result.url : '';
  const error = result.key === key ? result.error : '';
  useDraftNavigationGuard(false, pending);

  function open(url: string) {
    try { window.open(url, '_blank', 'noopener,noreferrer'); }
    catch { /* The visible link remains available. */ }
  }

  async function draft() {
    if (busy.current || !id) return;
    if (draftUrl) { open(draftUrl); return; }
    busy.current = true;
    setPending(true);
    setResult({ key, url: '', error: '' });
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Could not create the draft.');
      if (typeof data?.draft_url !== 'string' || !data.draft_url.trim()) throw new Error('Could not confirm the draft.');
      if (current.current !== key) return;
      setResult({ key, url: data.draft_url, error: '' });
      open(data.draft_url);
    } catch {
      if (current.current === key) setResult({ key, url: '', error: 'Could not confirm the Gmail draft. Check Gmail before retrying; the draft may already exist.' });
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return { pending, error, draftUrl, draft };
}
