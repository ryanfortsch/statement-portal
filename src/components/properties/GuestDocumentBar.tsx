import Link from 'next/link';
import { DownloadPropertyPdfButton } from './DownloadPropertyPdfButton';
import { PrintDocumentButton } from './PrintDocumentButton';
import type { PropertyDeliverable } from '@/lib/property-pdf';

/**
 * The one header bar every printed guest document shares: home guide,
 * welcome card, Wi-Fi placard, information note and trash day notice.
 *
 * Opened from the property page, each of those used to be a dead end: a
 * chrome-less page with no way back and no button, so printing meant Cmd+P
 * and leaving meant the browser's Back. The bar gives all five the same four
 * things, in the same order: Back, the home's name and the document's,
 * Print, Download PDF.
 *
 * Screen only, and the rule is load-bearing: the Puppeteer PDF path renders
 * these pages with print media, and the posted card must carry nothing but
 * itself. Render it only after a self-guarded document's access check, so a
 * denied request never shows it.
 */
export function GuestDocumentBar({
  propertyId,
  homeName,
  documentName,
  type,
}: {
  propertyId: string;
  homeName: string;
  documentName: string;
  type: PropertyDeliverable;
}) {
  return (
    <div className="rt-doc-bar" role="navigation" aria-label={`${documentName} for ${homeName}`}>
      <style>{barCss}</style>
      <Link href={`/properties/${propertyId}?tab=guest#guest-documents`} className="rt-doc-bar-back">
        &larr; Back
      </Link>
      <span className="rt-doc-bar-name">
        <strong>{homeName}</strong>
        <span aria-hidden> · </span>
        {documentName}
      </span>
      <span className="rt-doc-bar-actions">
        <PrintDocumentButton />
        <DownloadPropertyPdfButton propertyId={propertyId} type={type} label="Download PDF" />
      </span>
    </div>
  );
}

const barCss = `
  .rt-doc-bar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px 18px;
    padding: 10px 20px;
    background: var(--paper, #faf7f1);
    color: var(--ink, #1e2e34);
    border-bottom: 1px solid var(--rule, #d9d2c3);
    font-family: var(--font-inter), system-ui, sans-serif;
    font-size: 13px;
  }
  .rt-doc-bar-back {
    color: var(--ink-3, #5b6a70);
    text-decoration: none;
    font-size: 11px;
    letter-spacing: .16em;
    text-transform: uppercase;
    min-height: 36px;
    display: inline-flex;
    align-items: center;
  }
  .rt-doc-bar-name { color: var(--ink-3, #5b6a70); min-width: 0; }
  .rt-doc-bar-name strong { color: var(--ink, #1e2e34); font-weight: 500; }
  .rt-doc-bar-actions { margin-left: auto; display: inline-flex; gap: 8px; flex-wrap: wrap; }
  @media print {
    .rt-doc-bar { display: none !important; }
  }
`;
