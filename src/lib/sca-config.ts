/**
 * Stay Cape Ann launch — shared constants.
 *
 * Single source of truth for the cross-repo coordinates and the per-property
 * Stripe wiring contract, so the GitHub client, the server actions, and the
 * guided UI all agree. Nothing here is secret (the GitHub token and Stripe keys
 * live only in env / Vercel, never in code or the DB).
 */

/** GitHub repo that backs staycapeann.com. Confirmed from its .git/config. */
export const SCA_REPO_OWNER = 'ryanfortsch';
export const SCA_REPO_NAME = 'stay-cape-ann';
/** Branch Vercel treats as production. */
export const SCA_PROD_BRANCH = 'main';
/** The registry file we add a listing entry to. */
export const SCA_REGISTRY_PATH = 'data/ical-urls.json';

/**
 * The GitHub Actions workflow that refreshes the committed Guesty snapshot
 * (data/guesty-snapshot.json) on the SCA side. /stays/[id] is pre-rendered from
 * that snapshot, so a freshly-merged listing 404s until this runs. go-live
 * dispatches it (workflow_dispatch) so the page never waits on the nightly cron.
 */
export const SCA_SNAPSHOT_WORKFLOW = 'refresh-snapshot.yml';

/** Public site origin (used for the live URL + the secret-free payment probe). */
export const SCA_SITE_ORIGIN = 'https://www.staycapeann.com';

/**
 * Commit identity. Vercel's GitHub integration refuses to build commits whose
 * author email doesn't resolve to a known GitHub login — a synthetic bot author
 * lands as an instant ERROR with zero build events (learned the hard way in the
 * SCA repo on 2026-04-23). Every commit Helm makes to this repo MUST use this
 * real identity.
 */
export const SCA_COMMIT_AUTHOR = {
  name: 'Dotti Maguire',
  email: 'dotti@risingtidestr.com',
} as const;

/**
 * Stripe events the per-property webhook must subscribe to. Mirrors what
 * stay-cape-ann's /api/webhooks/stripe/[accountKey] handler acts on (booking
 * confirmation, refund auto-cancel, dispute auto-cancel).
 */
export const SCA_STRIPE_WEBHOOK_EVENTS: ReadonlyArray<string> = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.closed',
];

/**
 * The three Vercel env vars a property's standalone Stripe account needs on the
 * SCA project, keyed by the property's stripeAccountKey (e.g. 36_GRANITE).
 * stay-cape-ann's lib/stripeAccounts.ts resolves keys via exactly these names.
 */
export function scaStripeEnvVarNames(accountKey: string): {
  publishable: string;
  secret: string;
  webhookSecret: string;
} {
  return {
    publishable: `STRIPE_PUBLISHABLE_KEY_${accountKey}`,
    secret: `STRIPE_SECRET_KEY_${accountKey}`,
    webhookSecret: `STRIPE_WEBHOOK_SECRET_${accountKey}`,
  };
}

/** The webhook endpoint the operator registers in the property's Stripe account. */
export function scaStripeWebhookUrl(accountKey: string): string {
  return `${SCA_SITE_ORIGIN}/api/webhooks/stripe/${accountKey}`;
}

/** Public listing URL once live. */
export function scaListingUrl(guestyListingId: string): string {
  return `${SCA_SITE_ORIGIN}/stays/${guestyListingId}`;
}

/**
 * The booking page for a listing. Fetching this server-rendered HTML is how we
 * verify payment wiring without ever seeing a secret: an un-wired listing
 * renders the SCA "demo mode" sentinel; a wired one renders the card field.
 */
export function scaBookProbeUrl(guestyListingId: string): string {
  // Plausible future dates so the form renders; the exact range is irrelevant
  // to the publishable-key presence check.
  const q = new URLSearchParams({
    listingId: guestyListingId,
    checkIn: '2099-01-10',
    checkOut: '2099-01-13',
    guests: '2',
  });
  return `${SCA_SITE_ORIGIN}/book?${q.toString()}`;
}

/**
 * The exact string stay-cape-ann's BookingForm renders when no publishable key
 * is configured for the listing. Presence => NOT wired.
 */
export const SCA_DEMO_MODE_SENTINEL = 'Payment processing is in demo mode';
