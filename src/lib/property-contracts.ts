import { supabaseAdmin as supabase, isServiceConfigured } from '@/lib/supabase-admin';

/**
 * Management-contract registry (property_contracts). One row per signed
 * agreement; renewals are new rows and the old row flips to 'superseded'.
 * The row stores what the PAPER says; the live term of an auto-renew
 * contract is derived here by rolling the written Dec-31 term end forward
 * year over year (every contract in the fleet ends on Dec 31, and rolling
 * in code means quiet auto-renewals never need a cron or a data edit).
 *
 * fee_pct is informational. Statement math reads
 * properties.management_fee_pct — the Contracts page flags a mismatch, it
 * never writes one back.
 */
export type PropertyContractRow = {
  id: string;
  property_id: string;
  owner_party: string;
  executed_on: string | null;
  term_start: string | null;
  term_end: string;
  renewal_type: 'auto_renew' | 'mutual_agreement' | 'fixed';
  notice_days_initial: number | null;
  notice_days_renewal: number | null;
  fee_pct: number | null;
  fee_notes: string | null;
  min_availability: string | null;
  sale_notice_days: number | null;
  sale_reputation_fee: number | null;
  special_terms: string[];
  signed_via: 'helm' | 'docusign' | 'external';
  status: 'active' | 'expired' | 'superseded';
  drive_file_id: string | null;
  drive_url: string | null;
  doc_title: string | null;
  notes: string | null;
};

export async function getAllPropertyContracts(): Promise<PropertyContractRow[]> {
  if (!isServiceConfigured) return [];
  try {
    const { data, error } = await supabase
      .from('property_contracts')
      .select('*')
      .order('term_end', { ascending: false });
    if (error) throw error;
    return (data ?? []) as PropertyContractRow[];
  } catch {
    return [];
  }
}

export async function getPropertyContracts(propertyId: string): Promise<PropertyContractRow[]> {
  if (!isServiceConfigured) return [];
  try {
    const { data, error } = await supabase
      .from('property_contracts')
      .select('*')
      .eq('property_id', propertyId)
      .order('term_end', { ascending: false });
    if (error) throw error;
    return (data ?? []) as PropertyContractRow[];
  } catch {
    return [];
  }
}

const DAY_MS = 86400_000;

function isoToUtc(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

/**
 * The end of the term the contract is CURRENTLY in. For an auto-renew
 * contract whose written term end has passed with no non-renewal notice on
 * record, each lapse rolls the term one year forward (Dec 31 to Dec 31).
 * Fixed and mutual-agreement contracts never roll.
 */
export function currentTermEnd(c: PropertyContractRow, todayIso: string): string {
  if (c.renewal_type !== 'auto_renew') return c.term_end;
  let end = c.term_end;
  while (end < todayIso) {
    end = `${Number(end.slice(0, 4)) + 1}${end.slice(4)}`;
  }
  return end;
}

/** True once the derived term end is later than the written one. */
export function inRenewalTerm(c: PropertyContractRow, todayIso: string): boolean {
  return currentTermEnd(c, todayIso) > c.term_end;
}

/**
 * The date by which either party must give written non-renewal notice for
 * the current term, or null when the contract has no notice mechanic
 * (fixed / mutual-agreement renewal). Uses the stepped-up renewal notice
 * once the initial written term has lapsed.
 */
export function noticeDeadline(c: PropertyContractRow, todayIso: string): string | null {
  if (c.renewal_type !== 'auto_renew') return null;
  const days = inRenewalTerm(c, todayIso)
    ? c.notice_days_renewal ?? c.notice_days_initial
    : c.notice_days_initial;
  if (!days) return null;
  return new Date(isoToUtc(currentTermEnd(c, todayIso)) - days * DAY_MS).toISOString().slice(0, 10);
}

export function daysUntil(iso: string, todayIso: string): number {
  return Math.round((isoToUtc(iso) - isoToUtc(todayIso)) / DAY_MS);
}

export type ContractAttention =
  | { kind: 'expired'; detail: string }
  | { kind: 'notice_window'; deadline: string; days: number; detail: string }
  | { kind: 'needs_renewal'; days: number; detail: string }
  | null;

/**
 * What, if anything, this contract needs from the operator right now.
 * - expired: the written term is over and nothing renews it.
 * - notice_window: an auto-renew non-renewal deadline lands within
 *   `windowDays` — the last chance to exit or renegotiate before the
 *   contract locks in another year.
 * - needs_renewal: a fixed / mutual-agreement term ends within
 *   `windowDays` and a NEW signature is required to keep managing.
 */
export function contractAttention(
  c: PropertyContractRow,
  todayIso: string,
  windowDays = 75,
): ContractAttention {
  if (c.status !== 'active') {
    if (c.status === 'expired') return { kind: 'expired', detail: `term ended ${c.term_end}` };
    return null;
  }
  if (c.renewal_type === 'auto_renew') {
    const deadline = noticeDeadline(c, todayIso);
    if (!deadline) return null;
    const days = daysUntil(deadline, todayIso);
    if (days >= 0 && days <= windowDays) {
      return {
        kind: 'notice_window',
        deadline,
        days,
        detail: `non-renewal notice closes in ${days} day${days === 1 ? '' : 's'}, then locks for ${Number(currentTermEnd(c, todayIso).slice(0, 4)) + 1}`,
      };
    }
    return null;
  }
  // fixed / mutual_agreement: the term simply ends unless a new agreement
  // is signed. needs_renewal also covers the already-lapsed case (days < 0).
  const days = daysUntil(c.term_end, todayIso);
  if (days <= windowDays + 45) {
    return {
      kind: 'needs_renewal',
      days,
      detail:
        days < 0
          ? `term ended ${c.term_end} with no renewal signed`
          : `term ends in ${days} day${days === 1 ? '' : 's'} and ${c.renewal_type === 'mutual_agreement' ? 'renews only by mutual written agreement' : 'does not renew'}`,
    };
  }
  return null;
}

/** Human summary of the renewal mechanics, from the row's own clause data. */
export function renewalSummary(c: PropertyContractRow): string {
  if (c.renewal_type === 'auto_renew') {
    const initial = c.notice_days_initial;
    const later = c.notice_days_renewal;
    if (initial && later && later !== initial) {
      return `Auto-renews yearly; non-renewal notice ${initial} days for the current term, ${later} days after`;
    }
    return `Auto-renews yearly; ${initial ?? '—'}-day non-renewal notice`;
  }
  if (c.renewal_type === 'mutual_agreement') {
    return 'Renews only by mutual written agreement — no auto-renew';
  }
  return 'Fixed term — no renewal clause';
}
