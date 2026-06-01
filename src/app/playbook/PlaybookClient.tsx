'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import {
  PLAYBOOK_CATEGORIES,
  categoryLabel,
  excerptFor,
  type PlaybookEntryRow,
  type PropertyOption,
} from '@/lib/playbook';
import { displayNameForEmail } from '@/lib/team';

function formatShortDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const CHIP_BASE: CSSProperties = {
  fontSize: 10,
  letterSpacing: '.12em',
  textTransform: 'uppercase',
  fontWeight: 600,
  padding: '2px 7px',
  borderRadius: 3,
};

export function PlaybookClient({
  entries,
  properties,
}: {
  entries: PlaybookEntryRow[];
  properties: PropertyOption[];
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [showArchived, setShowArchived] = useState(false);

  const propertyName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of properties) map[p.id] = p.name;
    return map;
  }, [properties]);

  // Category keys actually present, ordered by the curated list then any custom ones.
  const presentCategories = useMemo(() => {
    const present = new Set(entries.filter((e) => showArchived || e.status !== 'archived').map((e) => e.category));
    const ordered = PLAYBOOK_CATEGORIES.map((c) => c.key).filter((k) => present.has(k));
    const custom = [...present].filter((k) => !PLAYBOOK_CATEGORIES.some((c) => c.key === k)).sort();
    return [...ordered, ...custom];
  }, [entries, showArchived]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (!showArchived && e.status === 'archived') return false;
      if (category !== 'all' && e.category !== category) return false;
      if (!q) return true;
      const hay = `${e.title} ${e.summary ?? ''} ${e.tags.join(' ')} ${e.body_md}`.toLowerCase();
      return hay.includes(q);
    });
  }, [entries, query, category, showArchived]);

  const grouped = useMemo(() => {
    const map = new Map<string, PlaybookEntryRow[]>();
    for (const e of filtered) {
      const arr = map.get(e.category) ?? [];
      arr.push(e);
      map.set(e.category, arr);
    }
    const order = category !== 'all' ? [category] : presentCategories;
    return order
      .filter((k) => map.has(k))
      .map((k) => ({ key: k, label: categoryLabel(k), items: map.get(k)! }));
  }, [filtered, presentCategories, category]);

  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 56 }}>
      <style>{`
        .pb-row { transition: background 120ms ease; }
        .pb-row:hover { background: var(--paper-2); }
        .pb-chipbtn { transition: color 120ms ease, border-color 120ms ease; }
      `}</style>

      {/* Toolbar */}
      <div
        className="rt-helm-filter-bar"
        style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap' }}
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 1, minWidth: 240 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the playbook…"
            style={{
              flex: 1,
              minWidth: 200,
              fontSize: 14,
              padding: '9px 12px',
              border: '1px solid var(--rule)',
              borderRadius: 4,
              background: 'var(--paper)',
              color: 'var(--ink)',
              outline: 'none',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--ink-3)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
          <Link
            href="/playbook/new"
            style={{
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '.02em',
              padding: '9px 16px',
              borderRadius: 4,
              background: 'var(--ink)',
              color: 'var(--paper)',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            + New entry
          </Link>
        </div>
      </div>

      {/* Category chips */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 26 }}>
        <CategoryChip active={category === 'all'} onClick={() => setCategory('all')} label="All" />
        {presentCategories.map((k) => (
          <CategoryChip key={k} active={category === k} onClick={() => setCategory(k)} label={categoryLabel(k)} />
        ))}
      </div>

      {grouped.length === 0 && (
        <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 22, color: 'var(--ink-3)', fontSize: 14 }}>
          {query.trim() ? 'No entries match your search.' : 'No entries yet. Write the first one.'}
        </div>
      )}

      {grouped.map((group) => (
        <div key={group.key} style={{ marginBottom: 38 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
            <div className="eyebrow">{group.label}</div>
            <div className="eyebrow" style={{ color: 'var(--ink-4)' }}>
              {group.items.length} {group.items.length === 1 ? 'entry' : 'entries'}
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {group.items.map((e) => (
              <Link
                key={e.id}
                href={`/playbook/${e.slug}`}
                className="pb-row"
                style={{
                  display: 'block',
                  padding: '16px 12px',
                  borderBottom: '1px solid var(--rule)',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--font-fraunces), serif', fontSize: 18, fontWeight: 500, color: 'var(--ink)' }}>
                    {e.pinned && <span title="Pinned" style={{ color: 'var(--signal)', marginRight: 6 }}>★</span>}
                    {e.title}
                  </span>
                  {e.status !== 'published' && (
                    <span style={{ ...CHIP_BASE, color: 'var(--ink-4)', border: '1px solid var(--rule)' }}>
                      {e.status}
                    </span>
                  )}
                  {e.property_id && propertyName[e.property_id] && (
                    <span style={{ ...CHIP_BASE, color: 'var(--tide-deep)', border: '1px solid var(--rule)' }}>
                      {propertyName[e.property_id]}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--ink-3)', marginTop: 5, maxWidth: 760 }}>
                  {excerptFor(e)}
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                  {e.tags.slice(0, 5).map((t) => (
                    <span key={t} style={{ fontSize: 11, color: 'var(--ink-4)' }}>#{t}</span>
                  ))}
                  <span style={{ fontSize: 11, color: 'var(--ink-4)', marginLeft: 'auto' }}>
                    Updated {formatShortDate(e.updated_at)} · {displayNameForEmail(e.updated_by_email || e.created_by_email)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function CategoryChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="pb-chipbtn"
      style={{
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: '.02em',
        padding: '6px 13px',
        borderRadius: 20,
        border: `1px solid ${active ? 'var(--ink)' : 'var(--rule)'}`,
        background: active ? 'var(--ink)' : 'transparent',
        color: active ? 'var(--paper)' : 'var(--ink-3)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}
