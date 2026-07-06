import { guestyGet } from '@/lib/guesty';

/**
 * Live Guesty cancellation check.
 *
 * Hits the Guesty API DIRECTLY, never the guesty_reservations cache -- the
 * cache is unreliable for cancels (it froze a cancelled booking at
 * "confirmed" because it synced BEFORE the cancel, and sync-guesty's
 * status-refresh is a no-op; see the cancelled-reservation-leak). So the
 * only trustworthy signal is the live API.
 *
 * BOUNDED BY DESIGN: pass only the handful of already-suspicious codes
 * (Airbnb/Booking.com reservations with no bank deposit -- those channels
 * always pay, so no deposit is a strong cancel tell). Never call this over
 * a whole month of reservations -- that's the rate-limit blast radius that
 * blocked the earlier per-reservation cancel-guard.
 *
 * Detection is a PER-CODE confirmationCode `$eq` filter, verified live on
 * this account to return canceled rows. A status-VALUE filter, by contrast,
 * 400s ("Filters are invalid") and ignoreStatusFilter alone is a no-op --
 * see memory guesty-sync-pagination-debt. Filtering by confirmationCode
 * returns the reservation regardless of status.
 *
 * NEVER throws: any Guesty error (429 after retries, auth, network) leaves
 * that code out of the map (treated as unknown -> do NOT flag a cancel), so
 * it can't break an ingest.
 */

/** Guesty returns "canceled" (US, single l) on the API; "cancelled" shows up
 *  elsewhere in the pipeline. Accept both so a spelling never hides a cancel. */
export function isCancelledStatus(status: string | undefined | null): boolean {
  const s = (status || '').toLowerCase();
  return s === 'canceled' || s === 'cancelled';
}

type GuestyResRow = { confirmationCode?: string; status?: string };

export async function checkLiveGuestyStatus(codes: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(codes.map(c => (c || '').trim()).filter(Boolean))];
  if (uniq.length === 0) return out;
  // No creds -> can't check. Degrade to "all unknown" (flags nothing).
  if (!process.env.GUESTY_CLIENT_ID || !process.env.GUESTY_CLIENT_SECRET) return out;

  for (const code of uniq) {
    try {
      const page = await guestyGet<{ results?: GuestyResRow[]; data?: GuestyResRow[] }>(
        '/v1/reservations',
        {
          fields: 'status confirmationCode',
          limit: 3,
          // Surfaces canceled rows (they're hidden by the default status
          // filter). Redundant with the code filter on this account but
          // harmless and matches the verified working query.
          ignoreStatusFilter: 'true',
          filters: JSON.stringify([{ field: 'confirmationCode', operator: '$eq', value: code }]),
        },
      );
      const rows = page.results ?? page.data ?? [];
      const match = rows.find(r => r?.confirmationCode === code) ?? rows[0];
      if (match?.status) out.set(code, String(match.status).toLowerCase());
    } catch {
      // Rate-limited / auth / network: leave this code unknown. Never throw.
    }
  }
  return out;
}
