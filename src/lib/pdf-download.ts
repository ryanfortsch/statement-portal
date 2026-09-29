export class PdfDownloadError extends Error {}

/** Validate the response before asking the browser to save a PDF. */
export async function readPdfDownload(response: Response, fallbackFilename: string) {
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new PdfDownloadError('This download is not authorized. Reopen your original link or sign in, then try again.');
    }
    throw new PdfDownloadError('The PDF could not be prepared. Please try again.');
  }
  const type = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/pdf') throw new PdfDownloadError('The server did not return a PDF. Please try again.');
  const blob = await response.blob();
  if (blob.size < 5 || await blob.slice(0, 5).text() !== '%PDF-') {
    throw new PdfDownloadError('The PDF response was empty or invalid. Please try again.');
  }
  const disposition = response.headers.get('Content-Disposition') || '';
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] || fallbackFilename;
  return { blob, filename };
}

/** Delay cleanup until the browser has had time to begin the download. */
export function savePdfDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}
