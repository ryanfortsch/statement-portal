import chromium from '@sparticuz/chromium';
import puppeteer, { Browser } from 'puppeteer-core';

/**
 * PDF rendering for the Properties module's guest-facing deliverables:
 *
 *   home-guide   — 8.5" × 11" portrait (US Letter)
 *   wifi-placard — 4" × 6" portrait (slips into the glass case)
 *   info-note    — 8.5" × 11" portrait, the Gloucester STR permit posted
 *                   Information Note (contacts, trash, parking, ordinances,
 *                   safety equipment locations)
 *
 * Same Puppeteer + Vercel-protection-bypass pattern as the Statements and
 * Projections PDFs. The deliverable render pages set their own @page rule;
 * preferCSSPageSize honors that and we pass an explicit width/height for
 * paint correctness before the @page rule kicks in.
 */
export type PropertyDeliverable = 'home-guide' | 'wifi-placard' | 'info-note';

type Geometry = {
  viewportWidth: number;
  viewportHeight: number;
  pdfWidth: string;
  pdfHeight: string;
};

const GEOMETRIES: Record<PropertyDeliverable, Geometry> = {
  'home-guide':   { viewportWidth: 816, viewportHeight: 1056, pdfWidth: '8.5in', pdfHeight: '11in' },
  'wifi-placard': { viewportWidth: 384, viewportHeight: 576,  pdfWidth: '4in',   pdfHeight: '6in'  },
  'info-note':    { viewportWidth: 816, viewportHeight: 1056, pdfWidth: '8.5in', pdfHeight: '11in' },
};

export async function renderPropertyPdf(args: {
  propertyId: string;
  type: PropertyDeliverable;
  origin: string;
}): Promise<Buffer> {
  const { propertyId, type, origin } = args;
  const geo = GEOMETRIES[type];
  const url = `${origin}/properties/${encodeURIComponent(propertyId)}/${type}`;

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
    const bypass = process.env.VERCEL_PROTECTION_BYPASS;
    if (bypass) {
      await page.setExtraHTTPHeaders({
        'x-vercel-protection-bypass': bypass,
        'x-vercel-set-bypass-cookie': 'true',
      });
    }

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30_000 });
    await page.evaluate(() => (document as Document & { fonts: { ready: Promise<void> } }).fonts.ready);

    const pdf = await page.pdf({
      width: geo.pdfWidth,
      height: geo.pdfHeight,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
    return Buffer.from(pdf);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/** Filesystem-safe filename, e.g. "21 Horton St - Welcome Guide.pdf". */
export function propertyPdfFilename(propertyName: string, type: PropertyDeliverable): string {
  const labels: Record<PropertyDeliverable, string> = {
    'home-guide': 'Welcome Guide',
    'wifi-placard': 'WiFi Placard',
    'info-note': 'Information Note',
  };
  const safe = `${propertyName} - ${labels[type]}.pdf`;
  return safe.replace(/[\\/:*?"<>|]/g, '').trim();
}
