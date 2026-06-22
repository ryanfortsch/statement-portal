/**
 * Contractor W-9 storage — in Helm, locked down. Writes go through the
 * service-role client into the RLS-locked contractor_w9 table; the TIN is
 * encrypted at rest (field-crypto) and only the last 4 are kept in the clear.
 * The office reveals the full TIN on demand (revealTin) for filing 1099s.
 */
import 'server-only';
import { fieldDb } from '@/lib/field-db';
import { encryptSecret, decryptSecret } from '@/lib/field-crypto';

export const TAX_CLASSIFICATIONS = [
  'Individual / Sole proprietor',
  'Single-member LLC',
  'LLC (taxed as C-corp)',
  'LLC (taxed as S-corp)',
  'LLC (taxed as Partnership)',
  'C corporation',
  'S corporation',
  'Partnership',
  'Trust / estate',
] as const;

export type W9Input = {
  legalName: string;
  businessName?: string | null;
  taxClassification: string;
  addressLine: string;
  city: string;
  state: string;
  zip: string;
  tinType: 'ssn' | 'ein';
  tin: string; // raw, any format
  signedName: string;
  signedIp?: string | null;
};

/** Validate + persist a W-9. Returns an error string, or null on success. */
export async function saveW9(contractorId: string, w: W9Input): Promise<string | null> {
  const digits = (w.tin || '').replace(/\D/g, '');
  if (!w.legalName.trim()) return 'Legal name is required.';
  if (!w.taxClassification.trim()) return 'Pick a tax classification.';
  if (!w.addressLine.trim() || !w.city.trim() || !w.state.trim() || !w.zip.trim()) return 'A full address is required.';
  if (w.tinType !== 'ssn' && w.tinType !== 'ein') return 'Pick SSN or EIN.';
  if (digits.length !== 9) return `${w.tinType === 'ssn' ? 'SSN' : 'EIN'} must be 9 digits.`;
  if (!w.signedName.trim()) return 'A signature is required.';

  const { error } = await fieldDb()
    .from('contractor_w9')
    .upsert(
      {
        contractor_id: contractorId,
        legal_name: w.legalName.trim(),
        business_name: w.businessName?.trim() || null,
        tax_classification: w.taxClassification,
        address_line: w.addressLine.trim(),
        city: w.city.trim(),
        state: w.state.trim(),
        zip: w.zip.trim(),
        tin_type: w.tinType,
        tin_encrypted: encryptSecret(digits),
        tin_last4: digits.slice(-4),
        signed_name: w.signedName.trim(),
        signed_at: new Date().toISOString(),
        signed_ip: w.signedIp || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'contractor_id' },
    );
  return error ? error.message : null;
}

export type W9Summary = {
  legalName: string;
  businessName: string | null;
  taxClassification: string;
  address: string;
  tinType: string;
  tinLast4: string | null;
  signedName: string | null;
  signedAt: string | null;
};

export async function loadW9Summaries(): Promise<Map<string, W9Summary>> {
  const { data } = await fieldDb()
    .from('contractor_w9')
    .select('contractor_id, legal_name, business_name, tax_classification, address_line, city, state, zip, tin_type, tin_last4, signed_name, signed_at');
  const map = new Map<string, W9Summary>();
  for (const r of (data ?? []) as Array<{
    contractor_id: string;
    legal_name: string;
    business_name: string | null;
    tax_classification: string;
    address_line: string;
    city: string;
    state: string;
    zip: string;
    tin_type: string;
    tin_last4: string | null;
    signed_name: string | null;
    signed_at: string | null;
  }>) {
    map.set(r.contractor_id, {
      legalName: r.legal_name,
      businessName: r.business_name,
      taxClassification: r.tax_classification,
      address: [r.address_line, r.city, r.state, r.zip].filter(Boolean).join(', '),
      tinType: r.tin_type,
      tinLast4: r.tin_last4,
      signedName: r.signed_name,
      signedAt: r.signed_at,
    });
  }
  return map;
}

/** Office-only: decrypt the full TIN for filing a 1099. Caller must be staff. */
export async function revealTin(contractorId: string): Promise<string | null> {
  const { data } = await fieldDb()
    .from('contractor_w9')
    .select('tin_encrypted')
    .eq('contractor_id', contractorId)
    .maybeSingle();
  const row = data as { tin_encrypted: string } | null;
  if (!row?.tin_encrypted) return null;
  try {
    return decryptSecret(row.tin_encrypted);
  } catch {
    return null;
  }
}
