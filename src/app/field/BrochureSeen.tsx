'use client';

import { useEffect } from 'react';

/** Read on the server by /field: once someone has seen the welcome brochure
 *  (who we are, the standard, how a visit works) in full, it folds into one
 *  "How it works" line on every later visit. */
export const BROCHURE_SEEN_COOKIE = 'field_brochure_seen';

/** Marks the brochure seen, on the first view that rendered it open. */
export function BrochureSeen() {
  useEffect(() => {
    try {
      document.cookie = `${BROCHURE_SEEN_COOKIE}=1; path=/field; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    } catch {
      /* A blocked cookie just means the brochure shows open again. */
    }
  }, []);
  return null;
}
