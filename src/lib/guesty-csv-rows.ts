import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Writing CSV-derived rows into `guesty_reservations` without minting twins.
 *
 * THE MECHANISM. Both CSV paths build rows whose `guesty_reservation_id` is
 * `csv:<confirmation_code>`, and the upsert conflicts on that id. For a
 * booking Guesty's own API already supplied, the ids differ, so the upsert
 * does not update the existing row -- it INSERTS a second one. Two rows, one
 * booking, and the twin is the one carrying no collected amount. Two places
 * read this table by confirmation code with no tie-break, so whichever row
 * comes back last wins; when the twin wins, the stay drops onto the fallback
 * pricing path CLAUDE.md calls "not the primary rule" and half the
 * cancellation guard goes quiet.
 *
 * The day-two audit found 26 of these live across May and June.
 *
 * WHY THIS IS SHARED. /api/ingest and /api/fill-gap each had their own answer,
 * which is the shape of defect the audit kept finding: the count tracked the
 * number of decision points, not their difficulty. Ingest's copy had a guard
 * that could fail open three ways -- it discarded the read error, so a failed
 * lookup read as "no API rows exist" and minted every twin; it matched on
 * `source = 'guesty-api'`, missing any authoritative row stamped differently
 * or not at all; and it sent every code in one `.in()`. Fill-gap had no guard.
 * One function now, and neither route decides this for itself.
 */

/** The id prefix that marks a row as CSV-derived rather than API-sourced. */
export const CSV_ID_PREFIX = 'csv:';

export type CsvUpsertResult = {
  /** Rows actually written. */
  written: number;
  /** Rows dropped because the API already has that booking. */
  suppressed: number;
  /** True when the existence check failed and nothing was written. */
  skipped: boolean;
};

/**
 * Upsert CSV-derived reservation rows, skipping any booking the Guesty API
 * has already supplied.
 *
 * The discriminator is the stored row's id prefix, not its `source` column:
 * the id is the upsert's conflict key, so it is the thing that actually
 * decides whether a write updates or inserts.
 *
 * On a failed existence read this writes NOTHING and reports `skipped`.
 * Absence of an answer is not "no API rows exist" -- treating it as such is
 * how the twins arrive. The cost of skipping is that this CSV's future stays
 * miss the upcoming-bookings panel until the next sync, which is far cheaper
 * than corrupting the row two money paths read by code.
 */
export async function upsertCsvReservations(
  supabase: SupabaseClient,
  rows: Record<string, string | number | null>[],
  logPrefix: string,
): Promise<CsvUpsertResult> {
  if (rows.length === 0) return { written: 0, suppressed: 0, skipped: false };

  const codes = [
    ...new Set(
      rows.map((r) => (r.confirmation_code == null ? '' : String(r.confirmation_code))).filter(Boolean),
    ),
  ];

  const apiSourced = new Set<string>();
  // Chunked: a fleet-wide CSV can carry hundreds of codes, and one `.in()`
  // list that long overruns the request URL.
  for (let i = 0; i < codes.length; i += 100) {
    const { data, error } = await supabase
      .from('guesty_reservations')
      .select('confirmation_code, guesty_reservation_id')
      .in('confirmation_code', codes.slice(i, i + 100));
    if (error) {
      console.error(
        `${logPrefix} could not check for existing Guesty rows (${error.message}); ` +
          'wrote nothing rather than risk minting duplicate reservation rows',
      );
      return { written: 0, suppressed: 0, skipped: true };
    }
    for (const row of data || []) {
      const id = row.guesty_reservation_id == null ? '' : String(row.guesty_reservation_id);
      if (row.confirmation_code && !id.startsWith(CSV_ID_PREFIX)) {
        apiSourced.add(String(row.confirmation_code));
      }
    }
  }

  const toWrite = rows.filter(
    (r) => !apiSourced.has(r.confirmation_code == null ? '' : String(r.confirmation_code)),
  );
  const suppressed = rows.length - toWrite.length;
  if (suppressed > 0) {
    console.warn(
      `${logPrefix} ${suppressed} CSV row(s) already have an API-sourced Guesty row; ` +
        'left the authoritative row alone instead of minting a twin',
    );
  }

  if (toWrite.length > 0) {
    const { error } = await supabase
      .from('guesty_reservations')
      .upsert(toWrite, { onConflict: 'guesty_reservation_id' });
    if (error) {
      console.error(`${logPrefix} guesty_reservations upsert failed: ${error.message}`);
      return { written: 0, suppressed, skipped: true };
    }
  }

  return { written: toWrite.length, suppressed, skipped: false };
}
