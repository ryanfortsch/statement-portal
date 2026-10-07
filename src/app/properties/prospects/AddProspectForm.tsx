'use client';

import { useState } from 'react';
import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { useDraftNavigationGuard } from '@/lib/use-draft-navigation-guard';
import { createProspectProperty } from '../actions';

/** Quiet create form for a PROSPECT property: a home we may sign, so the office
 *  can point Field packets and work slips at it before onboarding. Lands on the
 *  new property's page (add photos, coords tweaks, notes there). Invisible to
 *  statements / owners / operations until real onboarding activates it. */
export function AddProspectForm() {
  const [draft, setDraft] = useState({ name: '', address: '', city: '' });
  const { busy, pending, error, setError, run } = useRecoverableAction();
  useDraftNavigationGuard(Object.values(draft).some(Boolean), pending);
  const lbl: React.CSSProperties = { fontSize: 11, color: 'var(--ink-4)', display: 'flex', flexDirection: 'column', gap: 4 };
  const inp: React.CSSProperties = {
    font: 'inherit', fontSize: 14, color: 'var(--ink)', background: 'var(--paper)',
    border: '1px solid var(--rule)', padding: '8px 10px', minWidth: 170, borderRadius: 6,
  };
  return (
    <details style={{ marginTop: 44, maxWidth: 640 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 600 }}>
        + Add a prospective property
      </summary>
      <form
        method="post"
        onSubmit={event => {
          event.preventDefault();
          if (busy.current) return;
          const data = new FormData(event.currentTarget);
          run(async () => {
            const result = await createProspectProperty(data);
            if (result?.error) setError(result.error);
          }, 'Could not confirm creation. Your details are still here. Check the prospect list in a new tab before retrying, in case it was created.');
        }}
        style={{ marginTop: 14, border: '1px solid var(--rule)', borderRadius: 12, background: 'var(--paper-2, #fff)', padding: '14px 18px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}
      >
        <label style={lbl}>
          Name
          <input name="name" value={draft.name} onChange={event => setDraft(prev => ({ ...prev, name: event.target.value }))} disabled={pending} required placeholder="12 Marmion" style={inp} />
        </label>
        <label style={lbl}>
          Address
          <input name="address" value={draft.address} onChange={event => setDraft(prev => ({ ...prev, address: event.target.value }))} disabled={pending} required placeholder="12 Marmion Way" style={inp} />
        </label>
        <label style={lbl}>
          Town
          <input name="city" value={draft.city} onChange={event => setDraft(prev => ({ ...prev, city: event.target.value }))} disabled={pending} placeholder="Rockport" style={inp} />
        </label>
        <button type="submit" disabled={pending} aria-busy={pending} style={{ background: 'var(--ink)', color: 'var(--paper)', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '10px 18px', borderRadius: 6 }}>{pending ? 'Adding…' : 'Add prospect'}</button>
        <div style={{ fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.5, width: '100%' }}>
          A home we may sign. You can point Field packets and work slips at it right away; it stays out of
          statements, owner tools, and the turnover board until it&apos;s onboarded for real.
        </div>
        {error && <p role="alert" style={{ color: 'var(--negative)' }}>{error} <a href="/properties/prospects" target="_blank" rel="noopener noreferrer">Check prospects</a></p>}
      </form>
    </details>
  );
}
