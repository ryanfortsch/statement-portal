import type { ProjectionRow } from './projections-types';
import type { PropertyContractRow } from './property-contracts';

/**
 * The contracts register's writing rules, shared by its two writers: the
 * countersign of a Helm renewal (projections/actions.ts) and the "Register
 * this agreement" form on /properties/contracts. Pure, so the form, the
 * action and the tests read one copy.
 *
 * The register records what the PAPER says. For an agreement signed in
 * Helm the paper is the projection's contract, whose terms are locked once
 * the owner signs (src/lib/contract-terms.ts). So a register row for a Helm
 * agreement takes every term the contract states from the projection, and
 * the form shows those terms instead of asking for them: nobody can type a
 * fee into the register that disagrees with what the owner signed. The form
 * fills only what the contract does not state (the renewal summary, the
 * Drive copy, notes, a term date the contract left blank).
 */

export type RenewalType = PropertyContractRow['renewal_type'];
export type SignedVia = PropertyContractRow['signed_via'];

export type RegisterSource = Pick<
  ProjectionRow,
  | 'prospect_full_legal'
  | 'prospect_name'
  | 'mgmt_fee_pct'
  | 'term_start'
  | 'term_end'
  | 'min_availability_days'
  | 'sale_notification_days'
  | 'reputation_fee'
  | 'contract_overrides'
  | 'custom_clauses'
>;

/**
 * The base contract template auto-renews each year with 120 days'
 * non-renewal notice. An edited contract can reword that clause, which is
 * why the form lets the reader correct the summary.
 */
export const TEMPLATE_RENEWAL = { renewal_type: 'auto_renew' as RenewalType, notice_days_initial: 120, notice_days_renewal: 120 };

/** True when the contract carries redline edits or a Rider. */
export function contractHasEdits(p: Pick<RegisterSource, 'contract_overrides' | 'custom_clauses'>): boolean {
  return (
    ((p.contract_overrides as unknown[] | null)?.length ?? 0) > 0 ||
    ((p.custom_clauses as unknown[] | null)?.length ?? 0) > 0
  );
}

/** The terms an agreement states, which the register form shows instead of asking for. */
export type LockedTerms = {
  owner_party: string;
  term_start: string | null;
  term_end: string | null;
  fee_pct: number | null;
  min_availability: string | null;
  sale_notice_days: number | null;
  sale_reputation_fee: number | null;
};

/**
 * The terms a Helm contract states, as register columns. Null where the
 * contract leaves a term blank (a redline can remove one).
 */
export function registerTermsFromProjection(p: RegisterSource): LockedTerms {
  const feeFraction = Number(p.mgmt_fee_pct ?? 0.25);
  return {
    owner_party: (p.prospect_full_legal || p.prospect_name || '').trim(),
    term_start: p.term_start ? p.term_start.slice(0, 10) : null,
    term_end: p.term_end ? p.term_end.slice(0, 10) : null,
    fee_pct: Math.round(feeFraction * 10000) / 100,
    min_availability: p.min_availability_days != null ? `${p.min_availability_days} days during the term` : null,
    sale_notice_days: p.sale_notification_days,
    sale_reputation_fee: p.reputation_fee,
  };
}

/**
 * The terms a register row for a Helm agreement was written with. A
 * correction keeps them: they came from the signed contract.
 */
export function registerTermsFromRow(r: PropertyContractRow): LockedTerms {
  return {
    owner_party: r.owner_party,
    term_start: r.term_start,
    term_end: r.term_end,
    fee_pct: r.fee_pct != null ? Number(r.fee_pct) : null,
    min_availability: r.min_availability,
    sale_notice_days: r.sale_notice_days,
    sale_reputation_fee: r.sale_reputation_fee,
  };
}

/** Drive's file id from a share or view link, or null. */
export function driveFileIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const path = url.match(/\/(?:file\/)?d\/([A-Za-z0-9_-]{10,})/);
  if (path) return path[1];
  const query = url.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  return query ? query[1] : null;
}

/* ---------- the renewal words ---------- */

export type RenewalWord =
  | 'non_renewal'
  | 'notice_window'
  | 'auto_renew'
  | 'fixed'
  | 'mutual_agreement'
  | 'lapsed'
  | 'superseded'
  | 'expired';

/**
 * One plain line for each renewal word the register prints. The page
 * prints a word's line where the word first appears, once.
 */
export const RENEWAL_WORDS: Record<RenewalWord, { word: string; meaning: string }> = {
  non_renewal: {
    word: 'Non-renewal notice',
    meaning: 'a written notice, from us or the owner, that the agreement ends at its term end instead of renewing.',
  },
  notice_window: {
    word: 'Notice window',
    meaning: 'how many days before the term end that notice has to be given.',
  },
  auto_renew: {
    word: 'Auto-renews',
    meaning: 'renews for another year on its own unless someone gives non-renewal notice in time.',
  },
  fixed: {
    word: 'Fixed term',
    meaning: 'ends on its date and does not renew; managing past it needs a new signature.',
  },
  mutual_agreement: {
    word: 'Mutual agreement',
    meaning: 'renews only if both sides agree to it in writing.',
  },
  lapsed: {
    word: 'Lapsed',
    meaning: 'the term ended and nothing renewed it.',
  },
  superseded: {
    word: 'Superseded',
    meaning: 'replaced by a later agreement.',
  },
  expired: {
    word: 'Expired',
    meaning: 'ended without a later agreement taking its place.',
  },
};

export const RENEWAL_TYPE_WORD: Record<RenewalType, RenewalWord> = {
  auto_renew: 'auto_renew',
  fixed: 'fixed',
  mutual_agreement: 'mutual_agreement',
};

/* ---------- the form ---------- */

export type RegisterFormInput = {
  owner_party?: string | null;
  executed_on?: string | null;
  term_start?: string | null;
  term_end?: string | null;
  renewal_type?: string | null;
  notice_days_initial?: string | null;
  notice_days_renewal?: string | null;
  fee_pct?: string | null;
  signed_via?: string | null;
  drive_url?: string | null;
  notes?: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(v: string | null | undefined, max: number): string | null {
  const s = (v ?? '').trim();
  return s ? s.slice(0, max) : null;
}

function date(v: string | null | undefined, label: string): string | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  if (!ISO_DATE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new Error(`${label} is not a date.`);
  return s;
}

function wholeDays(v: string | null | undefined, label: string): number | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > 730) throw new Error(`${label} must be a whole number of days.`);
  return n;
}

export type ParsedRegister = {
  owner_party: string;
  executed_on: string | null;
  term_start: string | null;
  term_end: string;
  renewal_type: RenewalType;
  notice_days_initial: number | null;
  notice_days_renewal: number | null;
  fee_pct: number | null;
  /** Null when the form did not say; a Helm agreement is always 'helm'. */
  signed_via: SignedVia | null;
  drive_url: string | null;
  notes: string | null;
};

/**
 * Read the form into register columns, or say what is wrong in a sentence.
 * `locked` holds the terms a Helm contract states: each non-null one wins
 * over whatever the form posted, so a hand-edited request cannot move them.
 */
export function parseRegisterForm(
  input: RegisterFormInput,
  locked: LockedTerms | null,
): { ok: true; fields: ParsedRegister } | { ok: false; error: string } {
  try {
    const owner_party = locked?.owner_party || text(input.owner_party, 160);
    if (!owner_party) return { ok: false, error: 'Enter the owner party as the agreement names it.' };

    const term_start = locked?.term_start ?? date(input.term_start, 'Term start');
    const term_end = locked?.term_end ?? date(input.term_end, 'Term end');
    if (!term_end) return { ok: false, error: 'Enter the term end the agreement states.' };
    if (term_start && term_start > term_end) return { ok: false, error: 'The term starts after it ends.' };

    const renewalRaw = (input.renewal_type ?? '').trim();
    if (renewalRaw !== 'auto_renew' && renewalRaw !== 'mutual_agreement' && renewalRaw !== 'fixed') {
      return { ok: false, error: 'Pick how the agreement renews.' };
    }
    const renewal: RenewalType = renewalRaw;
    const notice_days_initial = renewal === 'auto_renew' ? wholeDays(input.notice_days_initial, 'The notice window') : null;
    const notice_days_renewal =
      renewal === 'auto_renew' ? wholeDays(input.notice_days_renewal, 'The later notice window') ?? notice_days_initial : null;

    let fee_pct: number | null = locked?.fee_pct ?? null;
    if (fee_pct == null) {
      const s = (input.fee_pct ?? '').trim().replace(/%$/, '');
      if (s) {
        const n = Number(s);
        if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, error: 'Enter the fee as a percent, like 25.' };
        fee_pct = n;
      }
    }

    const viaRaw = (input.signed_via ?? '').trim();
    const signed_via: SignedVia | null = viaRaw === 'docusign' || viaRaw === 'external' ? viaRaw : null;

    const drive_url = text(input.drive_url, 500);
    if (drive_url && !/^https:\/\//i.test(drive_url)) return { ok: false, error: 'The Drive link should start with https://.' };

    return {
      ok: true,
      fields: {
        owner_party,
        executed_on: date(input.executed_on, 'The executed date'),
        term_start,
        term_end,
        renewal_type: renewal,
        notice_days_initial,
        notice_days_renewal,
        fee_pct,
        signed_via,
        drive_url,
        notes: text(input.notes, 1000),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Check the dates and numbers.' };
  }
}

/** Last known name for a home that has left the roster: never the raw id. */
export function lastKnownName(
  propertyId: string,
  sources: { dbName?: string | null; rosterName?: string | null },
): string {
  const name = sources.dbName?.trim() || sources.rosterName?.trim();
  if (name) return name;
  return propertyId
    .split('_')
    .filter(Boolean)
    .map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}
