import { notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { ProjectionRow } from '@/lib/projections-types';
import { ContractDocument } from '@/components/projections/ContractDocument';

export const dynamic = 'force-dynamic';

async function getProjection(id: string): Promise<ProjectionRow | null> {
  const { data } = await supabase.from('projections').select('*').eq('id', id).maybeSingle();
  return (data as ProjectionRow | null) ?? null;
}

/**
 * Internal contract preview at /projections/<id>/contract. Reuses the shared
 * ContractDocument component. No signing form here — that lives on the
 * public route at /contract/<token>. If the contract is already signed,
 * ContractDocument renders the typed name + date in the signature block,
 * so the downloaded PDF reflects the signature.
 */
export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projection = await getProjection(id);
  if (!projection) notFound();
  return <ContractDocument projection={projection} />;
}
