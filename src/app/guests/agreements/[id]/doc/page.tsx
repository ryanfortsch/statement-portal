import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase-admin';
import type { GuestAgreementRow } from '@/lib/agreement-types';
import { AgreementDocument } from '@/components/agreements/AgreementDocument';

export const dynamic = 'force-dynamic';

/**
 * Internal agreement preview at /guests/agreements/<id>/doc — the staff
 * mirror of the public signing page, with no signing form. Auth-gated by
 * the middleware like everything under /guests. Cmd+P prints exactly what
 * the guest's PDF will look like (blank signature lines pre-signature,
 * typed signatures + certificate after).
 */
export default async function AgreementDocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await supabaseAdmin.from('guest_agreements').select('*').eq('id', id).maybeSingle();
  if (!data) notFound();
  return <AgreementDocument agreement={data as GuestAgreementRow} />;
}
