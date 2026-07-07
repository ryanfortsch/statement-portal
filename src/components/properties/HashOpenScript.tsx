'use client';

import { useEffect } from 'react';

/**
 * Hash deep-link opener for pages built from native <details> sections.
 *
 * After a server action redirects to e.g. `?tab=records#notice-<id>`, the
 * anchor target often sits inside one or more COLLAPSED <details> elements
 * (CollapsibleSection / CollapsibleSubSection render closed by default), so
 * the browser's native hash scroll silently does nothing. On mount and on
 * hashchange this finds the hash target, walks up the ancestor chain opening
 * every <details> along the way (the target itself included, when it is one),
 * then scrolls the target into view.
 *
 * MUST be a client component with an effect, not an inline <script>: React
 * never executes script elements it mounts during client-side navigation
 * (which is what a server-action redirect is), and Next's pushState-based
 * URL sync fires no hashchange event. The effect runs on every remount of
 * the destination page, and Next updates location before effects run, so
 * the hash is current. Cross-route redirects (create/edit pages back to the
 * property page) remount this and Just Work; in-page anchor clicks fire
 * native hashchange. Known gap: a same-route redirect that only changes the
 * hash (the home-guide customize save, whose form lives on the page itself)
 * neither remounts nor fires hashchange; there the user is already inside
 * the open section, so nothing needs opening.
 *
 * Render ONCE per page, anywhere in the tree. Renders nothing.
 */
export function HashOpenScript() {
  useEffect(() => {
    function open() {
      const h = window.location.hash && window.location.hash.slice(1);
      if (!h) return;
      const el = document.getElementById(h);
      if (!el) return;
      let n: HTMLElement | null = el;
      while (n) {
        if (n.tagName === 'DETAILS') (n as HTMLDetailsElement).open = true;
        n = n.parentElement;
      }
      requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
    }
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);
  return null;
}
