'use client';

import { useRef, useState } from 'react';
import { PdfDownloadError, readPdfDownload, savePdfDownload } from './pdf-download';

/** Serialize requests until the full response is validated and handed to the browser. */
export function usePdfDownload(href: string, fallbackFilename: string) {
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function download() {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError('');
    try {
      const response = await fetch(href, { cache: 'no-store' });
      const { blob, filename } = await readPdfDownload(response, fallbackFilename);
      savePdfDownload(blob, filename);
    } catch (err) {
      setError(err instanceof PdfDownloadError
        ? err.message : 'Could not download the PDF. Check your connection and try again.');
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return { pending, error, download };
}
