'use client';

import { useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * router.refresh() that never yanks the page to the top.
 *
 * A bare router.refresh() re-suspends the segment's Suspense boundary; on
 * any route with a loading.tsx that swaps the whole page for a skeleton,
 * which unmounts the tree and resets scroll to 0. Wrapping the refresh in a
 * transition keeps the current UI mounted while the new payload streams, so
 * the operator stays exactly where they were (mark a task done halfway down
 * /work, stay halfway down /work).
 *
 * The trap this exists for: in React 19, code AFTER an `await` inside a
 * startTransition callback is no longer in the transition scope, so
 *
 *   startTransition(async () => {
 *     await someServerAction();
 *     router.refresh();          // <- runs OUTSIDE the transition: jumps
 *   });
 *
 * still scroll-jumps. Calling softRefresh() there opens a fresh synchronous
 * transition around the refresh itself, which is what actually keeps the
 * boundary from falling back. (Same fix MessagingQueue shipped for its
 * skeleton-swap bug, extracted for every surface.)
 */
export function useSoftRefresh(): () => void {
  const router = useRouter();
  const [, startTransition] = useTransition();
  return useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);
}
