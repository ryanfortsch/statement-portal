import chromium from '@sparticuz/chromium';
import puppeteer, { Browser, Page } from 'puppeteer-core';
import {
  MIN_FIT_SCALE,
  PAGE_HEIGHT_PX,
  PAGE_WIDTH_PX,
  nextFitScale,
  tooTallMessage,
} from './pdf-fit';

/**
 * Shrink the statement until it fits on one page, and report what it took.
 *
 * WHY THIS EXISTS. The statement is a single editorial page and page.pdf() is
 * asked for `pageRanges: '1'`. Until this function, that pairing was the whole
 * fitting strategy, and it does not fit anything: content past 11 inches was
 * simply discarded. The browser preview showed a complete statement and the
 * owner received a truncated one, with nothing anywhere saying so. The
 * page-break-inside rules in the statement CSS cannot help; they choose where
 * a break falls, not whether the overflow survives.
 *
 * Statements that already fit are untouched -- scale stays 1, no style is
 * written, and the PDF is byte-identical to before. Only an overflowing month
 * changes, and it changes from truncated to slightly smaller.
 *
 * WHY `zoom` AND NOT `transform: scale()`. A transform is a paint-time effect:
 * layout, and therefore Chrome's pagination, still sees the full-size box, so
 * the content would keep spilling onto a second page that `pageRanges` throws
 * away. `zoom` participates in layout, so the shorter box is the one Chrome
 * paginates. Do not "simplify" this to a transform.
 *
 * Widening as we shrink is deliberate: the sheet is laid out at
 * PAGE_WIDTH_PX / scale so that zooming back down lands it at exactly
 * PAGE_WIDTH_PX, filling the page rather than leaving a gutter. min-height
 * gets the same treatment so a month that reflows short still paints a full
 * sheet instead of a band of white.
 */
async function fitSheetToOnePage(page: Page): Promise<{ scale: number; height: number }> {
  const measure = (s: number) =>
    page.evaluate(
      (scale: number, pageWidth: number, pageHeight: number) => {
        const sheet = document.querySelector('.sheet') as HTMLElement | null;
        if (!sheet) return -1;
        if (scale === 1) {
          sheet.style.removeProperty('width');
          sheet.style.removeProperty('min-height');
          sheet.style.removeProperty('zoom');
        } else {
          sheet.style.width = `${pageWidth / scale}px`;
          sheet.style.minHeight = `${pageHeight / scale}px`;
          sheet.style.zoom = String(scale);
        }
        // getBoundingClientRect reports the zoomed box, which is the one that
        // has to fit the page.
        return Math.ceil(sheet.getBoundingClientRect().height);
      },
      s,
      PAGE_WIDTH_PX,
      PAGE_HEIGHT_PX,
    );

  let scale = 1;
  let height = await measure(scale);

  // No `.sheet` element. Either the statement did not render at all, or the
  // class it hangs on was renamed. Both are worth stopping for: carrying on
  // would quietly restore the truncation this function exists to end, and a
  // renamed class is exactly the kind of change that would sail through
  // review. See src/app/statements/render/page.tsx, <main className="sheet">.
  if (height < 0) {
    throw new Error(
      'The statement page rendered without a .sheet element, so it could not be fitted to one page. ' +
        'Nothing was sent. Check /statements/render for a renamed wrapper class.',
    );
  }

  // Reflowing at a wider canvas changes the height, so one solve can land
  // slightly over. The loop exits the moment it fits.
  for (let pass = 0; pass < 4 && height > PAGE_HEIGHT_PX; pass += 1) {
    const next = nextFitScale(scale, height);
    if (next < MIN_FIT_SCALE) break;
    scale = next;
    height = await measure(scale);
  }

  // Never report a fit we did not achieve. Returning here with the sheet still
  // over the page would hand back a PDF missing its tail, which is the exact
  // failure this function exists to end.
  if (height > PAGE_HEIGHT_PX) throw new Error(tooTallMessage(height));

  return { scale, height };
}

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

    // Measure and fit under PRINT rules, not screen. The statement's @media
    // print block already reclaims padding and type size, so measuring on the
    // screen layout would shrink a statement that print was about to fit on
    // its own.
    await page.emulateMediaType('print');
    await fitSheetToOnePage(page);

    const pdf = await page.pdf({
      format: 'letter',
      printBackground: true,
      preferCSSPageSize: true,  // honor the @page { size:letter; margin:0; } rule
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
      // A backstop, no longer the fitting strategy. fitSheetToOnePage above
      // is what actually makes the content fit; this only guarantees that a
      // stray pixel cannot turn into a second, near-empty page.
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
