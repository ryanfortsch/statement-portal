/**
 * Fitting a statement onto its one page.
 *
 * Pure. No I/O, no imports. Unit-tested in src/lib/__tests__/pdf-fit.test.ts.
 * The browser half lives in src/lib/pdf.ts, which measures the rendered sheet
 * and applies what this module decides.
 *
 * The statement is a single editorial page, and until this existed the only
 * thing enforcing that was `pageRanges: '1'` on the Puppeteer print call. That
 * does not fit anything: content past 11 inches was discarded. The browser
 * preview showed a complete statement and the owner received a truncated one,
 * with nothing to say so.
 */

/** Letter at 96dpi. Matches the @page rule and the sheet's own geometry. */
export const PAGE_WIDTH_PX = 816;
export const PAGE_HEIGHT_PX = 1056;

/**
 * The furthest we will shrink a statement to keep it on one page. At 0.62 the
 * sheet carries roughly 1.6 pages of content and body type lands near 7pt,
 * which is the edge of readable on paper. Past that we refuse rather than ship
 * an owner something they have to squint at.
 *
 * Real statements sit at or just over one page, so this is a backstop, not a
 * working range: a month heavy enough to reach it is a month worth looking at
 * by hand.
 */
export const MIN_FIT_SCALE = 0.62;

/**
 * The next zoom to try, given what the sheet measured at the current one.
 *
 * Solving exactly (page / measured) lands a hair over and then converges by
 * halves; measured against a 1.4-page sheet that took four browser round
 * trips. Undershooting by 1.5% costs a sliver of type size and gets there in
 * one, because reflowing at the wider canvas only ever shortens the sheet.
 */
export function nextFitScale(currentScale: number, measuredHeight: number): number {
  if (measuredHeight <= 0) return currentScale;
  return currentScale * (PAGE_HEIGHT_PX / measuredHeight) * 0.985;
}

/**
 * What to tell the operator when a statement cannot be made to fit. Names the
 * size of the problem rather than just refusing, and says plainly that nothing
 * was sent.
 */
export function tooTallMessage(measuredHeight: number): string {
  return (
    `This statement is ${Math.round((measuredHeight / PAGE_HEIGHT_PX) * 100)}% of a page and will not fit on ` +
    `one without shrinking past the ${Math.round(MIN_FIT_SCALE * 100)}% floor where it stops being readable. ` +
    `Nothing was sent. Trim the month, or raise MIN_FIT_SCALE deliberately.`
  );
}
