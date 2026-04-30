import chromium from '@sparticuz/chromium';
import puppeteer, { Browser } from 'puppeteer-core';

/**
 * Render the HTML statement page to a letter-sized PDF.
 *
 * Puppeteer drives the same /statements/render?id=...&month=... page the
 * dashboard links to, waits for custom fonts (Fraunces, Inter, JetBrains Mono) and
 * network activity to settle, then prints-to-PDF using the @media print
 * block baked into the statement's inline CSS.
 *
 * Environment:
 *   - In Vercel / AWS Lambda, uses @sparticuz/chromium (headless Chromium
 *     binary packaged for Lambda).
 *   - In local dev (CHROME_EXECUTABLE_PATH env var set), uses a local
 *     Chrome install instead.
 */
export async function renderStatementPdf(args: {
  statementId: string;
  month: string;
  origin: string;  // e.g. "https://rising-tide-str-i38g.vercel.app"
}): Promise<Buffer> {
  const { statementId, month, origin } = args;
  const url = `${origin}/statements/render?id=${encodeURIComponent(statementId)}&month=${encodeURIComponent(month)}`;

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

    // If Vercel Deployment Protection is enabled, Puppeteer would get
    // redirected to Vercel's login page before the statement can render.
    // The bypass token skips that gate for this request only (still
    // requires our own app-level access code to view the dashboard,
    // which the statement route doesn't gate).
    const bypass = process.env.VERCEL_PROTECTION_BYPASS;
    if (bypass) {
      await page.setExtraHTTPHeaders({
        'x-vercel-protection-bypass': bypass,
        'x-vercel-set-bypass-cookie': 'true',
      });
    }

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30_000 });

    // Wait for Google Fonts + any late-loading assets. document.fonts.ready
    // resolves once all @font-face rules have loaded (or timed out).
    await page.evaluate(() => (document as Document & { fonts: { ready: Promise<void> } }).fonts.ready);

    const pdf = await page.pdf({
      format: 'letter',
      printBackground: true,
      preferCSSPageSize: true,  // honor the @page { size:letter; margin:0; } rule
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
      // Statements are designed to be a single editorial page. If dense
      // content (many reservations or cleaning events) pushes anything
      // past page 1, the page-break-inside rules in the statement CSS
      // should prevent that -- but as a hard guarantee we limit output
      // to page 1 here too. See also the @media print rules in
      // statements/render/page.tsx that compact tables / hero spacing.
      pageRanges: '1',
    });

    return Buffer.from(pdf);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/** "21 Horton · April 2026 Statement.pdf" -- filesystem-safe, readable. */
export function statementPdfFilename(propertyShort: string, month: string): string {
  const d = new Date(month + '-01T00:00:00Z');
  const monthYear = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const safe = `${propertyShort} - ${monthYear} Statement.pdf`;
  return safe.replace(/[\\/:*?"<>|]/g, '').trim();
}
