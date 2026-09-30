'use client';

import { useState } from 'react';
import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { useDraftNavigationGuard } from '@/lib/use-draft-navigation-guard';
import { saveMarketing } from './actions';

export type MarketingRow = {
  property_id: string; tagline: string | null; primary_selling_point: string | null;
  selling_points: string[] | null; on_water: boolean; bedrooms: number | null;
  sleeps: number | null; best_for: string | null; notes: string | null;
};
type Draft = { tagline: string; primary_selling_point: string; selling_points: string; on_water: boolean; bedrooms: string; sleeps: string; best_for: string; notes: string };
const empty: Draft = { tagline: '', primary_selling_point: '', selling_points: '', on_water: false, bedrooms: '', sleeps: '', best_for: '', notes: '' };
function initialDrafts(rows: MarketingRow[]): Record<string, Draft> {
  return Object.fromEntries(rows.map(row => [row.property_id, {
    tagline: row.tagline ?? '', primary_selling_point: row.primary_selling_point ?? '',
    selling_points: (row.selling_points ?? []).join('\n'), on_water: row.on_water,
    bedrooms: row.bedrooms == null ? '' : String(row.bedrooms), sleeps: row.sleeps == null ? '' : String(row.sleeps),
    best_for: row.best_for ?? '', notes: row.notes ?? '',
  }]));
}

export function MarketingMemoryEditor({ homes, rows }: { homes: { id: string; name: string }[]; rows: MarketingRow[] }) {
  // Keep one draft per home across server revalidation, including unsaved neighboring homes.
  const [drafts, setDrafts] = useState(() => initialDrafts(rows));
  const [baseline, setBaseline] = useState(() => initialDrafts(rows));
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState<string | null>(null);
  const { busy, pending, error, run } = useRecoverableAction();
  const dirty = homes.some(home => JSON.stringify(drafts[home.id] ?? empty) !== JSON.stringify(baseline[home.id] ?? empty));
  useDraftNavigationGuard(dirty, pending);
  return (
        <div style={{ display: 'grid', gap: 0, borderTop: '1px solid var(--ink)' }}>
          {homes.map((p) => {
            const m = baseline[p.id] ?? empty;
            const draft = drafts[p.id] ?? empty;
            const change = (key: keyof Draft, value: string | boolean) => { setDrafts(prev => ({ ...prev, [p.id]: { ...draft, [key]: value } })); setSaved(prev => ({ ...prev, [p.id]: false })); };
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

                <form
                  action={saveMarketing}
                  onSubmit={event => {
                    event.preventDefault();
                    if (busy.current) return;
                    const data = new FormData(event.currentTarget);
                    const submitted = { ...draft };
                    setActive(p.id);
                    setSaved(prev => ({ ...prev, [p.id]: false }));
                    run(async () => {
                      await saveMarketing(data);
                      setBaseline(prev => ({ ...prev, [p.id]: submitted }));
                      setSaved(prev => ({ ...prev, [p.id]: true }));
                    }, 'Could not confirm this save. Your edits are still here. Please retry.');
                  }}
                  style={{ marginTop: 16, display: 'grid', gap: 12, maxWidth: 720 }}
                >
                  <input type="hidden" name="property_id" value={p.id} />

                  <Field label="Tagline">
                    <input name="tagline" value={draft.tagline} onChange={event => change('tagline', event.target.value)} disabled={pending} style={inputStyle} placeholder="The one-liner positioning" />
                  </Field>

                  <Field label="Primary selling point (the AI leads with this)">
                    <input name="primary_selling_point" value={draft.primary_selling_point} onChange={event => change('primary_selling_point', event.target.value)} disabled={pending} style={inputStyle} placeholder="Right on the harbor with a private dock" />
                  </Field>

                  <Field label="Selling points (one per line)">
                    <textarea name="selling_points" rows={4} value={draft.selling_points} onChange={event => change('selling_points', event.target.value)} disabled={pending} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} placeholder={'On the water at Smith Cove\nWalk to the galleries and marina\nLoft primary suite'} />
                  </Field>

                  <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" name="on_water" checked={draft.on_water} onChange={event => change('on_water', event.target.checked)} disabled={pending} />
                      On the water (headline selling point)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                      Sleeps <input name="sleeps" type="number" value={draft.sleeps} onChange={event => change('sleeps', event.target.value)} disabled={pending} style={{ ...inputStyle, width: 70 }} />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                      Bedrooms <input name="bedrooms" type="number" value={draft.bedrooms} onChange={event => change('bedrooms', event.target.value)} disabled={pending} style={{ ...inputStyle, width: 70 }} />
                    </label>
                  </div>

                  <Field label="Best for">
                    <input name="best_for" value={draft.best_for} onChange={event => change('best_for', event.target.value)} disabled={pending} style={inputStyle} placeholder="reunions and big groups" />
                  </Field>

                  <Field label="Notes (anything else the AI should know)">
                    <textarea name="notes" rows={2} value={draft.notes} onChange={event => change('notes', event.target.value)} disabled={pending} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} placeholder="Pet friendly. New hot tub going in this spring." />
                  </Field>

                  <div>
                    <button type="submit" disabled={pending} aria-busy={pending && active === p.id} style={{
                      background: 'var(--ink)', color: 'var(--paper)', fontSize: 11, fontWeight: 600,
                      letterSpacing: '.18em', textTransform: 'uppercase', padding: '10px 18px', border: 'none', cursor: 'pointer',
                    }}>
                      {pending && active === p.id ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                  {error && active === p.id && <p role="alert" style={{ color: 'var(--negative)' }}>{error}</p>}
                  {saved[p.id] && <p role="status">Saved</p>}
                </form>
              </details>
            );
          })}
        </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>{label}</span>
      {children}
    </label>
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
