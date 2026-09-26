/**
 * Which nights of a range a property's occupancy may be measured over.
 *
 * Occupancy is booked nights over nights that COULD have been booked, so the
 * denominator must not contain nights nobody could have sold. Two things push
 * the start later than the range itself:
 *
 *   activatedAt   the home was not on the program yet. Explicit, and wins.
 *   dataHorizon   Helm holds no records at all before this date, for anyone.
 *                 `activated_at` is null on 18 of 20 active homes, so it
 *                 cannot answer this on its own, and without the horizon
 *                 those nights read as nights the fleet failed to sell.
 *
 * Full Year 2026 is the case that prompted it. Helm's earliest reservation
 * starts 2026-03-02, so January and February put 1,121 nights into the
 * denominator with nothing possible on top. The page marked the fleet down
 * for two months it had never measured, showing 31% where the months it does
 * cover run about 34%.
 *
 * THE HORIZON IS FLEET-WIDE ON PURPOSE, not per property. A home whose first
 * booking happens to fall in July was still available in June, and starting
 * its denominator at its own first booking would flatter it toward 100%. The
 * honest claim is the narrower one: do not measure a period Helm has no
 * record of at all.
 *
 * Pure. No I/O, no imports. Unit-tested in
 * src/lib/__tests__/occupancy-window.test.ts.
 */

/**
 * The first night of `rangeStart`'s range this property is measured over.
 * Returns `rangeStart` unchanged when neither constraint applies, so a caller
 * with no horizon behaves exactly as it did before one existed.
 */
export function effectiveStart(
  rangeStart: string,
  activatedAt: string | null,
  dataHorizon?: string | null,
): string {
  let start = rangeStart;
  if (dataHorizon && dataHorizon > start) start = dataHorizon;
  if (activatedAt) {
    // Stored as a timestamp; only the day matters here.
    const day = new Date(activatedAt).toISOString().split('T')[0];
    if (day > start) start = day;
  }
  return start;
}
