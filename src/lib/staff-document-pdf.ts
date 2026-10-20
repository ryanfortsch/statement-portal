import chromium from '@sparticuz/chromium';
import puppeteer, { Browser } from 'puppeteer-core';

/**
 * PDF of a staff document. Same Puppeteer pattern as agreement-pdf.ts:
 * US Letter, print media, font wait, navigating the PUBLIC signing page
 * /sign/<token>, where the token is the credential, so the render works
 * from a server action with no session. Before the signature the print CSS
 * shows blank signature lines; after it, the typed signatures and the
 * certificate, so one render serves the signed copy and the executed one.
 */
export async function renderStaffDocumentPdf(args: { token: string; origin: string }): Promise<Buffer> {
  const url = `${args.origin}/sign/${encodeURIComponent(args.token)}`;
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
      width: '8.5in',
      height: '11in',
      printBackground: true,
      margin: { top: '0.75in', right: '0.85in', bottom: '0.75in', left: '0.85in' },
    });
    return Buffer.from(pdf);
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * The PDF through /api/staff-document-pdf, which carries the 60-second
 * nodejs budget a Chromium render needs. Server actions call this rather
 * than rendering inline (same reason as fetchAgreementPdf).
 */
export async function fetchStaffDocumentPdf(args: { id: string; token: string; origin: string }): Promise<Buffer> {
  const url = `${args.origin}/api/staff-document-pdf?id=${encodeURIComponent(args.id)}&token=${encodeURIComponent(args.token)}`;
  const headers: Record<string, string> = {};
  const bypass = process.env.VERCEL_PROTECTION_BYPASS;
  if (bypass) {
    headers['x-vercel-protection-bypass'] = bypass;
    headers['x-vercel-set-bypass-cookie'] = 'true';
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`staff-document-pdf fetch ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
