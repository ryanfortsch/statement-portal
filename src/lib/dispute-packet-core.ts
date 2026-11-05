/**
 * Pure core of the dispute evidence packet. No imports, no I/O, so the test
 * runner can load it directly.
 *
 * Why this exists (2026-11-05): every dispute we lost, we lost by answering
 * with our own story instead of the question the reason code asks. Eva
 * Madruga's dock fee (Visa 12.6.2, paid by other means) is the clearest: the
 * bank's ruling said our documents never reconciled her $15,500 cashier's
 * check against the folio and never showed the disputed charge was a separate
 * purchase. A written explanation was there; the arithmetic was not.
 *
 * So the packet is shaped by reason code. `disputeKind` reads Stripe's reason
 * and the card network's code; `PLAYBOOK` says what that kind of dispute must
 * prove and which Stripe evidence slot each piece goes in;
 * `reconcileOtherMeans` is the arithmetic for paid-by-other-means and
 * duplicate disputes.
 *
 * Helm never submits evidence to Stripe. The packet is a document a person
 * reads, prints to PDF and uploads in the Stripe dashboard.
 */

export type DisputeKind =
  | 'paid_by_other_means'
  | 'duplicate'
  | 'credit_not_processed'
  | 'not_as_described'
  | 'not_received'
  | 'fraud'
  | 'general';

/**
 * Stripe flattens the networks' codes into its own `reason`. Paid by other
 * means and a true duplicate both arrive as `duplicate`; only the network
 * code tells them apart (Visa 12.6.1 duplicate, 12.6.2 paid by other means).
 * Madruga's dispute was `duplicate` / 12.6.2: the guest never claimed two
 * card charges, she claimed her check already paid for it.
 */
export function disputeKind(reason: string | null | undefined, networkCode: string | null | undefined): DisputeKind {
  const r = (reason || '').toLowerCase();
  const code = (networkCode || '').trim().toUpperCase();
  if (code === '12.6.2') return 'paid_by_other_means';
  if (r === 'duplicate') return 'duplicate';
  if (r === 'credit_not_processed' || r === 'subscription_canceled') return 'credit_not_processed';
  if (r === 'product_unacceptable') return 'not_as_described';
  if (r === 'product_not_received') return 'not_received';
  if (r === 'fraudulent' || r === 'unrecognized') return 'fraud';
  return 'general';
}

/** Stripe's dispute evidence slots a packet section feeds, by API name. */
export type EvidenceSlot =
  | 'product_description'
  | 'customer_communication'
  | 'customer_signature'
  | 'receipt'
  | 'service_documentation'
  | 'service_date'
  | 'duplicate_charge_documentation'
  | 'duplicate_charge_explanation'
  | 'cancellation_policy'
  | 'cancellation_policy_disclosure'
  | 'cancellation_rebuttal'
  | 'refund_policy'
  | 'access_activity_log'
  | 'uncategorized_text';

export type PlaybookItem = {
  key: string;
  /** What the bank needs to see, in a sentence. */
  proves: string;
  /** The dashboard category or text box it belongs in. */
  slot: EvidenceSlot;
};

export type Playbook = {
  kind: DisputeKind;
  /** Plain-English name for the operator. */
  title: string;
  /** The question the cardholder's bank is actually asking. */
  bankAsks: string;
  /** Stripe's "Why should you win?" choice that matches. */
  winningReason: string;
  items: PlaybookItem[];
};

const SEPARATE_PURCHASE: PlaybookItem[] = [
  {
    key: 'reconciliation',
    proves: 'Every other payment from this guest, matched line by line to what it paid for, with nothing left over that this charge could be.',
    slot: 'duplicate_charge_documentation',
  },
  {
    key: 'authorization',
    proves: 'The guest agreed to this specific charge, in their own words, before paying it.',
    slot: 'customer_communication',
  },
  {
    key: 'refunds',
    proves: 'Any refund already made on this charge, what it corrected, and that it was not a promise to refund the rest.',
    slot: 'uncategorized_text',
  },
  {
    key: 'service',
    proves: 'The service this charge paid for was provided, and when.',
    slot: 'service_documentation',
  },
];

export const PLAYBOOK: Record<DisputeKind, Playbook> = {
  paid_by_other_means: {
    kind: 'paid_by_other_means',
    title: 'Paid by other means',
    bankAsks: 'Did the guest already pay for this same thing another way (a check, a wire, the booking site)?',
    winningReason: 'The purchase is unique',
    items: SEPARATE_PURCHASE,
  },
  duplicate: {
    kind: 'duplicate',
    title: 'Duplicate charge',
    bankAsks: 'Was the guest charged twice for one purchase?',
    winningReason: 'The purchase is unique',
    items: SEPARATE_PURCHASE,
  },
  credit_not_processed: {
    kind: 'credit_not_processed',
    title: 'Credit not processed',
    bankAsks: 'Was the guest owed a refund under the terms they accepted, and did we withhold it?',
    winningReason: 'The refund or cancellation request was made after the date allowed by your terms',
    items: [
      { key: 'policy', proves: 'The cancellation policy exactly as the guest saw it when booking.', slot: 'cancellation_policy' },
      { key: 'acceptance', proves: 'The guest accepted that policy: a signed agreement or the booking checkbox.', slot: 'customer_signature' },
      { key: 'timeline', proves: 'The date they cancelled against the policy deadline, in days.', slot: 'cancellation_rebuttal' },
      { key: 'communication', proves: 'What we told the guest when they asked for a refund.', slot: 'customer_communication' },
    ],
  },
  not_as_described: {
    kind: 'not_as_described',
    title: 'Not as described',
    bankAsks: 'Was the stay materially different from what was advertised, and did we refuse to make it right?',
    winningReason: 'The product received was as advertised',
    items: [
      { key: 'listing', proves: 'The listing as advertised at booking: description, photos, amenities.', slot: 'product_description' },
      { key: 'stay', proves: 'The guest arrived and stayed: arrival and departure records, door unlocks.', slot: 'service_documentation' },
      { key: 'communication', proves: 'Every complaint the guest raised during the stay and what we did about it.', slot: 'customer_communication' },
      { key: 'acceptance', proves: 'The agreement and house rules the guest accepted.', slot: 'customer_signature' },
    ],
  },
  not_received: {
    kind: 'not_received',
    title: 'Not received',
    bankAsks: 'Did the guest actually get the stay or service they paid for?',
    winningReason: 'The product or service was provided',
    items: [
      { key: 'stay', proves: 'Arrival and departure records, door unlocks, the check-in message.', slot: 'service_documentation' },
      { key: 'dates', proves: 'The service dates.', slot: 'service_date' },
      { key: 'communication', proves: 'Messages sent and received during the stay.', slot: 'customer_communication' },
    ],
  },
  fraud: {
    kind: 'fraud',
    title: 'Fraudulent or unrecognized',
    bankAsks: 'Did the cardholder make this purchase?',
    winningReason: 'The cardholder made the purchase',
    items: [
      { key: 'identity', proves: 'The card name and email match the booking guest.', slot: 'customer_communication' },
      { key: 'history', proves: 'Earlier payments on the same card that were not disputed.', slot: 'access_activity_log' },
      { key: 'stay', proves: 'The guest stayed: arrival records and door unlocks.', slot: 'service_documentation' },
    ],
  },
  general: {
    kind: 'general',
    title: 'General',
    bankAsks: 'Read the cardholder claim: the bank will judge whatever it says.',
    winningReason: 'Other',
    items: [
      { key: 'communication', proves: 'The guest agreed to the charge.', slot: 'customer_communication' },
      { key: 'service', proves: 'The service was provided.', slot: 'service_documentation' },
    ],
  },
};

// ---------------------------------------------------------------------------
// Reconciliation: paid by other means, duplicate.
// ---------------------------------------------------------------------------

export type FolioLine = {
  label: string;
  cents: number;
};

export type PaymentMethod =
  | 'card'
  | 'check'
  | 'cashiers_check'
  | 'wire'
  | 'ach'
  | 'booking_site'
  | 'cash'
  | 'other';

export type OtherPayment = {
  method: PaymentMethod;
  cents: number;
  /** YYYY-MM-DD. */
  date: string | null;
  /** Check number, wire reference, charge id. */
  reference?: string | null;
};

export type ChargeRefund = {
  cents: number;
  /** YYYY-MM-DD. */
  date: string | null;
  /** The operator's own note on the refund, as written. */
  note?: string | null;
};

export type DisputedCharge = {
  /** What the guest's card was charged. */
  amountCents: number;
  /** What the bank is pulling back. */
  disputedCents: number;
  refunds: ChargeRefund[];
  /** YYYY-MM-DD. */
  chargedOn: string | null;
  /** What it was for, as the guest saw it on the payment page. */
  item: string;
  /** True when Helm minted it as an add-on (a helm_request_key on the charge). */
  isAddOn: boolean;
};

export type ReconcileInput = {
  /** The stay's folio as booked: lodging, cleaning, taxes, fees. */
  folio: FolioLine[];
  /** Every payment for the stay other than the disputed charge. */
  payments: OtherPayment[];
  disputed: DisputedCharge;
};

export type ReconcileRow = {
  label: string;
  cents: number;
  paidBy: string;
};

export type Strength = 'strong' | 'arguable' | 'weak';

export type Reconciliation = {
  folioCents: number;
  otherPaidCents: number;
  /** folio minus other payments: what the stay still owed before this charge. */
  stayOwedCents: number;
  refundedCents: number;
  /** Disputed charge less refunds: what the guest kept paying for it. */
  chargeNetCents: number;
  rows: ReconcileRow[];
  strength: Strength;
  /** Sentences for the bank, in order. Plain, no adjectives. */
  forBank: string[];
  /** What the operator has to fix or add before this can win. */
  gaps: string[];
};

const METHOD_WORD: Record<PaymentMethod, string> = {
  card: 'card payment',
  check: 'check',
  cashiers_check: "cashier's check",
  wire: 'wire transfer',
  ach: 'bank transfer',
  booking_site: 'booking site payout',
  cash: 'cash',
  other: 'payment',
};

export function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

function paymentWords(p: OtherPayment): string {
  const ref = p.reference ? ` ${p.reference}` : '';
  const on = p.date ? ` on ${p.date}` : '';
  return `${METHOD_WORD[p.method]}${ref}${on}`;
}

/** Within a cent: amounts that arrive through different rails round differently. */
const TIE = 1;

/**
 * Lays every payment beside the folio and says, in sentences a bank reads,
 * whether the disputed charge could be a second payment for the same stay.
 *
 * Strong: the other payments cover the folio to the cent and the disputed
 * charge is a separate add-on. Arguable: they cover it but the charge is not
 * marked as an add-on, or they cover it within a small gap we must explain.
 * Weak: the stay still owed money, so the bank will read this charge as the
 * balance; or the guest paid more than the folio plus this charge, in which
 * case a refund may really be owed and the packet says so to the operator.
 */
export function reconcileOtherMeans(input: ReconcileInput): Reconciliation {
  const folioCents = input.folio.reduce((s, l) => s + Math.round(l.cents), 0);
  const otherPaidCents = input.payments.reduce((s, p) => s + Math.round(p.cents), 0);
  const stayOwedCents = folioCents - otherPaidCents;
  const refundedCents = input.disputed.refunds.reduce((s, r) => s + Math.round(r.cents), 0);
  const chargeNetCents = input.disputed.amountCents - refundedCents;

  const otherPaidWords = input.payments.length
    ? input.payments.map(paymentWords).join(', ')
    : 'no other payment';

  const rows: ReconcileRow[] = input.folio.map((l) => ({
    label: l.label,
    cents: Math.round(l.cents),
    paidBy: stayOwedCents <= TIE ? otherPaidWords : 'see balance below',
  }));
  rows.push({
    label: input.disputed.item,
    cents: chargeNetCents,
    paidBy: `the disputed card charge${input.disputed.chargedOn ? ` on ${input.disputed.chargedOn}` : ''}`,
  });

  const forBank: string[] = [];
  const gaps: string[] = [];

  if (!input.folio.length) {
    gaps.push('No folio found for this stay. Without the line items the bank cannot see what the other payment covered.');
  }
  if (!input.payments.length) {
    gaps.push('No other payment recorded for this stay. Record the check or wire the guest is pointing to (amount, date, number) so the packet can match it.');
  }

  let strength: Strength;
  if (input.folio.length && input.payments.length && Math.abs(stayOwedCents) <= TIE) {
    strength = input.disputed.isAddOn ? 'strong' : 'arguable';
    forBank.push(
      `The reservation folio totals ${money(folioCents)}. The guest's ${otherPaidWords} totals ${money(otherPaidCents)}: it paid the folio in full and nothing else.`,
    );
    forBank.push(
      `The disputed charge of ${money(input.disputed.amountCents)} was for ${input.disputed.item}, which is not a line on the folio. It is a separate purchase, not a second payment for the stay.`,
    );
    if (!input.disputed.isAddOn) {
      gaps.push('This charge is not marked as an add-on in Stripe. Show what it paid for (the payment page item and the guest\'s agreement) or the bank may read it as stay principal.');
    }
  } else if (input.folio.length && input.payments.length && stayOwedCents > TIE) {
    strength = 'weak';
    forBank.push(
      `The reservation folio totals ${money(folioCents)}. The guest's ${otherPaidWords} totals ${money(otherPaidCents)}, leaving ${money(stayOwedCents)} of the stay unpaid by those payments.`,
    );
    gaps.push(
      `The other payments fall ${money(stayOwedCents)} short of the folio. The bank will read the disputed charge as the stay's balance unless a payment is missing from this list or the folio is wrong.`,
    );
  } else if (input.folio.length && input.payments.length) {
    const over = -stayOwedCents;
    strength = over > chargeNetCents + TIE ? 'weak' : 'arguable';
    forBank.push(
      `The reservation folio totals ${money(folioCents)}. The guest's ${otherPaidWords} totals ${money(otherPaidCents)}.`,
    );
    gaps.push(
      `The guest paid ${money(over)} more than the folio by other means. Find out what that covered before answering: if it was this same ${input.disputed.item}, a refund is owed and the dispute should be accepted.`,
    );
  } else {
    strength = 'weak';
  }

  if (refundedCents > 0) {
    const notes = input.disputed.refunds
      .map((r) => `${money(r.cents)}${r.date ? ` on ${r.date}` : ''}${r.note ? ` (${r.note.trim()})` : ''}`)
      .join(', ');
    forBank.push(
      `We refunded ${notes} on this charge. That refund corrected the amount charged; it was not a partial payment of a larger refund, and no other refund was promised. The guest kept paying ${money(chargeNetCents)}, which is the amount agreed in writing.`,
    );
    gaps.push(
      'A refund on the disputed charge reads to a bank as a refund we promised and did not finish. Quote the message where the corrected amount was agreed, and confirm no message offered more.',
    );
  }

  if (input.disputed.disputedCents !== chargeNetCents) {
    gaps.push(
      `The bank is disputing ${money(input.disputed.disputedCents)}, but the charge net of refunds is ${money(chargeNetCents)}. Check which amount the claim names.`,
    );
  }

  return { folioCents, otherPaidCents, stayOwedCents, refundedCents, chargeNetCents, rows, strength, forBank, gaps };
}

// ---------------------------------------------------------------------------
// Inputs from Helm's own records.
// ---------------------------------------------------------------------------

type RawFolioItem = { title?: unknown; amount?: unknown; type?: unknown };

/** Guesty's invoice items (guesty_reservations.folio_items) as folio lines,
 *  in cents. Zero lines are dropped; a nameless tax line reads "Tax". */
export function folioLines(raw: unknown): FolioLine[] {
  if (!Array.isArray(raw)) return [];
  const out: FolioLine[] = [];
  for (const item of raw as RawFolioItem[]) {
    const amount = Number(item?.amount);
    if (!Number.isFinite(amount)) continue;
    const cents = Math.round(amount * 100);
    if (cents === 0) continue;
    const title = typeof item?.title === 'string' ? item.title.trim() : '';
    const type = typeof item?.type === 'string' ? item.type : '';
    out.push({ label: title || (type === 'TAX' ? 'Tax' : 'Folio line'), cents });
  }
  return out;
}

const OTHER_METHODS: readonly PaymentMethod[] = ['card', 'check', 'cashiers_check', 'wire', 'ach', 'booking_site', 'cash', 'other'];

/**
 * Other payments typed on the packet page, one per line:
 * `method, amount, YYYY-MM-DD, reference`. Helm records no check or wire,
 * so the person building the packet supplies them. Lines that do not parse
 * are returned as errors, never dropped silently.
 */
export function parseOtherPayments(text: string): { payments: OtherPayment[]; errors: string[] } {
  const payments: OtherPayment[] = [];
  const errors: string[] = [];
  for (const raw of (text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // The amount may carry thousands commas ("$15,500.00"), so the line is
    // read as method, amount, then the rest split on commas.
    const parsed = /^([^,]*),\s*(\$?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[^,]*)(.*)$/.exec(line);
    const m = parsed?.[1].trim() ?? line;
    const amt = parsed?.[2].trim() ?? '';
    const [date, ...rest] = (parsed?.[3] ?? '').replace(/^\s*,/, '').split(',').map((s) => s.trim());
    // "Cashier's check", "cashiers check" and "cashiers_check" are one method.
    const normalized = (m || '').toLowerCase().replace(/['\u2019]/g, '').trim().replace(/\s+/g, '_') as PaymentMethod;
    const dollars = Number((amt || '').replace(/[$,]/g, ''));
    if (!OTHER_METHODS.includes(normalized)) {
      errors.push(`"${line}": method must be one of ${OTHER_METHODS.join(', ')}`);
      continue;
    }
    if (!Number.isFinite(dollars) || dollars <= 0) {
      errors.push(`"${line}": amount is not a number`);
      continue;
    }
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push(`"${line}": date must be YYYY-MM-DD`);
      continue;
    }
    payments.push({ method: normalized, cents: Math.round(dollars * 100), date: date || null, reference: rest.join(',').trim() || null });
  }
  return { payments, errors };
}

export type ThreadLine = { at: string; who: string; body: string };

export type FlaggedLine = ThreadLine & {
  /** Names this charge's item or amount: the guest's written agreement. */
  aboutCharge: boolean;
  /** Mentions a refund: the bank will ask whether we promised one. */
  mentionsRefund: boolean;
};

const STOP = new Set(['fee', 'fees', 'the', 'and', 'for', 'stay', 'at', 'charge', 'tax', 'occupancy']);

/** Words from the item label worth matching ("Boat docking fee - Eva ..."
 *  gives boat, docking, dock). Names and short words are left out. */
export function itemWords(item: string, guestName: string | null = null): string[] {
  const name = new Set((guestName || '').toLowerCase().split(/\s+/).filter(Boolean));
  const head = (item || '').split(/\s[-(]\s?|\s-\s/)[0];
  const words = new Set<string>();
  for (const w of head.toLowerCase().match(/[a-z]{3,}/g) || []) {
    if (STOP.has(w) || name.has(w)) continue;
    words.add(w);
    if (w.endsWith('ing') && w.length > 5) words.add(w.slice(0, -3));
  }
  return [...words];
}

/** The amounts as a guest would type them: 726.05, 726, 811. */
function amountTokens(cents: number[]): string[] {
  const out = new Set<string>();
  for (const c of cents) {
    if (!c) continue;
    const d = Math.abs(c) / 100;
    out.add(d.toFixed(2));
    out.add(d.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    out.add(String(Math.round(d)));
  }
  return [...out].filter((t) => t.length >= 2);
}

/**
 * Marks the messages a bank needs to see: where the guest agreed to this
 * charge (its item words or amount) and every mention of a refund, so the
 * person building the packet can quote the first and confirm the second
 * never promised more than was refunded.
 */
export function flagThread(
  lines: ThreadLine[],
  opts: { item: string; guestName?: string | null; amountsCents: number[] },
): FlaggedLine[] {
  const words = itemWords(opts.item, opts.guestName ?? null);
  const amounts = amountTokens(opts.amountsCents);
  return lines.map((l) => {
    const text = (l.body || '').toLowerCase();
    const aboutCharge =
      words.some((w) => new RegExp(`\\b${w}`, 'i').test(text)) ||
      amounts.some((a) => new RegExp(`(^|[^\\d.,])\\$?${a.replace(/[.,]/g, (ch) => `\\${ch}`)}(?![\\d])`).test(text));
    const mentionsRefund = /\brefund/i.test(text);
    return { ...l, aboutCharge, mentionsRefund };
  });
}
