/**
 * Launch readiness: the money-critical fields a live home must have before
 * its first statement, and the work slip that names the ones it lacks.
 *
 * 4 Middle (listed 2026-08-27, first stay 2026-09-05) reached mid-September
 * with no external title, no tax certificate and no activation date while
 * every Helm screen looked normal. The concierge's fleet watch catches a
 * missing knowledge base and a missing Stripe key on its side; this is the
 * Helm side of the same watch. Pure functions here, the sweep in
 * /api/cron/launch-readiness (nightly, and after each concierge fleet
 * pass). Dotti, 2026-09-19: "things like this are flagged proactively."
 */

export type ReadinessSource = {
  id: string;
  name: string | null;
  title: string | null;
  tax_cert_id: string | null;
  bank_last4: string | null;
  management_fee_pct: number | string | null;
  owner_emails: string[] | null;
  activated_at: string | null;
  created_at: string | null;
  is_active: boolean | null;
  is_rising_tide_owned: boolean | null;
};

export type ReadinessGapKey =
  | 'title'
  | 'tax_cert'
  | 'bank_last4'
  | 'fee'
  | 'owner_email'
  | 'stripe_key'
  | 'activated_at';

export type ReadinessGap = { key: ReadinessGapKey; label: string; fix: string };

export type ReadinessOptions = {
  /** getStripeKeysMap() resolves a restricted key for this property id. */
  stripeKeyed: boolean;
  /** The forecast's hardcoded roster already knows this home's start month,
   *  so a null activated_at is harmless there (pre-registry homes). */
  knownStart: boolean;
};

export type StayCounts = { upcoming: number; recent: number };

export const STRIPE_PERMISSIONS =
  'Charges Read, Checkout Sessions Read, Balance Read, Payment Links Write, Products Write, Prices Write';

/** Homes whose activated_at matters: created in the registry era. Older
 *  homes carry null on purpose and the forecast reads their start from the
 *  hardcoded roster instead. */
export const REGISTRY_ERA_FROM = '2026-01-01';

const blank = (v: string | null | undefined) => !v || !String(v).trim();

/** A home that is earning: bookings ahead of it, or a stay in the recent
 *  window. Rising Tide's own homes never get statements and are skipped. */
export function isLive(p: ReadinessSource, stays: StayCounts): boolean {
  if (!p.is_active || p.is_rising_tide_owned) return false;
  return stays.upcoming > 0 || stays.recent > 0;
}

export function readinessGaps(p: ReadinessSource, opts: ReadinessOptions): ReadinessGap[] {
  const gaps: ReadinessGap[] = [];
  const edit = `/properties/${p.id}/edit`;
  if (blank(p.title)) {
    gaps.push({
      key: 'title',
      label: 'External listing title',
      fix: `the Airbnb / Stay Cape Ann name ("Stay at ..."); set it on ${edit}`,
    });
  }
  if (blank(p.tax_cert_id)) {
    gaps.push({
      key: 'tax_cert',
      label: 'MA room occupancy certificate id',
      fix: `the Remittance modal on Statements reads it; enter it in the tax certificate editor on /properties/${p.id}`,
    });
  }
  if (blank(p.bank_last4)) {
    gaps.push({
      key: 'bank_last4',
      label: 'Chase account last four',
      fix: `identifies this home's bank CSV at ingest and matches deposits; set it on ${edit}`,
    });
  }
  const fee = Number(p.management_fee_pct);
  if (!Number.isFinite(fee) || fee <= 0) {
    gaps.push({
      key: 'fee',
      label: 'Management fee percent',
      fix: `the statement cannot compute the payout without it; set it on ${edit}`,
    });
  }
  if (!Array.isArray(p.owner_emails) || p.owner_emails.filter((e) => !blank(e)).length === 0) {
    gaps.push({
      key: 'owner_email',
      label: 'Owner email',
      fix: `the statement email has no recipient; add the owner on /properties/${p.id}`,
    });
  }
  if (!opts.stripeKeyed) {
    gaps.push({
      key: 'stripe_key',
      label: `Stripe key (STRIPE_KEY_${p.id.toUpperCase()})`,
      fix:
        `add-on payment links fail and direct-booking charges are invisible to statements without it. In the ` +
        `home's own Stripe: Developers > API keys > Create restricted key named Helm with exactly six ` +
        `permissions (${STRIPE_PERMISSIONS}); in Vercel (rising-tide-statements) add ` +
        `STRIPE_KEY_${p.id.toUpperCase()} = the bare rk_live key, then redeploy. Never the sk_ key`,
    });
  }
  const registryEra = !!p.created_at && p.created_at.slice(0, 10) >= REGISTRY_ERA_FROM;
  if (blank(p.activated_at) && registryEra && !opts.knownStart) {
    gaps.push({
      key: 'activated_at',
      label: 'Activation date',
      fix: `the forecast roster treats a missing start as January and bills a full year of cost; set it on ${edit}`,
    });
  }
  return gaps;
}

export function readinessRequestKey(propertyId: string): string {
  return `readiness:${propertyId}`;
}

/** The action summary carries the gap keys so a later pass can tell a
 *  changed ask from the same one: "Missing: title, tax_cert". */
export function actionSummaryFor(gaps: ReadonlyArray<ReadinessGap>): string {
  return `Missing: ${gaps.map((g) => g.key).join(', ')}`;
}

export function gapKeysFromActionSummary(summary: string | null | undefined): Set<string> {
  const m = /^\s*Missing:\s*(.*)$/i.exec(summary ?? '');
  if (!m) return new Set();
  return new Set(
    m[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function readinessSlip(p: ReadinessSource, gaps: ReadonlyArray<ReadinessGap>) {
  const name = (p.name ?? '').trim() || p.id;
  const n = gaps.length;
  const lines = gaps.map((g) => `- ${g.label}: ${g.fix}.`);
  return {
    requestKey: readinessRequestKey(p.id),
    title: `${name}: Launch readiness, ${n} money-critical field${n === 1 ? '' : 's'} missing`,
    actionSummary: actionSummaryFor(gaps),
    description:
      `${name} is earning (bookings on the calendar) and its first statement needs fields Helm does not have:\n` +
      `${lines.join('\n')}\n\n` +
      `Opened by the launch-readiness sweep (nightly, and after each concierge fleet pass). It updates as ` +
      `fields change and closes itself once everything is present.`,
  };
}
