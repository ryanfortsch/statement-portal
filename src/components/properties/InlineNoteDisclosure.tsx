'use client';

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { Button } from '@/components/Button';

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/**
 * The property page's inline "+ Add a fact" / "+ Flag an issue" form
 * (2026-11-08; it used to be its own page at /notes/new, which now lands
 * here). Opened by a plain `#<id>` link, so the header verb stays a link, an
 * old link or a redirect can open it, and no click handler is shared across
 * server-rendered sections. The form stays mounted while closed, so a
 * half-typed note survives Close; the page keys it on the note count, so a
 * saved note leaves a fresh form behind.
 */
export function InlineNoteDisclosure({ id, children }: { id: string; children: ReactNode }) {
  const open = useSyncExternalStore(subscribe, () => window.location.hash === `#${id}`, () => false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !ref.current) return;
    // Inside a closed CollapsibleSection, open the section too.
    ref.current.closest('details')?.setAttribute('open', '');
    ref.current.scrollIntoView({ block: 'nearest' });
    ref.current.querySelector<HTMLInputElement>('input[name="title"]')?.focus({ preventScroll: true });
  }, [open]);

  function close() {
    // Drop the hash so the same link opens the form again next time.
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  return (
    <div id={id} ref={ref} hidden={!open} className="rt-no-print" style={{ border: '1px solid var(--rule)', padding: '18px 20px', margin: '0 0 18px', scrollMarginTop: 120 }}>
      {children}
      <div style={{ marginTop: 10 }}>
        <Button variant="quiet" size="sm" onClick={close}>Close</Button>
      </div>
    </div>
  );
}
