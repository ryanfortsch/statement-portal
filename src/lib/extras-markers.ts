/**
 * Marker prefixed onto a `bank_deposit_attributions` row whose money is a
 * far-future stay's DEPOSIT or BALANCE - stay principal that belongs to the
 * stay's own future statement period, NOT an add-on for a stay in the month
 * the charge happened to land in.
 *
 * Written by `lib/stripe-sync.ts` when it queues a charge whose Stripe
 * `helm_request_key` is an `ffdeposit:` / `ffbalcharge:` key; detected by
 * `components/BankDepositReview.tsx` (the extras-queue decision surface) to
 * warn the operator NOT to apply it to this statement. Kept in one plain-string
 * module so the writer and the reader can never drift (no server-only imports,
 * so the client component can import it safely).
 */
export const FUTURE_STAY_PRINCIPAL_MARK = '⚠ Future-stay principal';

/** True when a queue row's description was stamped as future-stay principal. */
export function isFutureStayPrincipal(description: string | null | undefined): boolean {
  return !!description && description.startsWith(FUTURE_STAY_PRINCIPAL_MARK);
}

/**
 * A Stay Cape Ann principal payment is described by the listing's external
 * title: "Stay at Rocky Neck - ..." for most homes, but "Stay in Central
 * Gloucester - ..." for 225 Washington. Matching only "Stay at" let 225
 * Washington's stay payments into the add-on queue, where attributing one
 * pays the owner twice. Every stay-principal test uses this one pattern.
 */
export const STAY_PRINCIPAL_TITLE = /^stay (at|in)\b/i;

/** True when a Stripe description or product name reads as a stay's own payment. */
export function isStayPrincipalTitle(text: string | null | undefined): boolean {
  return !!text && STAY_PRINCIPAL_TITLE.test(text.trim());
}
