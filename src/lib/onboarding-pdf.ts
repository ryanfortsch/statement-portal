import chromium from '@sparticuz/chromium';
import puppeteer, { Browser } from 'puppeteer-core';

/**
 * Render the owner-onboarding intake document to a letter-sized PDF.
 *
 * Puppeteer drives /projections/<id>/onboarding-render (the printable
 * intake view), waits for fonts + network, prints to PDF. Used to
 * archive the submitted intake to the Rising Tide shared Drive.
 *
 * Mirrors src/lib/pdf.ts / inspection-pdf.ts.
 */
export async function renderOnboardingPdf(args: {
  projectionId: string;
  origin: string;
}): Promise<Buffer> {
  const { projectionId, origin } = args;
  const url = `${origin}/projections/${encodeURIComponent(projectionId)}/onboarding-render`;

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

    const bypass = process.env.VERCEL_PROTECTION_BYPASS;
    if (bypass) {
      await page.setExtraHTTPHeaders({
        'x-vercel-protection-bypass': bypass,
        'x-vercel-set-bypass-cookie': 'true',
      });
    }

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30_000 });
    await page.evaluate(() => (document as Document & { fonts: { ready: Promise<void> } }).fonts.ready);
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

/** "21 Horton - Owner Intake 2026-05-15.pdf" — filesystem-safe. */
export function onboardingPdfFilename(propertyShort: string, submittedIso: string | null): string {
  const date = (submittedIso || new Date().toISOString()).slice(0, 10);
  const safe = `${propertyShort} - Owner Intake ${date}.pdf`;
  return safe.replace(/[\\/:*?"<>|]/g, '').trim();
}
