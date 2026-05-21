import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { supabase, isConfigured } from '@/lib/supabase';
import { PROPERTIES } from '@/lib/properties';
import { saveMarketing } from './actions';

export const dynamic = 'force-dynamic';

type MarketingRow = {
  property_id: string;
  tagline: string | null;
  primary_selling_point: string | null;
  selling_points: string[] | null;
  on_water: boolean;
  bedrooms: number | null;
  sleeps: number | null;
  best_for: string | null;
  notes: string | null;
};

async function loadMarketing(): Promise<Map<string, MarketingRow>> {
  const map = new Map<string, MarketingRow>();
  if (!isConfigured) return map;
  const { data } = await supabase.from('property_marketing').select('*');
  for (const row of (data ?? []) as MarketingRow[]) map.set(row.property_id, row);
  return map;
}

export default async function MarketingMemoryPage() {
  const marketing = await loadMarketing();

  // Guest-facing homes only (skip Ryan's personal properties).
  const homes = Object.values(PROPERTIES).filter(
    (p) => p.id !== '65_calderwood' && p.id !== '3246_ne_27th',
  );

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="guests" />

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 24, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          <Link href="/guests" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>← Guests</Link>
        </div>
        <h1 className="font-serif" style={{ fontSize: 36, lineHeight: 1.05, fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
          Marketing memory
        </h1>
        <p style={{ marginTop: 8, fontSize: 14, color: 'var(--ink-3)', maxWidth: 640 }}>
          How each home is sold. The campaign AI reads this on every draft, so the more specific and true this is, the better the copy. Lead with what actually matters: waterfront, the dock, the walk to the beach. Seeded from staycapeann.com; edit freely.
        </p>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        <div style={{ display: 'grid', gap: 0, borderTop: '1px solid var(--ink)' }}>
          {homes.map((p) => {
            const m = marketing.get(p.id);
            return (
              <details key={p.id} style={{ borderBottom: '1px solid var(--rule)', padding: '16px 0' }}>
                <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'baseline', gap: 12, listStyle: 'none' }}>
                  <span className="font-serif" style={{ fontSize: 18, color: 'var(--ink)' }}>
                    {p.name}
                  </span>
                  {m?.on_water && (
                    <span className="eyebrow" style={{ color: 'var(--tide-deep, #1e6b6b)' }}>On the water</span>
                  )}
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                    {m?.tagline ? m.tagline.slice(0, 60) + (m.tagline.length > 60 ? '…' : '') : 'No memory yet'}
                  </span>
                </summary>

                <form action={saveMarketing} style={{ marginTop: 16, display: 'grid', gap: 12, maxWidth: 720 }}>
                  <input type="hidden" name="property_id" value={p.id} />

                  <Field label="Tagline">
                    <input name="tagline" defaultValue={m?.tagline ?? ''} style={inputStyle} placeholder="The one-liner positioning" />
                  </Field>

                  <Field label="Primary selling point (the AI leads with this)">
                    <input name="primary_selling_point" defaultValue={m?.primary_selling_point ?? ''} style={inputStyle} placeholder="Right on the harbor with a private dock" />
                  </Field>

                  <Field label="Selling points (one per line)">
                    <textarea name="selling_points" rows={4} defaultValue={(m?.selling_points ?? []).join('\n')} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} placeholder={'On the water at Smith Cove\nWalk to the galleries and marina\nLoft primary suite'} />
                  </Field>

                  <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" name="on_water" defaultChecked={m?.on_water ?? false} />
                      On the water (headline selling point)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                      Sleeps <input name="sleeps" type="number" defaultValue={m?.sleeps ?? ''} style={{ ...inputStyle, width: 70 }} />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                      Bedrooms <input name="bedrooms" type="number" defaultValue={m?.bedrooms ?? ''} style={{ ...inputStyle, width: 70 }} />
                    </label>
                  </div>

                  <Field label="Best for">
                    <input name="best_for" defaultValue={m?.best_for ?? ''} style={inputStyle} placeholder="reunions and big groups" />
                  </Field>

                  <Field label="Notes (anything else the AI should know)">
                    <textarea name="notes" rows={2} defaultValue={m?.notes ?? ''} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} placeholder="Pet friendly. New hot tub going in this spring." />
                  </Field>

                  <div>
                    <button type="submit" style={{
                      background: 'var(--ink)', color: 'var(--paper)', fontSize: 11, fontWeight: 600,
                      letterSpacing: '.18em', textTransform: 'uppercase', padding: '10px 18px', border: 'none', cursor: 'pointer',
                    }}>
                      Save
                    </button>
                  </div>
                </form>
              </details>
            );
          })}
        </div>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'transparent',
  border: '1px solid var(--rule)',
  color: 'var(--ink)',
  fontSize: 13,
  padding: '8px 10px',
  outline: 'none',
  fontFamily: 'inherit',
};
