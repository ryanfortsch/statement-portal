import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { fetchContractPdf } from '@/lib/contract-email';

/**
 * Sealed copies of the management contract.
 *
 * The contract is rendered from the projections row on every view, so a
 * re-render is a picture of the row today, not a record of what was
 * signed. At each signature Helm keeps the exact PDF bytes it emailed
 * (owner-signed at signing, fully executed at countersign) in the private
 * `contract-records` bucket, with their SHA-256 on the row. Owners download
 * them through /api/contracts/sealed, which re-checks the fingerprint
 * before serving.
 *
 * Every write here is best-effort. The signature is persisted before any
 * of it runs, and a storage outage must never cost an owner their
 * signature; a missing seal shows on the prospect page instead.
 */

export const CONTRACT_RECORDS_BUCKET = 'contract-records';

export type SealedCopyKind = 'signed' | 'executed';

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Store one copy; returns its path and fingerprint, or null on failure. */
export async function sealContractCopy(args: {
  projectionId: string;
  kind: SealedCopyKind;
  pdf: Buffer;
}): Promise<{ path: string; sha256: string } | null> {
  const sha256 = sha256Hex(args.pdf);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = `${args.projectionId}/${args.kind}-${stamp}.pdf`;
  const { error } = await supabaseAdmin.storage
    .from(CONTRACT_RECORDS_BUCKET)
    .upload(path, args.pdf, { contentType: 'application/pdf', upsert: false });
  if (error) {
    console.error(`[contract-seal] ${args.kind} copy upload failed for ${args.projectionId}:`, error.message);
    return null;
  }
  return { path, sha256 };
}

export async function readSealedCopy(path: string): Promise<Buffer | null> {
  const { data, error } = await supabaseAdmin.storage.from(CONTRACT_RECORDS_BUCKET).download(path);
  if (error || !data) {
    console.error(`[contract-seal] read failed for ${path}:`, error?.message ?? 'no data');
    return null;
  }
  return Buffer.from(await data.arrayBuffer());
}

/**
 * The executed PDF for filing (Drive backfill, the property's Documents
 * tab): the sealed bytes when they exist and still match their
 * fingerprint, otherwise a fresh render, which is all a contract executed
 * before sealing has.
 */
export async function executedContractPdf(args: {
  projection: {
    id: string;
    onboarding_token: string | null;
    contract_executed_pdf_path?: string | null;
    contract_executed_pdf_sha256?: string | null;
  };
  origin: string;
}): Promise<Buffer> {
  const { projection } = args;
  if (projection.contract_executed_pdf_path) {
    const sealed = await readSealedCopy(projection.contract_executed_pdf_path);
    if (sealed && sha256Hex(sealed) === projection.contract_executed_pdf_sha256) return sealed;
    console.error(`[contract-seal] sealed executed copy unusable for ${projection.id}; filing a re-render`);
  }
  return fetchContractPdf({ projectionId: projection.id, origin: args.origin, token: projection.onboarding_token });
}
