/**
 * The one sentence every Channels page says at its top while Guesty runs a
 * home: a hold, a booking or a price written in Helm for that home stays in
 * Helm, and Airbnb, VRBO and Booking.com never see it. Until a cutover the
 * OTAs read Guesty, not Helm (the audit, 2026-10-17, appendix 11: the
 * warning used to live only in footnotes after the click).
 *
 * A home where an OTA already imports Helm's export (a cutover underway) is
 * not "never": that OTA reads Helm on its next pull, so it gets its own line.
 *
 * Pure: the pages, the calendar drawer and the tests all import it.
 */
export type GuestyWriteScope =
  | { kind: 'home'; guestyRun: boolean; otaReadsHelm: boolean }
  | { kind: 'fleet'; total: number; unreached: number }
  | { kind: 'unknown' };

export const GUESTY_HOME_SENTENCE =
  'Guesty runs this home. Anything written here stays in Helm and never reaches Airbnb, VRBO or Booking.com.';

export function guestyWritesSentence(scope: GuestyWriteScope): string | null {
  if (scope.kind === 'unknown') {
    return 'Check who runs a home before writing here: on a home Guesty runs, nothing written in Helm reaches Airbnb, VRBO or Booking.com.';
  }
  if (scope.kind === 'home') {
    if (!scope.guestyRun) return null;
    return scope.otaReadsHelm
      ? 'Guesty runs this home. Only an OTA that already imports Helm\'s export sees what is written here; block the dates in Guesty for the rest.'
      : GUESTY_HOME_SENTENCE;
  }
  if (scope.unreached === 0) return null;
  if (scope.unreached >= scope.total) {
    return 'Guesty runs every home here. Anything written in Channels stays in Helm and never reaches Airbnb, VRBO or Booking.com.';
  }
  return `Guesty runs ${scope.unreached} of ${scope.total} homes. Anything written here for them stays in Helm and never reaches Airbnb, VRBO or Booking.com.`;
}
