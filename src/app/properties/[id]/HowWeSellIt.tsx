'use client';

import { useState } from 'react';
import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { useDraftNavigationGuard } from '@/lib/use-draft-navigation-guard';
import { saveHowWeSellIt } from './how-we-sell-it-actions';

/**
 * The "How we sell it" editor on the property page's Guest & listing tab:
 * the selling points the campaign AI reads on every draft. One home, one
 * form. The draft survives a server revalidation and a failed save, and the
 * page asks before leaving with unsaved edits. The Listing section opens it
 * from its read view and closes it on `onSaved`.
 */
export type HowWeSellItValues = {
  tagline: string | null;
  primary_selling_point: string | null;
  selling_points: string[] | null;
  on_water: boolean;
  best_for: string | null;
  notes: string | null;
};
type Draft = { tagline: string; primary_selling_point: string; selling_points: string; on_water: boolean; best_for: string; notes: string };

function toDraft(row: HowWeSellItValues | null): Draft {
  return {
    tagline: row?.tagline ?? '',
    primary_selling_point: row?.primary_selling_point ?? '',
    selling_points: (row?.selling_points ?? []).join('\n'),
    on_water: row?.on_water ?? false,
    best_for: row?.best_for ?? '',
    notes: row?.notes ?? '',
  };
}

export function HowWeSellIt({ propertyId, row, onSaved }: { propertyId: string; row: HowWeSellItValues | null; onSaved?: () => void }) {
  const [draft, setDraft] = useState(() => toDraft(row));
  const [baseline, setBaseline] = useState(() => toDraft(row));
  const [saved, setSaved] = useState(false);
  const { busy, pending, error, run } = useRecoverableAction();
  useDraftNavigationGuard(JSON.stringify(draft) !== JSON.stringify(baseline), pending);
  const change = (key: keyof Draft, value: string | boolean) => { setDraft((prev) => ({ ...prev, [key]: value })); setSaved(false); };

  return (
    <form
      action={saveHowWeSellIt}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy.current) return;
        const data = new FormData(event.currentTarget);
        const submitted = { ...draft };
        setSaved(false);
        run(async () => {
          await saveHowWeSellIt(data);
          setBaseline(submitted);
          setSaved(true);
          onSaved?.();
        }, 'Could not confirm this save. Your edits are still here. Please retry.');
      }}
      style={{ display: 'grid', gap: 12, maxWidth: 720 }}
    >
      <input type="hidden" name="property_id" value={propertyId} />

      <Field label="Tagline">
        <input name="tagline" value={draft.tagline} onChange={(e) => change('tagline', e.target.value)} disabled={pending} style={inputStyle} placeholder="The one-line positioning" />
      </Field>

      <Field label="Lead with">
        <input name="primary_selling_point" value={draft.primary_selling_point} onChange={(e) => change('primary_selling_point', e.target.value)} disabled={pending} style={inputStyle} placeholder="Right on the harbor with a private dock" />
      </Field>

      <Field label="Selling points, one per line">
        <textarea name="selling_points" rows={4} value={draft.selling_points} onChange={(e) => change('selling_points', e.target.value)} disabled={pending} style={{ ...inputStyle, resize: 'vertical' }} placeholder={'On the water at Smith Cove\nWalk to the galleries and marina\nLoft primary suite'} />
      </Field>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
        <input type="checkbox" name="on_water" checked={draft.on_water} onChange={(e) => change('on_water', e.target.checked)} disabled={pending} />
        On the water
      </label>

      <Field label="Best for">
        <input name="best_for" value={draft.best_for} onChange={(e) => change('best_for', e.target.value)} disabled={pending} style={inputStyle} placeholder="reunions and big groups" />
      </Field>

      <Field label="Notes">
        <textarea name="notes" rows={2} value={draft.notes} onChange={(e) => change('notes', e.target.value)} disabled={pending} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Pet friendly. New hot tub going in this spring." />
      </Field>

      <div>
        <button type="submit" disabled={pending} aria-busy={pending} style={{
          background: 'var(--ink)', color: 'var(--paper)', fontSize: 11, fontWeight: 600,
          letterSpacing: '.18em', textTransform: 'uppercase', padding: '10px 18px', border: 'none', cursor: 'pointer',
        }}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error && <p role="alert" style={{ color: 'var(--negative)' }}>{error}</p>}
      {saved && <p role="status">Saved</p>}
    </form>
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
