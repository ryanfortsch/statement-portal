'use client';

import { useEffect, useRef, useState } from 'react';

/** How often a watched background pass is asked how much it has left. */
export const PASS_POLL_MS = 10_000;
/** How long a button watches before handing the rest to the nightly run. */
export const PASS_WATCH_MS = 5 * 60_000;

type Reading = { pending: number };

/**
 * Watch a background pass that runs after a server action returns (the
 * Work board's Organize, the maintenance planner's Plan now). Rather than
 * telling the operator to "check back", the button polls a count until it
 * reaches zero or the budget is spent, then says what was done.
 *
 * `poll` answers how many items the pass still has to do (plus anything the
 * caller wants to report); a thrown or failed poll is not a failed pass, so
 * the watch asks again next tick. `settleTicks` waits that many more ticks
 * after the count reaches zero, for a pass whose last step (a re-plan) runs
 * after its counted work.
 */
export function usePassWatch() {
  const [watching, setWatching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function watch<T extends Reading>(opts: {
    started: number;
    poll: () => Promise<T | null>;
    onProgress?: (done: number, reading: T | null) => void;
    onDone: (done: number, left: number, reading: T | null) => void;
    settleTicks?: number;
  }) {
    const startedAt = Date.now();
    let settle = opts.settleTicks ?? 0;
    let left = opts.started;
    setWatching(true);
    const tick = () => {
      timer.current = setTimeout(async () => {
        let reading: T | null = null;
        try {
          reading = await opts.poll();
          if (reading) left = reading.pending;
        } catch {
          // Ask again next tick.
        }
        const done = Math.max(0, opts.started - left);
        const timedOut = Date.now() - startedAt > PASS_WATCH_MS;
        if ((left === 0 && settle <= 0) || timedOut) {
          setWatching(false);
          opts.onDone(done, left, reading);
          return;
        }
        if (left === 0) settle -= 1;
        else opts.onProgress?.(done, reading);
        tick();
      }, PASS_POLL_MS);
    };
    tick();
  }

  return { watching, watch };
}
