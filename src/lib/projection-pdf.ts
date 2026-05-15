import chromium from '@sparticuz/chromium';
import puppeteer, { Browser } from 'puppeteer-core';

/**
 * PDF rendering for the Projections deliverables. Mirrors the pattern in
 * src/lib/pdf.ts (statements PDF) but takes a `type` argument because the
 * deliverables have different page geometries:
 *
 *   projection — 13.33" × 7.5" widescreen (16:9 deck)
 *   guide      — 8.5" × 11" portrait (US Letter)
 *   contract   — 8.5" × 11" portrait (US Letter)
 *   readiness  — 8.5" × 11" portrait (US Letter — printable punch list)
 *
 * Each render page already has an @page rule baked into its inline CSS;
 * preferCSSPageSize honors that. We pass an explicit width/height too so the
 * paint reflects the intended geometry even before the @page rule kicks in.
 */
export type DeliverableType = 'projection' | 'guide' | 'contract' | 'readiness';

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
  readiness: { viewportWidth: 816, viewportHeight: 1056, pdfWidth: '8.5in', pdfHeight: '11in' },
};

const SLUGS: Record<DeliverableType, string> = {
  projection: 'render',
  guide: 'guide',
  contract: 'contract',
  readiness: 'readiness',
};

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

    // Deliverables that need browser-driven pagination (the readiness
    // checklist is a flowing list; the contract has cover/body/sig pages
    // with their own per-section margins) keep their CSS @page margins.
    // Single-page full-bleed deliverables (deck, guide) get a hard
    // margin: 0 override so the content paints edge-to-edge regardless
    // of stylesheet quirks.
    const usesCssPageMargins = type === 'contract' || type === 'readiness';
    const pdf = await page.pdf({
      width: geo.pdfWidth,
      height: geo.pdfHeight,
      printBackground: true,
      preferCSSPageSize: true,
      ...(usesCssPageMargins
        ? {}
        : { margin: { top: '0', bottom: '0', left: '0', right: '0' } }),
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
    readiness: 'Readiness Checklist',
  };
  const safe = `${propertyAddress} - ${labels[type]}.pdf`;
  return safe.replace(/[\\/:*?"<>|]/g, '').trim();
}
