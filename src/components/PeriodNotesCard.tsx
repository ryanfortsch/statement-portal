'use client';

import { useState, useEffect, useCallback } from 'react';
import { PROPERTIES } from '@/lib/properties';

/**
 * Close-out notes for the selected statement month.
 *
 * A simple per-month notepad pinned to /statements so the operator can drop
 * context throughout the month -- "VRBO cancellation Friday, refunded the
 * guest", "30 Woodward maintenance bill is going to be split with the
 * owner" -- and pick it up at month-end without hunting through email.
 *
 * Stored in the period_notes table (see supabase-schema-period-notes.sql).
 * Notes can be tagged to a property (optional), marked done (kept visible
 * with a strikethrough), or deleted.
 */

type Note = {
  id: string;
  month: string;
  property_id: string | null;
  body: string;
  created_by: string | null;
  created_at: string;
  resolved_at: string | null;
};

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return iso; }
}

export function PeriodNotesCard({ month }: { month: string }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draftProperty, setDraftProperty] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  const load = useCallback(async () => {
    if (!month) return;
    setError(null);
    try {
      const res = await fetch(`/api/period-notes?month=${encodeURIComponent(month)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load notes');
      setNotes(data.notes as Note[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notes');
    }
  }, [month]);

  // Initial load + refresh when the selected month changes. This is the
  // canonical fetch-on-mount pattern; the eslint rule below is intended to
  // catch unconditional setState during render, not async data loaders.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function addNote() {
    const text = draft.trim();
    if (!text) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/period-notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ month, body: text, property_id: draftProperty || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save note');
      setNotes(prev => [data.note as Note, ...(prev ?? [])]);
      setDraft('');
      setDraftProperty('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save note');
    } finally {
      setBusy(false);
    }
  }

  async function toggleResolved(note: Note) {
    const next = !note.resolved_at;
    setNotes(prev => (prev ?? []).map(n => n.id === note.id ? { ...n, resolved_at: next ? new Date().toISOString() : null } : n));
    try {
      const res = await fetch(`/api/period-notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resolved: next }),
      });
      if (!res.ok) {
        // Roll back optimistic update on failure
        setNotes(prev => (prev ?? []).map(n => n.id === note.id ? note : n));
      }
    } catch {
      setNotes(prev => (prev ?? []).map(n => n.id === note.id ? note : n));
    }
  }

  async function deleteNote(note: Note) {
    if (!confirm('Delete this note? This can\'t be undone.')) return;
    const prev = notes;
    setNotes((notes ?? []).filter(n => n.id !== note.id));
    try {
      const res = await fetch(`/api/period-notes/${note.id}`, { method: 'DELETE' });
      if (!res.ok) setNotes(prev);
    } catch {
      setNotes(prev);
    }
  }

  const visible = (notes ?? []).filter(n => showResolved || !n.resolved_at);
  const resolvedCount = (notes ?? []).filter(n => n.resolved_at).length;
  const propertyOptions = Object.values(PROPERTIES).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 32 }}>
      <div className="flex items-baseline justify-between flex-wrap" style={{ gap: 12, marginBottom: 10 }}>
        <div className="eyebrow">Close-out notes</div>
        {resolvedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowResolved(s => !s)}
            style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)', border: 'none', background: 'transparent', cursor: 'pointer' }}
          >
            {showResolved ? `Hide ${resolvedCount} resolved` : `Show ${resolvedCount} resolved`}
          </button>
        )}
      </div>

      <div style={{ border: '1px solid var(--rule)', background: 'var(--paper-2)' }}>
        {/* Compose */}
        <div style={{ borderBottom: '1px solid var(--rule)', padding: '12px 14px' }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Drop a note for the ${month} close: cancellations, refunds, weird charges, follow-ups…`}
            disabled={busy}
            rows={2}
            style={{ width: '100%', resize: 'vertical', border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', lineHeight: 1.4 }}
          />
          <div className="flex flex-wrap items-center" style={{ gap: 10, marginTop: 8, justifyContent: 'space-between' }}>
            <label style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, fontSize: 11, color: 'var(--ink-3)' }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase' }}>Property (optional)</span>
              <select
                value={draftProperty}
                onChange={(e) => setDraftProperty(e.target.value)}
                disabled={busy}
                style={{ border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', padding: '4px 8px', fontSize: 12 }}
              >
                <option value="">— general —</option>
                {propertyOptions.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={addNote}
              disabled={busy || !draft.trim()}
              style={{
                border: '1px solid var(--ink)',
                background: busy || !draft.trim() ? 'var(--paper-2)' : 'var(--ink)',
                color: busy || !draft.trim() ? 'var(--ink-3)' : 'var(--paper)',
                fontSize: 10, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase',
                padding: '7px 14px', cursor: busy || !draft.trim() ? 'not-allowed' : 'pointer',
                opacity: !draft.trim() ? 0.6 : 1,
              }}
            >
              {busy ? 'Saving…' : 'Add note'}
            </button>
          </div>
          {error && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--negative, #b13b2a)' }}>{error}</div>}
        </div>

        {/* List */}
        {notes === null ? (
          <div style={{ padding: '14px 16px', fontSize: 12, color: 'var(--ink-4)' }}>Loading…</div>
        ) : visible.length === 0 ? (
          <div style={{ padding: '14px 16px', fontSize: 12, color: 'var(--ink-4)' }}>
            No notes for {month} yet. Anything you jot above lives here through close-out.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {visible.map(n => {
              const isDone = !!n.resolved_at;
              const propName = n.property_id ? PROPERTIES[n.property_id]?.name : null;
              return (
                <li key={n.id} style={{ borderTop: '1px solid var(--rule-soft)', padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={isDone}
                    onChange={() => toggleResolved(n)}
                    style={{ marginTop: 3, cursor: 'pointer' }}
                    aria-label={isDone ? 'Mark not done' : 'Mark done'}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, color: isDone ? 'var(--ink-3)' : 'var(--ink)',
                      textDecoration: isDone ? 'line-through' : 'none', lineHeight: 1.4,
                    }}>
                      {n.body}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 10, color: 'var(--ink-4)', letterSpacing: '.04em' }}>
                      {formatTimestamp(n.created_at)}
                      {propName && <> · <span style={{ fontFamily: 'var(--font-fraunces)', color: 'var(--ink-3)' }}>{propName}</span></>}
                      {n.created_by && <> · {n.created_by.split('@')[0]}</>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteNote(n)}
                    title="Delete note"
                    style={{ border: 'none', background: 'transparent', color: 'var(--ink-4)', fontSize: 14, cursor: 'pointer', padding: '0 4px' }}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
