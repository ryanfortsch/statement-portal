import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { AgreementForm } from '../AgreementForm';
import { createGuestAgreement } from '../actions';

export const dynamic = 'force-dynamic';

/**
 * New guest rental agreement (Stay Cape Ann). Pick a Helm property (or a
 * custom address), set the stay's terms, and create — the detail page is
 * where the signing link + send controls live.
 */
export default async function NewAgreementPage() {
  const { data } = await supabaseAdmin
    .from('properties')
    .select('id, name, address, city')
    .eq('is_active', true)
    .order('name');

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="marketing" />

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          <Link href="/guests?tab=agreements" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>
            ← Agreements
          </Link>
        </div>
        <h1
          className="font-serif"
          style={{ fontSize: 36, lineHeight: 1.05, fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }}
        >
          New rental agreement
        </h1>
        <p style={{ marginTop: 8, fontSize: 14, color: 'var(--ink-3)', maxWidth: 640 }}>
          A bespoke Stay Cape Ann agreement for a direct or mid-term stay. The document carries the
          Rising Tide affiliation line, so the guest knows who bills them.
        </p>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 96 }}>
        <AgreementForm
          action={createGuestAgreement}
          properties={(data ?? []) as { id: string; name: string; address: string; city: string }[]}
          submitLabel="Create agreement"
        />
      </section>
    </div>
  );
}
