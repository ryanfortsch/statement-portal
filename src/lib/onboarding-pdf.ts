import chromium from '@sparticuz/chromium';
import puppeteer, { Browser } from 'puppeteer-core';

/**
 * Render the owner-onboarding intake document to a letter-sized PDF.
 *
 * Puppeteer drives /projections/<id>/onboarding-render (the printable
 * intake view), waits for fonts + network, prints to PDF. Used to
 * archive the submitted intake to the Rising Tide shared Drive.
 *
 * The render page self-guards (Helm session OR the projection's
 * onboarding_token — it shows WiFi passwords and lock codes), so the
 * headless request must carry `token`. The caller reads it off the
 * projections row it already fetched.
 *
 * Mirrors src/lib/pdf.ts / inspection-pdf.ts.
 */
export async function renderOnboardingPdf(args: {
  projectionId: string;
  origin: string;
  token: string;
}): Promise<Buffer> {
  const { projectionId, origin, token } = args;
  const url =
    `${origin}/projections/${encodeURIComponent(projectionId)}/onboarding-render` +
    `?token=${encodeURIComponent(token)}`;

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

    const response = await page.goto(url, { waitUntil: 'networkidle0', timeout: 30_000 });
    // The page denies bad/missing tokens with notFound(). Archiving that
    // to Drive would look like success, so fail loudly instead. The
    // status check alone isn't enough: /projections has a loading.tsx
    // boundary, so Next streams a 200 shell before notFound() throws and
    // the denial arrives in-stream as the not-found UI. The reliable
    // tell is the intake document root, which every authorized render
    // includes (even a not-yet-submitted intake renders inside .ob-doc).
    if (response && !response.ok()) {
      throw new Error(`onboarding-render returned ${response.status()} — token rejected?`);
    }
    const hasDoc = await page.$('.ob-doc');
    if (!hasDoc) {
      throw new Error('onboarding-render did not render the intake document — token rejected?');
    }
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
