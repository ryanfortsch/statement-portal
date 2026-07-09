'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Markdown } from '@/components/Markdown';
import {
  PLAYBOOK_CATEGORIES,
  categoryLabel,
  type PlaybookEntryRow,
  type PlaybookStatus,
} from '@/lib/playbook';
import type { PropertyOption } from '@/lib/playbook-properties';
import { createEntry, updateEntry } from './actions';

const FIELD: CSSProperties = {
  width: '100%',
  fontSize: 14,
  padding: '9px 12px',
  border: '1px solid var(--rule)',
  borderRadius: 4,
  background: 'var(--paper)',
  color: 'var(--ink)',
  outline: 'none',
};

const labelStyle: CSSProperties = {
  fontSize: 10,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  fontWeight: 600,
  color: 'var(--ink-4)',
  display: 'block',
  marginBottom: 6,
};

function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const t = part.trim().replace(/^#/, '').toLowerCase();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

const BODY_PLACEHOLDER = `Write the procedure here. Markdown works:

## A section heading

1. A numbered step (these render as steps).
2. Click the **Create account** button.

- A bullet point
- Another one

> A callout for the important caveat or "why this matters."

Link to another entry like [this](/playbook/some-slug).`;

export function PlaybookEditor({
  mode,
  initial,
  properties,
}: {
  mode: 'new' | 'edit';
  initial?: PlaybookEntryRow;
  properties: PropertyOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'write' | 'preview'>('write');

  const [title, setTitle] = useState(initial?.title ?? '');
  const [category, setCategory] = useState(initial?.category ?? 'general');
  const [summary, setSummary] = useState(initial?.summary ?? '');
  const [body, setBody] = useState(initial?.body_md ?? '');
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [propertyId, setPropertyId] = useState(initial?.property_id ?? '');
  const [status, setStatus] = useState<PlaybookStatus>(initial?.status ?? 'draft');
  const [pinned, setPinned] = useState(initial?.pinned ?? false);
  const [changeNote, setChangeNote] = useState('');

  // Include a custom (non-curated) category as an option so editing keeps it.
  const categoryOptions = PLAYBOOK_CATEGORIES.map((c) => c.key);
  if (initial?.category && !categoryOptions.includes(initial.category)) categoryOptions.push(initial.category);

  function save() {
    setError(null);
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    const payload = {
      title,
      category,
      summary: summary || null,
      body_md: body,
      tags: parseTags(tags),
      property_id: propertyId || null,
      status,
      pinned,
      change_note: changeNote || null,
    };
    startTransition(async () => {
      const res = mode === 'edit' && initial
        ? await updateEntry({ ...payload, id: initial.id })
        : await createEntry(payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/playbook/${res.slug}`);
      router.refresh();
    });
  }

  const cancelHref = mode === 'edit' && initial ? `/playbook/${initial.slug}` : '/playbook';

  return (
    <div className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 32, paddingBottom: 64 }}>
      <div style={{ marginBottom: 24 }}>
        <Link
          href={cancelHref}
          style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 500, color: 'var(--ink-3)', textDecoration: 'none' }}
        >
          ← Cancel
        </Link>
      </div>

      <h1 style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: 30, fontWeight: 300, color: 'var(--ink)', margin: '0 0 24px' }}>
        {mode === 'edit' ? 'Edit entry' : 'New entry'}
      </h1>

      {error && (
        <div style={{ borderLeft: '3px solid var(--negative)', background: 'var(--paper-2)', padding: '10px 14px', marginBottom: 18, color: 'var(--negative)', fontSize: 14 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 28, alignItems: 'start' }} className="pb-editor-grid">
        {/* Left: title + body */}
        <div>
          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle}>Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Onboard a new property"
              style={{ ...FIELD, fontSize: 18, fontFamily: 'var(--font-fraunces), serif' }}
            />
          </div>

          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle}>Summary (one line)</label>
            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="A short description for the list and search"
              style={FIELD}
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Body</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <TabBtn active={tab === 'write'} onClick={() => setTab('write')} label="Write" />
                <TabBtn active={tab === 'preview'} onClick={() => setTab('preview')} label="Preview" />
              </div>
            </div>
            {tab === 'write' ? (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={BODY_PLACEHOLDER}
                spellCheck
                style={{
                  ...FIELD,
                  minHeight: 460,
                  fontFamily: 'var(--font-mono-dash), monospace',
                  fontSize: 13.5,
                  lineHeight: 1.6,
                  resize: 'vertical',
                }}
              />
            ) : (
              <div style={{ border: '1px solid var(--rule)', borderRadius: 4, padding: '18px 20px', minHeight: 460, background: 'var(--paper)' }}>
                <Markdown source={body} />
              </div>
            )}
          </div>
        </div>

        {/* Right: metadata */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label style={labelStyle}>Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={FIELD}>
              {categoryOptions.map((k) => (
                <option key={k} value={k}>{categoryLabel(k)}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as PlaybookStatus)} style={FIELD}>
              <option value="draft">Draft (only visible here)</option>
              <option value="published">Published (searchable + Ask Helm)</option>
              <option value="archived">Archived (hidden)</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>Property scope</label>
            <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} style={FIELD}>
              <option value="">All properties</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Tags (comma separated)</label>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="stripe, chase, setup" style={FIELD} />
          </div>

          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            Pin to top
          </label>

          {mode === 'edit' && (
            <div>
              <label style={labelStyle}>What changed? (optional)</label>
              <input value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="Note for the history log" style={FIELD} />
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button
              onClick={save}
              disabled={pending}
              style={{
                flex: 1, fontSize: 14, fontWeight: 600, padding: '11px 16px', borderRadius: 4,
                background: 'var(--ink)', color: 'var(--paper)', border: 'none',
                cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.6 : 1,
              }}
            >
              {pending ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create entry'}
            </button>
            <Link
              href={cancelHref}
              style={{ fontSize: 14, fontWeight: 600, padding: '11px 16px', borderRadius: 4, border: '1px solid var(--rule)', color: 'var(--ink-3)', textDecoration: 'none' }}
            >
              Cancel
            </Link>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 720px) {
          .pb-editor-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600,
        padding: '4px 10px', borderRadius: 3, cursor: 'pointer',
        border: '1px solid ' + (active ? 'var(--ink)' : 'var(--rule)'),
        background: active ? 'var(--ink)' : 'transparent',
        color: active ? 'var(--paper)' : 'var(--ink-4)',
      }}
    >
      {label}
    </button>
  );
}
