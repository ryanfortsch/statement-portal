import { createHash } from 'node:crypto';
import type { ProjectionRow } from './projections-types';
import { getTeamMember } from './team.ts';

/**
 * What the management contract actually says, as values. One builder feeds
 * both the renderer (`ContractDocument`) and the post-signature lock, so the
 * lock guards exactly the text an owner put their name under: if a save
 * would change a rendered term, it is refused; if it would not, it goes
 * through (an owner's phone number, the deck's revenue overrides).
 *
 * Why a lock at all: the contract is not a stored document. Every view and
 * every PDF re-renders it from the `projections` row, so editing a signed
 * prospect used to rewrite the contract under the owner's signature. The
 * sealed copies (`src/lib/contract-seal.ts`) are the record of what was
 * signed; the lock keeps the live render agreeing with them.
 */

export type ContractTermsSource = Pick<
  ProjectionRow,
  | 'prospect_full_legal'
  | 'prospect_name'
  | 'property_address'
  | 'property_city'
  | 'property_type'
  | 'mgmt_fee_pct'
  | 'initial_deposit'
  | 'min_account_balance'
  | 'min_availability_days'
  | 'sale_notification_days'
  | 'reputation_fee'
  | 'term_start'
  | 'term_end'
  | 'contract_overrides'
  | 'custom_clauses'
>;

export type TemplateVars = ReturnType<typeof buildTemplateVars>;

/** The {{var}} values the contract template interpolates. */
export function buildTemplateVars(p: ContractTermsSource) {
  const ownerName = p.prospect_full_legal || p.prospect_name || '';
  const propertyAddress = `${p.property_address}${p.property_city ? `, ${p.property_city}` : ''}`;
  return {
    ownerName,
    propertyAddress,
    propertyType: p.property_type || 'House',
    // Null-guarded: a redline can remove any of these terms. Null
    // becomes null here so interpolate() renders the dash placeholder instead of
    // "null days" / "$NaN". mgmtPct is guarded defensively even though
    // mgmt_fee_pct stays non-null.
    mgmtPct: p.mgmt_fee_pct != null ? fmtPct(p.mgmt_fee_pct) : null,
    deposit: p.initial_deposit != null ? fmtMoney(p.initial_deposit) : null,
    minBalance: p.min_account_balance != null ? fmtMoney(p.min_account_balance) : null,
    minDays: p.min_availability_days != null ? `${p.min_availability_days} days` : null,
    saleDays: p.sale_notification_days != null ? `${p.sale_notification_days} days` : null,
    repFee: p.reputation_fee != null ? fmtMoney(p.reputation_fee) : null,
    termStartShort: p.term_start ? formatDateShort(p.term_start) : null,
    termEndShort: p.term_end ? formatDateShort(p.term_end) : null,
    termStartLong: p.term_start ? formatDateNarrative(p.term_start) : null,
    termEndLong: p.term_end ? formatDateNarrative(p.term_end) : null,
  };
}

/**
 * The signed terms, one labelled entry each. Names and the address compare
 * as rendered; numbers and dates compare raw, which is stricter than the
 * rounded text (a fee of 25.4% prints as 25% but would still reach the
 * register and the property row at countersign and promote). Edits (the
 * redline overrides) and the legacy Rider compare as JSON; the Rider only
 * counts while it renders, which is when no overrides exist.
 */
export function contractTermsSnapshot(p: ContractTermsSource): Record<string, string | null> {
  const v = buildTemplateVars(p);
  const overrides = Array.isArray(p.contract_overrides) && p.contract_overrides.length > 0
    ? p.contract_overrides
    : null;
  const rider = !overrides && Array.isArray(p.custom_clauses) && p.custom_clauses.length > 0
    ? p.custom_clauses.map((c) => ({ title: (c.title ?? '').trim(), body: (c.body ?? '').trim() }))
    : null;
  return {
    'Owner name': v.ownerName || null,
    'Property address': v.propertyAddress,
    'Property type': v.propertyType,
    'Management fee': rawNumber(p.mgmt_fee_pct),
    'Initial deposit': rawNumber(p.initial_deposit),
    'Minimum account balance': rawNumber(p.min_account_balance),
    'Minimum availability': rawNumber(p.min_availability_days),
    'Sale notice': rawNumber(p.sale_notification_days),
    'Reputation fee': rawNumber(p.reputation_fee),
    'Term start': p.term_start ? p.term_start.slice(0, 10) : null,
    'Term end': p.term_end ? p.term_end.slice(0, 10) : null,
    'Contract edits': overrides ? JSON.stringify(overrides) : null,
    'Rider clauses': rider ? JSON.stringify(rider) : null,
  };
}

function rawNumber(n: number | string | null | undefined): string | null {
  if (n == null || n === '') return null;
  const x = Number(n);
  return Number.isFinite(x) ? String(x) : String(n);
}

/** Labels of the terms that differ between two versions of the row. */
export function changedContractTerms(before: ContractTermsSource, after: ContractTermsSource): string[] {
  const a = contractTermsSnapshot(before);
  const b = contractTermsSnapshot(after);
  return Object.keys(a).filter((k) => a[k] !== b[k]);
}

/**
 * A fingerprint of the terms as rendered. The signing form carries the one
 * the owner was shown, and the signature is refused if the row no longer
 * matches it: staff editing terms while the owner reads must not put the
 * owner's name under terms they never saw.
 */
export function contractTermsDigest(p: ContractTermsSource): string {
  return createHash('sha256').update(JSON.stringify(contractTermsSnapshot(p))).digest('hex');
}

/** Owner signature on file: the terms are locked until it is withdrawn. */
export function contractTermsLocked(p: Pick<ProjectionRow, 'contract_signed_at'>): boolean {
  return !!p.contract_signed_at;
}

/**
 * Who signs for Rising Tide STR, LLC on the PM row and the certificate.
 * `contract_countersigned_by` records the owner session that clicked
 * Countersign; rows countersigned before it existed (null) keep Allie,
 * who signed them and whose name went out on those executed copies.
 */
export const LEGACY_COUNTERSIGNER_NAME = "Allie O'Brien";

export function countersignerName(email: string | null | undefined): string {
  if (!email) return LEGACY_COUNTERSIGNER_NAME;
  return getTeamMember(email)?.name ?? email;
}

export const CONTRACT_LOCKED_MESSAGE =
  'The owner has signed this contract, so its terms are locked. Withdraw the signature in the Signing panel to change them; the owner then signs again at the same link.';

export function formatDateShort(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${m}/${d}/${y}`;
}
export function formatDateNarrative(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
export function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}
export function fmtPct(p: number): string {
  return `${Math.round(p * 100)}%`;
}
