'use client';

import { useState } from 'react';

/**
 * Download-the-signed-PDF CTA on the contract-signed confirmation
 * page. The button lives outside the Server Component so we can
 * acknowledge the click immediately — the underlying PDF endpoint
 * runs Puppeteer and takes 5-10s to respond, during which the
 * native `<a href download>` shows no visible state. Without this
 * feedback, owners click and assume nothing happened, then click
 * again, then again.
 *
 * On click: swap the label for a spinner + "Preparing PDF…" and
 * disable subsequent clicks until the timer resets (15s — covers
 * worst-case Puppeteer cold-start). The browser still handles the
 * actual download via the native href + download attribute, so the
 * download bar at the bottom of the browser does its normal thing
 * once the response starts streaming.
 */
export function DownloadCopyButton({ href, label }: { href: string; label: string }) {
  const [preparing, setPreparing] = useState(false);

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (preparing) {
      e.preventDefault();
      return;
    }
    setPreparing(true);
    // Reset state after 15s. Normal render is 5-10s; this gives a
    // buffer for cold starts but eventually lets the user click
    // again if the download somehow fell through.
    window.setTimeout(() => setPreparing(false), 15000);
  }

  return (
    <a
      href={href}
      className={preparing ? 'rt-th-download is-preparing' : 'rt-th-download'}
      download
      onClick={handleClick}
      aria-busy={preparing ? 'true' : 'false'}
    >
      {preparing ? (
        <>
          <span className="rt-th-spinner" aria-hidden="true" />
          Preparing PDF&hellip;
        </>
      ) : (
        <>{label} &rarr;</>
      )}
    </a>
  );
}
