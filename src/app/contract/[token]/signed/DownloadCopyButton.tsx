'use client';

import { usePdfDownload } from '@/lib/use-pdf-download';

/** Signed-copy progress follows the response, including slow PDF renders. */
export function DownloadCopyButton({ href, label }: { href: string; label: string }) {
  const { pending, error, download } = usePdfDownload(href, 'signed-contract.pdf');
  return <div>
    <a href={href} download className={pending ? 'rt-th-download is-preparing' : 'rt-th-download'}
      aria-busy={pending} aria-disabled={pending}
      onClick={event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); void download();
      }}>
      {pending ? <><span className="rt-th-spinner" aria-hidden="true" />Preparing PDF&hellip;</> : <>{label} &rarr;</>}
    </a>
    {error && <p role="alert" style={{ color: 'var(--negative)', fontSize: 13 }}>{error} Use the download link to retry.</p>}
  </div>;
}
