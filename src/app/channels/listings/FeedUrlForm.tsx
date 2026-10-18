'use client';

import type { ReactNode } from 'react';

/**
 * The per-channel iCal URL form. Saving it with the URL blanked stops Helm
 * reading the feed and cancels its imported closures (saveListing ->
 * retireFeedHolds), so a blank save over a URL that was there asks first,
 * naming the count. Any other save goes straight through.
 */
export function FeedUrlForm({
  action,
  hadUrl,
  clearedConfirm,
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  hadUrl: boolean;
  clearedConfirm: string;
  children: ReactNode;
}) {
  return (
    <form
      action={action}
      style={{ display: 'contents' }}
      onSubmit={(e) => {
        if (!hadUrl) return;
        const field = e.currentTarget.elements.namedItem('ical_import_url');
        const value = field instanceof HTMLInputElement ? field.value.trim() : '';
        if (!value && !window.confirm(clearedConfirm)) e.preventDefault();
      }}
    >
      {children}
    </form>
  );
}
