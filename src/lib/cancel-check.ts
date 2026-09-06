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
 * BOUNDED BY DESIGN: pass only a small pre-filtered set of suspicious
 * codes. Current callers: the ingest cancel-guard (Airbnb/Booking.com
 * reservations with no bank deposit -- those channels always pay, so no
 * deposit is a strong cancel tell) and sync-guesty's stale-row reconciler
 * (rows the list feed stopped returning, hard-capped per run). Never call
 * this over a whole month of reservations -- that's the rate-limit blast
 * radius that blocked the earlier per-reservation cancel-guard.
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

type GuestyResRow = { confirmationCode?: string; status?: string; money?: { hostPayout?: number | string | null } };

/** What Guesty says LIVE about a booking: its status and what the channel paid the host. */
export type LiveCancellation = {
  status: string;
  /**
   * money.hostPayout, the channel's payout to the host. For a CANCELLED
   * Airbnb stay this is what the cancellation policy retained (it equals
   * the PDF's rental income line to the cent). Null when Guesty returned
   * the row without a money block: unknown, which is not zero.
   */
  hostPayout: number | null;
};

/**
 * Live status AND retained payout per code. The cached
 * guesty_reservations.host_payout is written only by the full nightly sync
 * and is therefore the PRE-cancel figure for any booking cancelled since;
 * a decision about money after a cancel must come from this live read or
 * be treated as unknown. The status-only wrapper below keeps the older
 * call shape for callers that need nothing else.
 */
export async function checkLiveGuestyCancellation(codes: string[]): Promise<Map<string, LiveCancellation>> {
  const out = new Map<string, LiveCancellation>();
  const uniq = [...new Set(codes.map(c => (c || '').trim()).filter(Boolean))];
  if (uniq.length === 0) return out;
  // No creds -> can't check. Degrade to "all unknown" (flags nothing).
  if (!process.env.GUESTY_CLIENT_ID || !process.env.GUESTY_CLIENT_SECRET) return out;

  for (const code of uniq) {
    try {
      const page = await guestyGet<{ results?: GuestyResRow[]; data?: GuestyResRow[] }>(
        '/v1/reservations',
        {
          fields: 'status confirmationCode money',
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
      if (match?.status) {
        const hp = match.money?.hostPayout;
        const n = hp === null || hp === undefined || hp === '' ? NaN : Number(hp);
        out.set(code, { status: String(match.status).toLowerCase(), hostPayout: Number.isFinite(n) ? n : null });
      }
    } catch {
      // Rate-limited / auth / network: leave this code unknown. Never throw.
    }
  }
  return out;
}

export async function checkLiveGuestyStatus(codes: string[]): Promise<Map<string, string>> {
  const full = await checkLiveGuestyCancellation(codes);
  return new Map([...full].map(([code, v]) => [code, v.status]));
}
