/** Conservative candidate selection; this table has no reservation foreign key. */
export const AGREEMENT_CANDIDATE_LIMIT = 4;
export type AgreementCandidate = {
  property_id?: string | null;
  guest_name?: string | null;
  guest_signed_name?: string | null;
  guest_signed_at?: string | null;
  voided_at?: string | null;
  stay_start?: string | null;
  stay_end?: string | null;
};
const name = (value: string | null | undefined) => (value || '').trim().replace(/\s+/g, ' ').toLowerCase();
export function selectDisputeAgreement<T extends AgreementCandidate>(
  candidates: T[],
  stay: { propertyId: string; guestName: string | null; checkIn: string | null; checkOut: string | null },
): { agreement: T | null; issue: string | null } {
  if (!name(stay.guestName) || !stay.checkIn || !stay.checkOut) {
    return { agreement: null, issue: 'the rental agreement (guest name or full stay dates are unavailable; match the original manually)' };
  }
  if (candidates.length >= AGREEMENT_CANDIDATE_LIMIT) {
    return { agreement: null, issue: 'the rental agreement (the candidate list may be incomplete; match the original manually)' };
  }
  const matches = candidates.filter(row => row.property_id === stay.propertyId &&
    row.stay_start === stay.checkIn && row.stay_end === stay.checkOut &&
    name(row.guest_name) === name(stay.guestName) && name(row.guest_signed_name) === name(stay.guestName) &&
    row.guest_signed_at && Number.isFinite(Date.parse(row.guest_signed_at)) && !row.voided_at);
  if (matches.length !== 1) {
    return { agreement: null, issue: matches.length > 1
      ? 'the rental agreement (multiple signed records match; verify the original before attaching one)'
      : 'the rental agreement (no unique signed record matches the guest and full stay dates)' };
  }
  return { agreement: matches[0], issue: null };
}
