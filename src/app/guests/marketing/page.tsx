import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { MarketingTabs } from '@/components/MarketingTabs';
import { supabase, isConfigured } from '@/lib/supabase';
import { listFleetProperties } from '@/lib/fleet';
import { CAPE_ANN_REGION } from '@/lib/property-scope';
import { MarketingMemoryEditor, type MarketingRow } from './MarketingMemoryEditor';

export const dynamic = 'force-dynamic';

async function loadMarketing() {
  if (!isConfigured) return null;
  try {
    const { data, error } = await supabase.from('property_marketing').select('*');
    if (error || !data) return null;
    return data as MarketingRow[];
  } catch {
    return null;
  }
}

export default async function MarketingMemoryPage() {
  const marketing = await loadMarketing();

  // Guest-facing Cape Ann homes from the registry (properties.region), so a
  // home promoted from the prospect funnel shows up without a code change and
  // Ryan's out-of-region homes stay off the marketing memory.
  const homes = await listFleetProperties({ region: CAPE_ANN_REGION });

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <MarketingTabs current="guests" />

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 24, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          <Link href="/guests/contacts" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>← Guests</Link>
        </div>
        <h1 className="font-serif" style={{ fontSize: 36, lineHeight: 1.05, fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
          Marketing memory
        </h1>
        <p style={{ marginTop: 8, fontSize: 14, color: 'var(--ink-3)', maxWidth: 640 }}>
          How each home is sold. The campaign AI reads this on every draft, so the more specific and true this is, the better the copy. Lead with what actually matters: waterfront, the dock, the walk to the beach. Seeded from staycapeann.com; edit freely.
        </p>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        {marketing === null ? (
          <div role="alert" style={{ borderTop: '1px solid var(--rule)', paddingTop: 20 }}>
            <p>Marketing memory could not be loaded. Your saved information has not been changed.</p>
            <a href="/guests/marketing">Retry loading marketing memory</a>
          </div>
        ) : (
          <MarketingMemoryEditor homes={homes.map(({ id, name }) => ({ id, name }))} rows={marketing} />
        )}
      </section>

      <footer style={{ borderTop: '1px solid var(--ink)' }}>
        <div className="max-w-[1100px] mx-auto px-10 flex items-center justify-between" style={{
          padding: '14px 40px', fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-4)',
        }}>
          <span>Rising Tide &middot; Guests &middot; Marketing Memory</span>
        </div>
      </footer>
    </div>
  );
}
