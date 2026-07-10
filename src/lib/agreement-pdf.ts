import chromium from '@sparticuz/chromium';
import puppeteer, { Browser } from 'puppeteer-core';

/**
 * PDF rendering for guest rental agreements. Same Puppeteer pattern as
 * projection-pdf.ts (US Letter, print media emulation, font wait), but
 * navigates the PUBLIC signing route /agreement/<token> — the token is
 * the credential, so the render works from server actions with no
 * session cookie. Pre-signature the page's print CSS swaps the signing
 * form for blank signature lines; post-signature it renders the typed
 * signatures + Certificate of Completion, so the same render serves
 * both the "signed copy" and "fully executed" emails.
 */
export async function renderAgreementPdf(args: {
  token: string;
  origin: string;
}): Promise<Buffer> {
  const url = `${args.origin}/agreement/${encodeURIComponent(args.token)}`;

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
    // Explicit print emulation — @sparticuz/chromium doesn't reliably use
    // print media for page.pdf() on its own (same workaround as the
    // projection deliverables).
    await page.emulateMediaType('print');

    const pdf = await page.pdf({
      width: '8.5in',
      height: '11in',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    return Buffer.from(pdf);
  } finally {
    if (browser) await browser.close();
  }
}

/** "Rental Agreement - 3 South Street - Emily Hancock.pdf" (filesystem-safe). */
export function agreementPdfFilename(propertyAddress: string, guestName: string): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, '').trim();
  return `Rental Agreement - ${clean(propertyAddress)} - ${clean(guestName)}.pdf`;
}
