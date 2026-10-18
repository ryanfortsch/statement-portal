'use client';

import { useState } from 'react';
import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { useDraftNavigationGuard } from '@/lib/use-draft-navigation-guard';
import { createProspectProperty } from './actions';

/** "Add a home we may sign": a properties row with kind 'prospect', so the
 *  office can point Field packets and work slips at a home before it signs.
 *  It lives on /properties because it makes a property; the prospect funnel
 *  (/properties/prospects) is deals only. Lands on the new property's page.
 *  Invisible to statements, owner tools and operations until onboarding
 *  activates it. */
export function AddProspectHomeForm() {
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
        + Add a home we may sign
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
          }, 'Could not confirm creation. Your details are still here. Check the properties list in a new tab before retrying, in case it was created.');
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
        <button type="submit" disabled={pending} aria-busy={pending} style={{ background: 'var(--ink)', color: 'var(--paper)', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '10px 18px', borderRadius: 6 }}>{pending ? 'Adding…' : 'Add home'}</button>
        <div style={{ fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.5, width: '100%' }}>
          Field packets and work slips can point at it before it signs. It joins the roster when it is onboarded.
        </div>
        {error && <p role="alert" style={{ color: 'var(--negative)' }}>{error} <a href="/properties" target="_blank" rel="noopener noreferrer">Check properties</a></p>}
      </form>
    </details>
  );
}
