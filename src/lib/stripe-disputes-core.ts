/**
 * The rules behind the dispute list and the daily dispute to-do
 * (`/payments/disputes`, `/api/cron/stripe-disputes`), kept pure so they are
 * tested without Stripe or the database.
 *
 * Every dispute we lost before 2026-11 was answered late or answered with the
 * wrong evidence. So a dispute that needs a response becomes an office to-do
 * for whoever holds the `disputes` duty, due the day Stripe stops taking
 * evidence, with the packet one click away. The to-do is keyed by a tag, so a
 * second run never files a second one, and it closes itself once Stripe no
 * longer waits on us. Helm never submits evidence; a person does, in Stripe.
 */

export type DisputeListing = {
  propertyId: string;
  disputeId: string;
  chargeId: string;
  amountCents: number;
  reason: string | null;
  status: string | null;
  /** YYYY-MM-DD, UTC: the last day Stripe takes evidence. */
  dueBy: string | null;
  /** YYYY-MM-DD, UTC. */
  openedOn: string | null;
};

/** Stripe's statuses that wait on us. */
export const NEEDS_RESPONSE_STATUSES = ['needs_response', 'warning_needs_response'] as const;

export function needsResponse(status: string | null | undefined): boolean {
  return (NEEDS_RESPONSE_STATUSES as readonly string[]).includes(status || '');
}

/** Plain words for Stripe's status. */
export function disputeStatusWords(status: string | null | undefined): string {
  switch (status) {
    case 'needs_response':
      return 'Needs our evidence';
    case 'warning_needs_response':
      return 'Inquiry: needs our answer';
    case 'under_review':
      return 'Evidence in, bank reviewing';
    case 'warning_under_review':
      return 'Inquiry under review';
    case 'won':
      return 'Won';
    case 'lost':
      return 'Lost';
    case 'warning_closed':
      return 'Inquiry closed';
    default:
      return status || 'Unknown';
  }
}

export function disputeTaskTag(disputeId: string): string {
  return `stripe-dispute:${disputeId}`;
}

export function disputePacketPath(d: Pick<DisputeListing, 'propertyId' | 'chargeId'>): string {
  return `/payments/disputes/${encodeURIComponent(d.propertyId)}/${encodeURIComponent(d.chargeId)}`;
}

function usd(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** Whole days from `today` to `dueBy` (both YYYY-MM-DD); negative once past. */
export function daysLeft(dueBy: string | null, today: string): number | null {
  if (!dueBy) return null;
  const a = Date.parse(`${today}T12:00:00Z`);
  const b = Date.parse(`${dueBy}T12:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : null;
}

export type DisputeTaskInsert = {
  title: string;
  description: string;
  scope: 'property';
  property_ids: string[];
  priority: 'high';
  due_date: string | null;
  tags: string[];
};

/** The office to-do for one dispute. Names the home, never the guest. */
export function disputeTask(d: DisputeListing, homeName: string, helmOrigin: string): DisputeTaskInsert {
  const reason = (d.reason || 'unknown reason').replace(/_/g, ' ');
  const lines = [
    `A guest's bank disputed ${usd(d.amountCents)} at ${homeName} (${reason}).`,
    d.dueBy
      ? `Stripe takes evidence until ${d.dueBy}. After that the dispute is lost by default.`
      : 'Stripe gave no evidence deadline; check the dispute in Stripe today.',
    `Open the packet, fill the gaps it lists, save it as a PDF and upload it in the dispute in Stripe: ${helmOrigin.replace(/\/$/, '')}${disputePacketPath(d)}`,
    'Answer the reason code the bank gave, not the story. Helm submits nothing.',
  ];
  return {
    title: `Answer the ${usd(d.amountCents)} card dispute at ${homeName}`,
    description: lines.join('\n\n'),
    scope: 'property',
    property_ids: [d.propertyId],
    priority: 'high',
    due_date: d.dueBy,
    tags: [disputeTaskTag(d.disputeId), 'stripe-dispute'],
  };
}

export type ExistingDisputeTask = { id: string; tags: string[] | null; status: string };

const ACTIVE = new Set(['open', 'in_progress', 'blocked']);

/**
 * What the daily run does: file a to-do for each dispute waiting on us that
 * has never had one (in any status, so a to-do someone dismissed is not
 * filed again), and close an active to-do whose dispute Stripe no longer
 * waits on. A to-do whose dispute was not read this run (its account's read
 * failed) is left alone: absence is not a fact.
 */
export function planDisputeTasks(
  disputes: DisputeListing[],
  existing: ExistingDisputeTask[],
): { create: DisputeListing[]; close: string[] } {
  const byTag = new Map<string, ExistingDisputeTask[]>();
  for (const t of existing) {
    for (const tag of t.tags ?? []) {
      if (!tag.startsWith('stripe-dispute:')) continue;
      byTag.set(tag, [...(byTag.get(tag) ?? []), t]);
    }
  }
  const create: DisputeListing[] = [];
  const close: string[] = [];
  const seen = new Set<string>();
  for (const d of disputes) {
    if (seen.has(d.disputeId)) continue;
    seen.add(d.disputeId);
    const tasks = byTag.get(disputeTaskTag(d.disputeId)) ?? [];
    if (needsResponse(d.status)) {
      if (tasks.length === 0) create.push(d);
    } else {
      for (const t of tasks) if (ACTIVE.has(t.status)) close.push(t.id);
    }
  }
  return { create, close };
}

/** Disputes waiting on us first, soonest deadline first; then the rest, newest first. */
export function sortDisputes(list: DisputeListing[]): DisputeListing[] {
  return [...list].sort((a, b) => {
    const na = needsResponse(a.status) ? 0 : 1;
    const nb = needsResponse(b.status) ? 0 : 1;
    if (na !== nb) return na - nb;
    if (na === 0) return (a.dueBy || '9999').localeCompare(b.dueBy || '9999');
    return (b.openedOn || '').localeCompare(a.openedOn || '');
  });
}

/**
 * Whether a home's payment links put the terms checkbox on the payment page.
 * Links try it since 2026-10-20 and drop it silently when the Stripe account
 * has no Terms of service URL set, so the newest link is the evidence.
 */
export type CheckoutTermsState = 'required' | 'refused' | 'no_recent_link' | 'unread';

export function checkoutTermsState(
  link: { consent_collection?: { terms_of_service?: string | null } | null } | null,
  read: 'ok' | 'none' | 'failed',
): CheckoutTermsState {
  if (read === 'none') return 'no_recent_link';
  if (read === 'failed' || !link) return 'unread';
  return link.consent_collection?.terms_of_service === 'required' ? 'required' : 'refused';
}
