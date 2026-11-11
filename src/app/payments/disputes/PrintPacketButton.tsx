'use client';

import { Button } from '@/components/Button';

/**
 * Save the packet as a PDF for the Stripe upload. The browser's own print
 * dialog, so the PDF is exactly the page the owner just read; the page's
 * print rules drop the navigation, the form and the working notes. The one
 * primary on the packet page.
 */
export function PrintPacketButton() {
  return (
    <Button variant="primary" size="sm" onClick={() => window.print()}>
      Save as PDF
    </Button>
  );
}
