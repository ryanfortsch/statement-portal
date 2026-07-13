import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { supabaseAdmin } from '@/lib/supabase-admin';
import type { GuestAgreementRow } from '@/lib/agreement-types';
import { AgreementForm } from '../../AgreementForm';
import { updateGuestAgreement } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function EditAgreementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await supabaseAdmin.from('guest_agreements').select('*').eq('id', id).maybeSingle();
  if (!data) notFound();
  const agreement = data as GuestAgreementRow;

  // Signed agreements are immutable legal records — bounce back to the
  // detail page, which offers Void + re-issue instead.
  if (agreement.guest_signed_at) redirect(`/guests/agreements/${id}`);

  const { data: props } = await supabaseAdmin
    .from('properties')
    .select('id, name, address, city')
    .eq('is_active', true)
    .order('name');

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="marketing" />

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          <Link href={`/guests/agreements/${id}`} style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>
            ← Agreement
          </Link>
        </div>
        <h1
          className="font-serif"
          style={{ fontSize: 36, lineHeight: 1.05, fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }}
        >
          Edit agreement
        </h1>
        <p style={{ marginTop: 8, fontSize: 14, color: 'var(--ink-3)' }}>
          {agreement.property_address} · {agreement.guest_name}
        </p>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 96 }}>
        <AgreementForm
          action={updateGuestAgreement}
          properties={(props ?? []) as { id: string; name: string; address: string; city: string }[]}
          defaults={agreement}
          submitLabel="Save changes"
        />
      </section>
    </div>
  );
}
