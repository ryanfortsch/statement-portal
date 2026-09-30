'use client';

import { useState } from 'react';
import { useRecoverableAction } from '@/lib/use-recoverable-action';
import { useDraftNavigationGuard } from '@/lib/use-draft-navigation-guard';
import { manuallyAddContact } from '../actions';

const empty = { email: '', first_name: '', last_name: '', tags: '' };
export function AddGuestContactForm() {
  const [draft, setDraft] = useState(empty);
  const [saved, setSaved] = useState(false);
  const { busy, pending, error, run } = useRecoverableAction();
  useDraftNavigationGuard(Object.values(draft).some(Boolean), pending);
  return (
          <details style={{ position: 'relative' }}>
            <summary style={{ ...secondaryButtonStyle, cursor: 'pointer', listStyle: 'none' }}>
              + Add Contact
            </summary>
            <form
              action={manuallyAddContact}
              onSubmit={event => {
                event.preventDefault();
                if (busy.current) return;
                const data = new FormData(event.currentTarget);
                setSaved(false);
                run(async () => { await manuallyAddContact(data); setDraft(empty); setSaved(true); }, 'Could not confirm the contact was added. Your details are still here. Check Contacts before retrying.');
              }}
              style={{
                position: 'absolute',
                right: 0,
                top: 'calc(100% + 8px)',
                background: 'var(--paper)',
                border: '1px solid var(--ink)',
                padding: 16,
                width: 320,
                zIndex: 10,
                display: 'grid',
                gap: 8,
              }}
            >
              <input name="email" aria-label="Email" value={draft.email} onChange={event => { setSaved(false); setDraft(prev => ({ ...prev, email: event.target.value })); }} disabled={pending} type="email" placeholder="email@example.com" required style={inputStyle} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input name="first_name" aria-label="First name" value={draft.first_name} onChange={event => { setSaved(false); setDraft(prev => ({ ...prev, first_name: event.target.value })); }} disabled={pending} placeholder="First" style={inputStyle} />
                <input name="last_name" aria-label="Last name" value={draft.last_name} onChange={event => { setSaved(false); setDraft(prev => ({ ...prev, last_name: event.target.value })); }} disabled={pending} placeholder="Last" style={inputStyle} />
              </div>
              <input name="tags" aria-label="Tags" value={draft.tags} onChange={event => { setSaved(false); setDraft(prev => ({ ...prev, tags: event.target.value })); }} disabled={pending} placeholder="tags, comma, separated" style={inputStyle} />
              <button type="submit" disabled={pending} aria-busy={pending} style={primaryButtonStyle}>{pending ? 'Adding…' : 'Add'}</button>
              {error && <p role="alert" style={{ color: 'var(--negative)' }}>{error} <a href="/guests/contacts" target="_blank" rel="noopener noreferrer">Check Contacts</a></p>}
              {saved && <p role="status">Contact added</p>}
            </form>
          </details>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--rule)',
  color: 'var(--ink)',
  fontSize: 13,
  padding: '8px 10px',
  outline: 'none',
  fontFamily: 'inherit',
};

const primaryButtonStyle: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '10px 18px',
  border: 'none',
  cursor: 'pointer',
  textDecoration: 'none',
};

const secondaryButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '10px 18px',
  border: '1px solid var(--ink)',
  cursor: 'pointer',
  textDecoration: 'none',
};
