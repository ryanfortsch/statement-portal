/**
 * Contractor payout method (record-keeping only — Helm never moves money). The
 * office pays out-of-band; this captures HOW to pay them. Details are encrypted
 * at rest (field-crypto); a masked/clear hint is kept for display. Stored on
 * the RLS-locked contractors table (service-role only).
 */
import 'server-only';
import { fieldDb } from '@/lib/field-db';
import { encryptSecret, decryptSecret } from '@/lib/field-crypto';

export const PAYMENT_METHODS = ['Venmo', 'Zelle', 'PayPal', 'Cash App', 'Direct deposit (ACH)', 'Check'] as const;
const ACH = 'Direct deposit (ACH)';

function hintFor(method: string, details: string): string {
  const d = details.trim();
  // Account numbers get masked; handles (Venmo/Zelle/etc.) are shown so the
  // office can actually pay them.
  if (method === ACH) return `ACH ••${d.replace(/\D/g, '').slice(-4)}`;
  if (method === 'Check') return 'mailed check';
  return d;
}

export async function savePayment(contractorId: string, method: string, details: string): Promise<string | null> {
  if (!method.trim()) return 'Pick a payout method.';
  if (method !== 'Check' && !details.trim()) return 'Add your payout details.';
  await fieldDb()
    .from('contractors')
    .update({
      payment_method: method,
      payment_details_encrypted: details.trim() ? encryptSecret(details.trim()) : null,
      payment_hint: hintFor(method, details),
      updated_at: new Date().toISOString(),
    })
    .eq('id', contractorId);
  return null;
}

export type PaymentSummary = { method: string; hint: string | null; hasDetails: boolean };

export async function loadPaymentSummaries(): Promise<Map<string, PaymentSummary>> {
  const { data } = await fieldDb()
    .from('contractors')
    .select('id, payment_method, payment_hint, payment_details_encrypted')
    .not('payment_method', 'is', null);
  const map = new Map<string, PaymentSummary>();
  for (const r of (data ?? []) as Array<{
    id: string;
    payment_method: string | null;
    payment_hint: string | null;
    payment_details_encrypted: string | null;
  }>) {
    if (r.payment_method) {
      map.set(r.id, { method: r.payment_method, hint: r.payment_hint, hasDetails: !!r.payment_details_encrypted });
    }
  }
  return map;
}

/** Office-only: decrypt the full payout details (e.g. ACH account). */
export async function revealPayment(contractorId: string): Promise<string | null> {
  const { data } = await fieldDb()
    .from('contractors')
    .select('payment_details_encrypted')
    .eq('id', contractorId)
    .maybeSingle();
  const enc = (data as { payment_details_encrypted: string | null } | null)?.payment_details_encrypted;
  if (!enc) return null;
  try {
    return decryptSecret(enc);
  } catch {
    return null;
  }
}
