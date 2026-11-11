import chromium from '@sparticuz/chromium';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { MIN_FIT_SCALE, PAGE_HEIGHT_PX, PAGE_WIDTH_PX, nextFitScale } from './pdf-fit.ts';

/**
 * The Tuesday brief's PDF. Chromium prints the HTML string from
 * weekly-brief-html.ts directly (page.setContent), so there is no render
 * route to guard: the document never has a URL.
 *
 * Every `.sheet` is one page. A sheet that runs long is laid out wider and
 * zoomed back down until it fits (the statement's method, pdf.ts: zoom, not
 * transform, because zoom is what pagination sees). Past MIN_FIT_SCALE it is
 * left at that size and runs onto a second page: unlike an owner statement,
 * a long home page is better printed whole on two sheets than refused.
 */
async function fitSheet(page: Page, index: number): Promise<{ scale: number; height: number }> {
  const measure = (s: number) =>
    page.evaluate(
      (scale: number, pageWidth: number, which: number) => {
        const sheet = document.querySelectorAll('.sheet')[which] as HTMLElement | undefined;
        if (!sheet) return -1;
        if (scale === 1) {
          sheet.style.removeProperty('width');
          sheet.style.removeProperty('zoom');
        } else {
          sheet.style.width = `${pageWidth / scale}px`;
          sheet.style.zoom = String(scale);
        }
        return Math.ceil(sheet.getBoundingClientRect().height);
      },
      s,
      PAGE_WIDTH_PX,
      index,
    );
  let scale = 1;
  let height = await measure(scale);
  for (let pass = 0; pass < 4 && height > PAGE_HEIGHT_PX; pass += 1) {
    const next = Math.max(MIN_FIT_SCALE, nextFitScale(scale, height));
    if (next >= scale) break;
    scale = next;
    height = await measure(scale);
  }
  return { scale, height };
}

export async function renderWeeklyBriefPdf(html: string): Promise<{ pdf: Buffer; overflowed: number }> {
  const localChrome = process.env.CHROME_EXECUTABLE_PATH;
  const executablePath = localChrome || (await chromium.executablePath());
  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      args: localChrome ? ['--no-sandbox'] : chromium.args,
      defaultViewport: { width: PAGE_WIDTH_PX, height: PAGE_HEIGHT_PX, deviceScaleFactor: 2 },
      executablePath,
      headless: true,
    });
    const page = await browser.newPage();
    // 'load' waits for the font stylesheet; fonts.ready below waits for the faces.
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    await page.evaluate(() => (document as Document & { fonts: { ready: Promise<void> } }).fonts.ready);
    await page.emulateMediaType('print');
    const sheets = await page.evaluate(() => document.querySelectorAll('.sheet').length);
    if (sheets < 1) throw new Error('The weekly brief rendered no pages.');
    let overflowed = 0;
    for (let i = 0; i < sheets; i += 1) {
      const { height } = await fitSheet(page, i);
      if (height > PAGE_HEIGHT_PX) overflowed += 1;
    }
    const pdf = await page.pdf({
      format: 'letter',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
    return { pdf: Buffer.from(pdf), overflowed };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
