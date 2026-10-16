import type { Owner, ProjectionRow } from './projections-types';

/**
 * Which sealed contract copy reached the owner, and where the row says so.
 *
 * Each signature seals a PDF (`contract-seal.ts`) and emails the same bytes
 * to the owner (`contract-email.ts`). The stamp that says the email went out
 * is not named after the copy it belongs to (the owner-signed copy's stamp
 * is `contract_owner_email_sent_at`), and both sends are best-effort and
 * quiet: with no `prospect_email` on the row they are skipped with a
 * console.warn. On 2026-10-15 the 47 Atlantic contract was signed,
 * countersigned, sealed and archived with neither email sent and nothing on
 * the prospect page saying so.
 *
 * This module is the one place that pairs a copy with its stamp, so the
 * page can say "not emailed to the owner" from the row alone and the send
 * action stamps the right column. It has no I/O; `npm test` covers it.
 */

export type ContractCopyKind = 'signed' | 'executed';

export const CONTRACT_COPY_KINDS: readonly ContractCopyKind[] = ['signed', 'executed'];

export function isContractCopyKind(value: unknown): value is ContractCopyKind {
  return value === 'signed' || value === 'executed';
}

export type ContractCopyColumns = {
  label: string;
  pathColumn: 'contract_signed_pdf_path' | 'contract_executed_pdf_path';
  shaColumn: 'contract_signed_pdf_sha256' | 'contract_executed_pdf_sha256';
  sentAtColumn: 'contract_owner_email_sent_at' | 'contract_executed_email_sent_at';
};

export const CONTRACT_COPY_COLUMNS: Record<ContractCopyKind, ContractCopyColumns> = {
  signed: {
    label: 'Owner-signed copy',
    pathColumn: 'contract_signed_pdf_path',
    shaColumn: 'contract_signed_pdf_sha256',
    sentAtColumn: 'contract_owner_email_sent_at',
  },
  executed: {
    label: 'Executed copy',
    pathColumn: 'contract_executed_pdf_path',
    shaColumn: 'contract_executed_pdf_sha256',
    sentAtColumn: 'contract_executed_email_sent_at',
  },
};

export type ContractCopyRow = Pick<
  ProjectionRow,
  | 'prospect_email'
  | 'contract_signed_pdf_path'
  | 'contract_signed_pdf_sha256'
  | 'contract_executed_pdf_path'
  | 'contract_executed_pdf_sha256'
  | 'contract_owner_email_sent_at'
  | 'contract_executed_email_sent_at'
>;

export type ContractCopyStatus = ContractCopyColumns & {
  kind: ContractCopyKind;
  path: string;
  sha256: string;
  /** When this copy last went to the owner. Null: it never did. */
  emailedAt: string | null;
};

/**
 * The sealed copies on the row, owner-signed first, each with its email
 * stamp. A copy counts only with both its path and its fingerprint, which is
 * what the download route needs to serve it and the send action to attach it.
 */
export function contractCopyStatuses(row: ContractCopyRow): ContractCopyStatus[] {
  const out: ContractCopyStatus[] = [];
  for (const kind of CONTRACT_COPY_KINDS) {
    const cols = CONTRACT_COPY_COLUMNS[kind];
    const path = row[cols.pathColumn];
    const sha256 = row[cols.shaColumn];
    if (!path || !sha256) continue;
    out.push({ kind, ...cols, path, sha256, emailedAt: row[cols.sentAtColumn] ?? null });
  }
  return out;
}

/** One copy's status, or null when the row holds no such sealed copy. */
export function contractCopyStatus(row: ContractCopyRow, kind: ContractCopyKind): ContractCopyStatus | null {
  return contractCopyStatuses(row).find((c) => c.kind === kind) ?? null;
}

/** The address the contract copies email to, or null when the row has none. */
export function ownerEmailOnRecord(row: Pick<ProjectionRow, 'prospect_email'>): string | null {
  const email = row.prospect_email?.trim();
  return email ? email : null;
}

/** An address typed into the owner-email editor, trimmed, or null when it is not one. */
export function parseOwnerEmail(input: unknown): string | null {
  const s = String(input ?? '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

/**
 * The owners array carrying the address the next form save will derive
 * `prospect_email` from. `deriveLegacyFromOwners` reads the first owner card
 * with a name, so that is the card that changes; the rest are untouched.
 * With no owner cards there is nothing to keep in step (the form seeds its
 * one card from `prospect_email` itself), so null: write nothing.
 */
export function ownersWithEmail(owners: Owner[] | null | undefined, email: string): Owner[] | null {
  if (!Array.isArray(owners) || owners.length === 0) return null;
  const i = owners.findIndex((o) => o.first_name || o.last_name);
  if (i < 0) return null;
  return owners.map((o, j) => (j === i ? { ...o, email } : o));
}

/** The line under the sign link while the row has no owner email. */
export const NO_OWNER_EMAIL_WARNING =
  'No owner email on record. The signed and executed copies will not email to the owner until one is saved here.';
