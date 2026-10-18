'use client';

import { useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useDraftNavigationGuard } from './use-draft-navigation-guard';
import { canOpenMailbox, draftSavedNotice } from './gmail-links';
import { copiedEmailText, parseCopiedEmail, writeClipboard } from './copy-email';

/**
 * Keep a confirmed draft reachable even when the browser blocks its popup.
 *
 * The route names the mailbox the draft landed in. Only the session that
 * owns that mailbox is handed the link (`draftUrl`) or has it opened;
 * everyone else gets `savedIn`, a sentence saying whose drafts it is in.
 * A route that drafts in the sender's own Gmail (the owner email) answers
 * `copy` instead when Helm holds no token for them: the email goes on the
 * clipboard (`copied`, with the text to select by hand if the browser
 * refuses). A second click never drafts twice either way; after a copy it
 * copies the same text again.
 */
export function useOwnerEmailDraft(endpoint: string, field: string, id: string | null) {
  const key = JSON.stringify([endpoint, field, id]);
  const current = useRef(key);
  current.current = key;
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ key: string; url: string; mailbox: string | null; error: string; copied?: { text: string; ok: boolean } }>({ key, url: '', mailbox: null, error: '' });
  const sessionEmail = useSession().data?.user?.email;
  const made = result.key === key && !!result.url;
  const canOpen = made && canOpenMailbox(sessionEmail, result.mailbox);
  const draftUrl = canOpen ? result.url : '';
  const savedIn = made && !canOpen ? draftSavedNotice(result.mailbox) : '';
  const error = result.key === key ? result.error : '';
  const copied = result.key === key && result.copied ? result.copied : null;
  useDraftNavigationGuard(false, pending);

  function open(url: string) {
    try { window.open(url, '_blank', 'noopener,noreferrer'); }
    catch { /* The visible link remains available. */ }
  }

  async function draft() {
    if (busy.current || !id) return;
    if (made) { if (canOpen) open(result.url); return; }
    if (copied) {
      const ok = await writeClipboard(copied.text);
      setResult((r) => (r.key === key ? { ...r, copied: { text: copied.text, ok } } : r));
      return;
    }
    busy.current = true;
    setPending(true);
    setResult({ key, url: '', mailbox: null, error: '' });
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Could not create the draft.');
      const copy = parseCopiedEmail(data?.copy);
      if (copy) {
        if (current.current !== key) return;
        const text = copiedEmailText(copy);
        const ok = await writeClipboard(text);
        if (current.current !== key) return;
        setResult({ key, url: '', mailbox: null, error: '', copied: { text, ok } });
        return;
      }
      if (typeof data?.draft_url !== 'string' || !data.draft_url.trim()) throw new Error('Could not confirm the draft.');
      if (current.current !== key) return;
      const mailbox = typeof data?.mailbox === 'string' ? data.mailbox : null;
      setResult({ key, url: data.draft_url, mailbox, error: '' });
      if (canOpenMailbox(sessionEmail, mailbox)) open(data.draft_url);
    } catch {
      if (current.current === key) setResult({ key, url: '', mailbox: null, error: 'Could not confirm the Gmail draft. Check Gmail before retrying; the draft may already exist.' });
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return { pending, error, draftUrl, draft, savedIn, copied };
}
