'use client';

import { useState } from 'react';

/**
 * "Download a copy" on the agreement confirmation page. The PDF endpoint
 * takes 5-10s (cold Puppeteer render), so the button shifts into a
 * preparing state on click — the guest knows the request registered.
 * Mirrors the owner contract's DownloadCopyButton.
 */
export function AgreementDownloadButton({ href }: { href: string }) {
  const [preparing, setPreparing] = useState(false);

  return (
    <a
      href={href}
      className={`sca-th-download${preparing ? ' is-preparing' : ''}`}
      onClick={() => {
        setPreparing(true);
        // The download response never navigates the page, so clear the
        // state after the render window passes in case they want a
        // second copy.
        setTimeout(() => setPreparing(false), 15_000);
      }}
    >
      {preparing && <span className="sca-th-spinner" aria-hidden="true" />}
      {preparing ? 'Preparing PDF…' : 'Download a copy'}
    </a>
  );
}
