import chromium from '@sparticuz/chromium';
import puppeteer, { Browser } from 'puppeteer-core';

/**
 * PDF rendering for the Properties module's guest-facing deliverables:
 *
 *   home-guide    — 8.5" × 11" portrait (US Letter)
 *   wifi-placard  — 4" × 6" portrait (slips into the glass case)
 *   info-note     — 8.5" × 11" portrait, the Gloucester STR permit posted
 *                    Information Note (contacts, trash, parking, ordinances,
 *                    safety equipment locations)
 *   notice        — 4" × 6" portrait, a bespoke per-property placard
 *                    addressed by an additional `noticeId` UUID
 *   welcome-card  — 4" × 6" portrait, the on-arrival welcome + subscribe
 *                    pitch with a QR to staycapeann.com/contact
 *
 * Same Puppeteer + Vercel-protection-bypass pattern as the Statements and
 * Projections PDFs. The deliverable render pages set their own @page rule;
 * preferCSSPageSize honors that and we pass an explicit width/height for
 * paint correctness before the @page rule kicks in.
 */
export type PropertyDeliverable =
  | 'home-guide'
  | 'wifi-placard'
  | 'info-note'
  | 'notice'
  | 'welcome-card';

type Geometry = {
  viewportWidth: number;
  viewportHeight: number;
  pdfWidth: string;
  pdfHeight: string;
};

const GEOMETRIES: Record<PropertyDeliverable, Geometry> = {
  'home-guide':    { viewportWidth: 816, viewportHeight: 1056, pdfWidth: '8.5in', pdfHeight: '11in' },
  'wifi-placard':  { viewportWidth: 384, viewportHeight: 576,  pdfWidth: '4in',   pdfHeight: '6in'  },
  'info-note':     { viewportWidth: 816, viewportHeight: 1056, pdfWidth: '8.5in', pdfHeight: '11in' },
  'notice':        { viewportWidth: 384, viewportHeight: 576,  pdfWidth: '4in',   pdfHeight: '6in'  },
  'welcome-card':  { viewportWidth: 384, viewportHeight: 576,  pdfWidth: '4in',   pdfHeight: '6in'  },
};

export async function renderPropertyPdf(args: {
  propertyId: string;
  type: PropertyDeliverable;
  origin: string;
  /** Required when type === 'notice'; identifies which bespoke notice to render. */
  noticeId?: string;
}): Promise<Buffer> {
  const { propertyId, type, origin, noticeId } = args;
  const geo = GEOMETRIES[type];
  // Notices live at /properties/<id>/notice/<noticeId>; everything else is
  // /properties/<id>/<type>.
  const url =
    type === 'notice'
      ? `${origin}/properties/${encodeURIComponent(propertyId)}/notice/${encodeURIComponent(noticeId ?? '')}`
      : `${origin}/properties/${encodeURIComponent(propertyId)}/${type}`;

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

/**
 * Filesystem-safe filename, e.g. "21 Horton - Welcome Guide.pdf". For
 * bespoke notices the caller passes the notice title; we slugify and
 * use it as the suffix so a downloads folder full of placards stays
 * legible.
 */
export function propertyPdfFilename(
  propertyName: string,
  type: PropertyDeliverable,
  noticeTitle?: string,
): string {
  const labels: Record<PropertyDeliverable, string> = {
    'home-guide': 'Welcome Guide',
    'wifi-placard': 'WiFi Placard',
    'info-note': 'Information Note',
    'notice': 'Notice',
    'welcome-card': 'Welcome Card',
  };
  const baseLabel =
    type === 'notice' && noticeTitle
      ? `Notice - ${noticeTitle}`
      : labels[type];
  const safe = `${propertyName} - ${baseLabel}.pdf`;
  return safe.replace(/[\\/:*?"<>|]/g, '').trim();
}
