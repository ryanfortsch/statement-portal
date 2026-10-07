'use client';

import { useEffect, useRef } from 'react';
import { useUnsavedWorkGuard } from './unsaved-work';

/** Protect reloads, deployment refreshes, and ordinary links out of a draft. */
export function useDraftNavigationGuard(dirty: boolean, pending = false) {
  const current = useRef({ dirty, pending });
  current.current = { dirty, pending };
  useUnsavedWorkGuard(dirty || pending);
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
      const url = new URL(link.href, location.href);
      if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search && url.hash) return;
      if (current.current.pending || (current.current.dirty && !window.confirm('Leave without saving these changes?'))) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
}
