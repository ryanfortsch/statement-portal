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
