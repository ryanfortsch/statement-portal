/**
 * Types for guest rental agreements (the Stay Cape Ann parallel to the
 * prospect management contract).
 *
 * Pure types + tiny derivations only — safe to import from client and
 * server components alike. The service-role data access lives in
 * the shared supabaseAdmin client; the clause language lives in agreement-base.ts.
 */

export type AgreementKind = 'short_term' | 'mid_term';
export type DepositKind = 'none' | 'security' | 'damage' | 'hold';

export type AgreementCustomClause = {
  title: string;
  body: string;
};

export type GuestAgreementRow = {
  id: string;
  property_id: string | null;
  property_address: string;
  property_city: string;
  kind: AgreementKind;

  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  additional_occupants: string | null;

  stay_start: string; // YYYY-MM-DD
  stay_end: string;   // YYYY-MM-DD

  rental_fee: number;
  deposit_kind: DepositKind;
  deposit_amount: number | null;

  max_occupancy: number | null;
  check_in_time: string;
  check_out_time: string;

  cancel_cutoff_days: number | null;
  cancel_refund_pct: number | null;
  quiet_hours: string;

  utilities_included: string[];
  snow_removal_by_guest: boolean;
  cleaning_fee_separate: boolean;
  midstay_cleaning: boolean;
  no_early_termination: boolean;

  custom_clauses: AgreementCustomClause[] | null;
  internal_notes: string | null;

  signing_token: string;
  sent_at: string | null;
  guest_signed_at: string | null;
  guest_signed_name: string | null;
  guest_signed_ip: string | null;
  guest_signed_user_agent: string | null;
  countersigned_at: string | null;
  guest_email_sent_at: string | null;
  executed_email_sent_at: string | null;
  drive_url: string | null;
  voided_at: string | null;

  created_at: string;
  updated_at: string;
};

export type AgreementStatus = 'draft' | 'sent' | 'signed' | 'executed' | 'voided';

/** Lifecycle: draft → sent → signed → executed, with voided overriding all. */
export function agreementStatus(a: Pick<GuestAgreementRow,
  'voided_at' | 'countersigned_at' | 'guest_signed_at' | 'sent_at'
>): AgreementStatus {
  if (a.voided_at) return 'voided';
  if (a.countersigned_at) return 'executed';
  if (a.guest_signed_at) return 'signed';
  if (a.sent_at) return 'sent';
  return 'draft';
}

/**
 * Which hand an agreement is waiting on, the three groups the Agreements
 * list reads in: a draft to send or a guest signature to countersign is
 * waiting on us, a sent link is waiting on the guest, and an executed or
 * cancelled agreement is done.
 */
export type AgreementGroup = 'us' | 'guest' | 'done';

export const AGREEMENT_GROUPS: { id: AgreementGroup; label: string }[] = [
  { id: 'us', label: 'Waiting on us' },
  { id: 'guest', label: 'Waiting on guest' },
  { id: 'done', label: 'Done' },
];

export function agreementGroup(status: AgreementStatus): AgreementGroup {
  if (status === 'draft' || status === 'signed') return 'us';
  if (status === 'sent') return 'guest';
  return 'done';
}

/** The one thing a waiting-on-us row needs next. */
export function agreementNextStep(status: AgreementStatus): string | null {
  if (status === 'draft') return 'Send the signing link';
  if (status === 'signed') return 'Countersign';
  return null;
}

/** A signing timestamp as the detail page prints it, in Eastern time: "Oct 18, 3:40 PM". */
export function fmtAgreementStamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
}

/**
 * The audit block on the detail page, as sentences: who signed and when,
 * and when each copy went out. The raw trail (IP, browser, exact
 * timestamps, the agreement id) sits behind the page's "Show ids" fold.
 */
export function agreementAuditSentences(a: Pick<GuestAgreementRow,
  'guest_signed_name' | 'guest_signed_at' | 'guest_email_sent_at' | 'countersigned_at' | 'executed_email_sent_at'
>): string[] {
  if (!a.guest_signed_at) return [];
  const out = [`${a.guest_signed_name?.trim() || 'The guest'} signed on ${fmtAgreementStamp(a.guest_signed_at)}.`];
  if (a.guest_email_sent_at) out.push(`Their signed copy was emailed ${fmtAgreementStamp(a.guest_email_sent_at)}.`);
  if (a.countersigned_at) out.push(`Countersigned ${fmtAgreementStamp(a.countersigned_at)}.`);
  if (a.executed_email_sent_at) out.push(`The executed PDF was emailed ${fmtAgreementStamp(a.executed_email_sent_at)}.`);
  return out;
}

/**
 * Whether an agreement can still be cancelled (voided), and the one question
 * to ask before doing it. An executed agreement (both sides signed) is a
 * contract on file and is never voided: `agreementStatus` lets voided win over
 * executed, so a one-click void used to file a signed, Drive-archived lease
 * under Voided. A draft the guest never received voids without a question.
 */
export function agreementVoidability(a: Pick<GuestAgreementRow,
  'voided_at' | 'countersigned_at' | 'guest_signed_at' | 'sent_at'
>): { ok: true; confirm: string | null } | { ok: false; reason: string } {
  if (a.voided_at) return { ok: false, reason: 'This agreement is already cancelled.' };
  if (a.countersigned_at) {
    return { ok: false, reason: 'Both sides signed this agreement, so it stays on file and cannot be voided.' };
  }
  if (a.guest_signed_at) {
    return {
      ok: true,
      confirm: 'The guest already signed. Voiding cancels their signature and kills the signing link.',
    };
  }
  if (a.sent_at) return { ok: true, confirm: 'Kills the signing link. The guest can no longer sign.' };
  return { ok: true, confirm: null };
}

export const AGREEMENT_STATUS_LABEL: Record<AgreementStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  signed: 'Signed',
  executed: 'Executed',
  voided: 'Voided',
};

export const AGREEMENT_KIND_LABEL: Record<AgreementKind, string> = {
  short_term: 'Short-Term',
  mid_term: 'Mid-Term',
};

/** The default utility list a mid-term stay includes (20 Enon precedent). */
export const DEFAULT_UTILITIES = [
  'Electricity',
  'Gas',
  'Water & sewer',
  'Internet',
  'Trash service',
] as const;
