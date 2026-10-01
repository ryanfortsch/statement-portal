'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/** Compact mobile review, with the existing card and its draft state kept mounted. */
export function MobileInboxReview({ id, name, property, preview, channel, enabled = true, keepOpen = false, draftInProgress = false, children }: {
  id: string; name: string; property?: string; preview?: string | null; channel?: string;
  enabled?: boolean; keepOpen?: boolean; draftInProgress?: boolean; children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const root = useRef<HTMLDivElement>(null);
  const open = expanded || keepOpen;

  useEffect(() => {
    const reveal = () => {
      if (window.location.hash === '#approval-' + id) setExpanded(true);
    };
    const frame = requestAnimationFrame(reveal);
    window.addEventListener('hashchange', reveal);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('hashchange', reveal); };
  }, [id]);

  useEffect(() => {
    if (open && window.location.hash === '#approval-' + id) root.current?.scrollIntoView({ block: 'start' });
  }, [open, id]);

  if (!enabled) return children;
  return <div ref={root} className="rt-inbox-review" data-open={open || undefined}>
    <button type="button" className="rt-inbox-review-toggle" aria-expanded={open} aria-controls={bodyId}
      aria-label={open ? 'Close message from ' + name : 'Review message from ' + name}
      disabled={keepOpen} onClick={() => setExpanded(value => !value)}>
      {open ? <span className="rt-inbox-review-close">Close message <span aria-hidden="true">−</span></span> : <>
        <span className="rt-inbox-review-heading"><span className="font-serif">{name}</span><span className="rt-inbox-review-channel">{channel?.replace(/^email.*$/i, "Email").replace(/^airbnb.*$/i, "Airbnb")}</span></span>
        {property && <span className="rt-inbox-review-property">{property}</span>}
        <span className="rt-inbox-review-preview">{preview?.trim() || 'Reply ready to review'}</span>
        <span className="rt-inbox-review-link">{draftInProgress ? "Continue reply" : "Review reply"} <span aria-hidden="true">→</span></span>
      </>}
    </button>
    <div id={bodyId} className="rt-inbox-review-body">{children}
      <button type="button" className="rt-inbox-back" disabled={keepOpen} onClick={() => {
        setExpanded(false);
        root.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
        root.current?.querySelector<HTMLButtonElement>('.rt-inbox-review-toggle')?.focus({ preventScroll: true });
      }}>Back to inbox</button>
    </div>
  </div>;
}
