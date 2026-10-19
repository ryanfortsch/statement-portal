'use client';

import { useRef, type ReactNode } from 'react';
import { useConfirm } from '@/components/ConfirmDialog';
import { askFromSentence } from '@/lib/confirm-question';

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
  const { ask } = useConfirm();
  // Set for the one resubmit after a yes, so it goes straight through.
  const confirmed = useRef(false);
  return (
    <form
      action={action}
      style={{ display: 'contents' }}
      onSubmit={async (e) => {
        if (confirmed.current) { confirmed.current = false; return; }
        if (!hadUrl) return;
        const form = e.currentTarget;
        const field = form.elements.namedItem('ical_import_url');
        const value = field instanceof HTMLInputElement ? field.value.trim() : '';
        if (value) return;
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        if (!(await ask({ ...askFromSentence(clearedConfirm), confirmLabel: 'Save with no URL', tone: 'danger' }))) return;
        if (!form.isConnected) return;
        confirmed.current = true;
        form.requestSubmit(submitter ?? undefined);
      }}
    >
      {children}
    </form>
  );
}
