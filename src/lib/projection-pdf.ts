import chromium from '@sparticuz/chromium';
import puppeteer, { Browser } from 'puppeteer-core';

/**
 * PDF rendering for the three Projections deliverables. Mirrors the pattern in
 * src/lib/pdf.ts (statements PDF) but takes a `type` argument because the
 * three deliverables have different page geometries:
 *
 *   projection — 13.33" × 7.5" widescreen (16:9 deck)
 *   guide      — 8.5" × 11" portrait (US Letter)
 *   contract   — 8.5" × 11" portrait (US Letter)
 *
 * Each render page already has an @page rule baked into its inline CSS;
 * preferCSSPageSize honors that. We pass an explicit width/height too so the
 * paint reflects the intended geometry even before the @page rule kicks in.
 */
export type DeliverableType = 'projection' | 'guide' | 'contract';

type Geometry = {
  /** CSS px viewport for paint */
  viewportWidth: number;
  viewportHeight: number;
  /** PDF page size in inches */
  pdfWidth: string;
  pdfHeight: string;
};

const GEOMETRIES: Record<DeliverableType, Geometry> = {
  projection: { viewportWidth: 1280, viewportHeight: 720, pdfWidth: '13.333in', pdfHeight: '7.5in' },
  guide: { viewportWidth: 816, viewportHeight: 1056, pdfWidth: '8.5in', pdfHeight: '11in' },
  contract: { viewportWidth: 816, viewportHeight: 1056, pdfWidth: '8.5in', pdfHeight: '11in' },
};

const SLUGS: Record<DeliverableType, string> = {
  projection: 'render',
  guide: 'guide',
  contract: 'contract',
};

/**
 * Puppeteer footer template for contract PDFs. Renders in the @page bottom
 * margin (0.6in) on every printed sheet that has a margin reserved. The
 * cover sheet uses @page cover-page with margin:0, so the template doesn't
 * render there (no margin space = no footer band). Body and signature
 * sheets get the brand line on the left, page number on the right.
 *
 * Class names with special handling: .pageNumber, .totalPages — Puppeteer
 * substitutes these at render time.
 */
const CONTRACT_FOOTER_TEMPLATE = `
<div style="font-size:9px;font-family:'Inter',-apple-system,system-ui,sans-serif;letter-spacing:0.18em;text-transform:uppercase;color:#8a969c;width:100%;padding:0 80px 24px;box-sizing:border-box;display:flex;justify-content:space-between;align-items:flex-end;">
  <span>Rising Tide &middot; Management Contract &middot; risingtidestr.com</span>
  <span class="pageNumber"></span>
</div>
`;

export async function renderProjectionPdf(args: {
  projectionId: string;
  type: DeliverableType;
  origin: string;
}): Promise<Buffer> {
  const { projectionId, type, origin } = args;
  const geo = GEOMETRIES[type];
  const url = `${origin}/projections/${encodeURIComponent(projectionId)}/${SLUGS[type]}`;

  const localChrome = process.env.CHROME_EXECUTABLE_PATH;
  const executablePath = localChrome || (await chromium.executablePath());

  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      args: localChrome ? ['--no-sandbox'] : chromium.args,
      defaultViewport: { width: geo.viewportWidth, height: geo.viewportHeight, deviceScaleFactor: 2 },
      executablePath,
      headless: true,
    });

    const page = await browser.newPage();

    // Same Vercel Deployment Protection bypass as statements PDF generation.
    const bypass = process.env.VERCEL_PROTECTION_BYPASS;
    if (bypass) {
      await page.setExtraHTTPHeaders({
        'x-vercel-protection-bypass': bypass,
        'x-vercel-set-bypass-cookie': 'true',
      });
    }

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30_000 });

    // Wait for Google Fonts so Fraunces / Inter render correctly.
    await page.evaluate(() => (document as Document & { fonts: { ready: Promise<void> } }).fonts.ready);

    // Force the print media so @media print rules in the page CSS fire.
    // Puppeteer docs claim page.pdf() uses print media by default, but with
    // @sparticuz/chromium that doesn't always happen in practice (you can
    // tell when DocFooter elements that are display:none in @media print
    // still render in the PDF). Calling this explicitly is the documented
    // workaround.
    await page.emulateMediaType('print');

    // Contract PDFs use a per-sheet footer rendered by Puppeteer in the
    // @page bottom margin — the inline DocFooter element is display:none
    // in print, since it was tied to logical-page boundaries that don't
    // map 1:1 to printed sheets once override-expanded sections flow
    // continuously. The cover bleeds full navy via @page cover-page with
    // margin:0, so no footer renders on the cover sheet (no margin space).
    const isContract = type === 'contract';
    const pdf = await page.pdf({
      width: geo.pdfWidth,
      height: geo.pdfHeight,
      printBackground: true,
      preferCSSPageSize: true,
      // For non-contract deliverables (projection deck, guide), force
      // margin: 0 — those are full-bleed single-purpose designs.
      // For the contract, omit margin entirely so the CSS @page named
      // rules win — cover-page uses margin:0 (full navy bleed), the
      // default @page reserves 0.6in at the bottom where the footer
      // template renders. Passing an explicit margin here would
      // override the CSS @page rules globally and the cover would
      // lose its bleed.
      ...(isContract
        ? {}
        : { margin: { top: '0', bottom: '0', left: '0', right: '0' } }),
      displayHeaderFooter: isContract,
      headerTemplate: isContract ? '<div></div>' : undefined,
      footerTemplate: isContract ? CONTRACT_FOOTER_TEMPLATE : undefined,
    });

    return Buffer.from(pdf);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Build a friendly, filesystem-safe filename:
 *   "16 Waterman Rd - Projection.pdf"
 *   "16 Waterman Rd - Partnership Guide.pdf"
 *   "16 Waterman Rd - Contract.pdf"
 */
export function projectionPdfFilename(propertyAddress: string, type: DeliverableType): string {
  const labels: Record<DeliverableType, string> = {
    projection: 'Projection',
    guide: 'Partnership Guide',
    contract: 'Contract',
  };
  const safe = `${propertyAddress} - ${labels[type]}.pdf`;
  return safe.replace(/[\\/:*?"<>|]/g, '').trim();
}
