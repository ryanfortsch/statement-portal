/**
 * Shared per-reservation revenue math.
 *
 * Lifted out of /api/ingest, /api/refresh-statement, and /api/fill-gap where
 * the same three helpers were duplicated. /api/ingest-guesty-monthly imports
 * from here directly; the older routes still carry copies, which can be
 * migrated in a separate cleanup pass.
 *
 *   calcStripeFee              -- Stripe's "3.9% + $0.40" on the processed amount.
 *   stripLegacyCommissionKludge -- removes the pre-overhaul 4.4% gross-up from
 *                                  Guesty's CHANNEL COMMISSION column.
 *   normalizePlatform          -- folds the various spellings ("airbnb2",
 *                                  "homeaway", "bookingCom") to canonical names.
 */

/** Stripe charges 3.9% + $0.40 per successful card charge. The base is the
 *  full TOTAL_PAID from the Guesty reservations CSV (gross of taxes/fees).
 *  Airbnb / Booking.com process payment themselves, so this fee never
 *  applies to those channels on our side. */
export function calcStripeFee(processedAmount: number): number {
  return Math.round((processedAmount * 0.039 + 0.40) * 100) / 100;
}

/**
 * Strip the legacy 4.4% gross-up kludge that used to sit in the CHANNEL
 * COMMISSION column of the Guesty reservations report. Pre-overhaul, a 4.4%
 * fee was added so the PDF would approximate the post-Stripe owner net.
 * Newer reservations have it removed at the source, but older rows still
 * carry the inflated value; this function detects and removes it.
 *
 *   Manual:        real commission = 0. Anything above 2% of (TOTAL_PAID -
 *                  TAXES) is the kludge -> treat as 0.
 *   VRBO/HomeAway: real commission = 5%. Above 7% means the kludge stacks
 *                  on top -> recompute as 5% of (TOTAL_PAID - TAXES).
 *   Other:         pass through (channel handles commission itself).
 *
 * Returns the cleaned commission and a flag the caller can use to surface
 * the adjustment in an audit trail.
 */
export function stripLegacyCommissionKludge(args: {
  platform: string;
  totalPaid: number;
  totalTaxes: number;
  commission: number;
}): { effective: number; hadKludge: boolean } {
  const { platform, totalPaid, totalTaxes, commission } = args;
  if (!commission || commission <= 0) return { effective: 0, hadKludge: false };
  const base = Math.max(totalPaid - totalTaxes, 0);
  if (base <= 0) return { effective: commission, hadKludge: false };
  const ratio = commission / base;
  const p = platform.toUpperCase();
  if (p === 'MANUAL') {
    if (ratio > 0.02) return { effective: 0, hadKludge: true };
    return { effective: commission, hadKludge: false };
  }
  if (p.includes('HOMEAWAY') || p === 'VRBO') {
    if (ratio > 0.07) {
      const cleaned = Math.round(base * 0.05 * 100) / 100;
      return { effective: cleaned, hadKludge: true };
    }
    return { effective: commission, hadKludge: false };
  }
  return { effective: commission, hadKludge: false };
}

/** Fold the various spellings of channel names ("airbnb2", "homeaway",
 *  "bookingCom", "Direct", "Manual") down to one of the canonical labels
 *  the rest of the app expects: "Airbnb" | "HomeAway" | "Booking.com" |
 *  "Manual". Returns null for empty / unknown so the caller can decide. */
export function normalizePlatform(raw?: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  const l = s.toLowerCase();
  if (l.startsWith('airbnb')) return 'Airbnb';
  if (l.startsWith('homeaway') || l === 'vrbo') return 'HomeAway';
  if (l === 'bookingcom' || l.startsWith('booking')) return 'Booking.com';
  if (l === 'direct' || l === 'manual') return 'Manual';
  if (l === 'unknown') return null;
  return s;
}
