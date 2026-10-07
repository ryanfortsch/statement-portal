'use client';

import { usePdfDownload } from '@/lib/use-pdf-download';

/** Keep the guest on the confirmation page if PDF preparation fails. */
export function AgreementDownloadButton({ href }: { href: string }) {
  const { pending, error, download } = usePdfDownload(href, 'signed-agreement.pdf');
  return <div>
    <a href={href} download className={`sca-th-download${pending ? ' is-preparing' : ''}`}
      aria-busy={pending} aria-disabled={pending}
      onClick={event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); void download();
      }}>
      {pending && <span className="sca-th-spinner" aria-hidden="true" />}
      {pending ? 'Preparing PDF…' : 'Download a copy'}
    </a>
    {error && <p role="alert" style={{ color: 'var(--negative)', fontSize: 13 }}>{error} Use the download link to retry.</p>}
  </div>;
}
