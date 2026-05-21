import chromium from '@sparticuz/chromium';
import puppeteer, { Browser } from 'puppeteer-core';

/**
 * Render a completed inspection's print view to a letter-sized PDF.
 *
 * Puppeteer drives the /inspections/<id>/render page (the same printable
 * view the on-screen Print button targets), waits for fonts + network to
 * settle, then prints to PDF. Used to archive completed inspections to
 * the Rising Tide shared Drive.
 *
 * Mirrors src/lib/pdf.ts (statements). Unlike statements, an inspection
 * report is genuinely multi-page (one block per flagged item, photos,
 * notes) — so NO pageRanges cap here; let it run as long as it needs.
 *
 * Environment:
 *   - Vercel / Lambda: @sparticuz/chromium packaged binary.
 *   - Local dev: CHROME_EXECUTABLE_PATH points at a local Chrome.
 */
export async function renderInspectionPdf(args: {
  inspectionId: string;
  origin: string;
}): Promise<Buffer> {
  const { inspectionId, origin } = args;
  const url = `${origin}/inspections/${encodeURIComponent(inspectionId)}/render`;

  const localChrome = process.env.CHROME_EXECUTABLE_PATH;
  const executablePath = localChrome || (await chromium.executablePath());

  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      args: localChrome ? ['--no-sandbox'] : chromium.args,
      defaultViewport: { width: 816, height: 1056, deviceScaleFactor: 2 },
      executablePath,
      headless: true,
    });

    const page = await browser.newPage();

    // Skip Vercel Deployment Protection for this request (same pattern as
    // the statements + projection PDF renderers). The /render route is
    // also made public in src/proxy.ts so our own app auth doesn't block.
    const bypass = process.env.VERCEL_PROTECTION_BYPASS;
    if (bypass) {
      await page.setExtraHTTPHeaders({
        'x-vercel-protection-bypass': bypass,
        'x-vercel-set-bypass-cookie': 'true',
      });
    }

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30_000 });
    await page.evaluate(() => (document as Document & { fonts: { ready: Promise<void> } }).fonts.ready);
    // Force print media so @media print rules in the render page fire —
    // @sparticuz/chromium doesn't reliably default to print media for
    // page.pdf() (same workaround as the contract PDF renderer).
    await page.emulateMediaType('print');

    const pdf = await page.pdf({
      format: 'letter',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });

    return Buffer.from(pdf);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/** "21 Horton - 2026-05-15 Inspection.pdf" — filesystem-safe, readable. */
export function inspectionPdfFilename(propertyShort: string, completedAtIso: string): string {
  const date = completedAtIso.slice(0, 10); // YYYY-MM-DD
  const safe = `${propertyShort} - ${date} Inspection.pdf`;
  return safe.replace(/[\\/:*?"<>|]/g, '').trim();
}
