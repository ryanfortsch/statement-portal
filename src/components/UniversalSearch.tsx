'use client';

/**
 * iPhone-style live search. Type into the box and a dropdown opens
 * below with grouped results across pages, properties, contacts, work
 * slips, and tasks. Up/down arrow keys move the highlight, Enter
 * follows the link, Escape closes.
 *
 * Powered by /api/search (see src/lib/search.ts). Debounced 150ms so
 * we're not hammering Supabase on every keystroke.
 *
 * Lives on the home page today. Eventually this will be promoted into
 * a Cmd+K palette callable from the masthead.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SearchResults } from '@/lib/search';
import { CONTACT_TYPE_LABELS } from '@/lib/crm';

type FlatItem = {
  group: string;
  href: string;
  primary: string;
  secondary?: string;
  pill?: string;
  pillColor?: string;
};

type Props = {
  /** Placeholder text when empty. */
  placeholder?: string;
  /** Auto-focus the input on mount (used inside the Cmd+K palette). */
  autoFocus?: boolean;
};

const EMPTY: SearchResults = {
  pages: [],
  properties: [],
  contacts: [],
  slips: [],
  tasks: [],
  total: 0,
};

export function UniversalSearch({ placeholder = 'Search Helm or jump to a page…', autoFocus = false }: Props) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Debounced fetch
  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const json: SearchResults = await res.json();
        setResults(json);
        setHighlight(0);
      } catch (e) {
        if ((e as { name?: string })?.name !== 'AbortError') {
          setResults(EMPTY);
        }
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => clearTimeout(handle);
  }, [q]);

  // Flatten groups into a single navigable list (for keyboard nav).
  const flat = useMemo<FlatItem[]>(() => {
    const items: FlatItem[] = [];
    for (const p of results.pages) {
      items.push({ group: 'Pages', href: p.href, primary: p.title, secondary: p.description });
    }
    for (const p of results.properties) {
      items.push({
        group: 'Properties',
        href: `/properties/${p.id}`,
        primary: p.name,
        secondary: `${p.address} · ${p.owner_full}`,
        pill: p.is_active ? 'Active' : 'Inactive',
        pillColor: p.is_active ? 'var(--positive)' : 'var(--ink-4)',
      });
    }
    for (const c of results.contacts) {
      items.push({
        group: 'Contacts',
        href: `/crm/${c.id}`,
        primary: c.name,
        secondary: [c.organization, c.emails && c.emails[0]].filter(Boolean).join(' · '),
        pill: CONTACT_TYPE_LABELS[c.type as keyof typeof CONTACT_TYPE_LABELS],
        pillColor: contactTypeColor(c.type),
      });
    }
    for (const s of results.slips) {
      items.push({
        group: 'Work Slips',
        href: `/work/${s.id}`,
        primary: s.title,
        secondary: `${s.property_name}${s.location ? ` · ${s.location}` : ''}`,
        pill: s.priority,
        pillColor: s.priority === 'high' ? 'var(--negative)' : 'var(--ink-4)',
      });
    }
    for (const t of results.tasks) {
      items.push({
        group: 'Tasks',
        href: `/work/tasks/${t.id}`,
        primary: t.title,
        secondary: t.scope === 'corporate' ? 'Corporate' : 'Property',
        pill: t.priority,
        pillColor: t.priority === 'high' ? 'var(--negative)' : 'var(--ink-4)',
      });
    }
    return items;
  }, [results]);

  // Close on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function go(href: string) {
    setOpen(false);
    setQ('');
    router.push(href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flat[highlight];
      if (item) {
        go(item.href);
      } else if (q.trim().length >= 2) {
        // Fallback: full search results page if nothing highlighted.
        go(`/search?q=${encodeURIComponent(q.trim())}`);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  const showDropdown = open && q.trim().length >= 2;
  const groups = groupItems(flat);

  return (
    <div ref={containerRef} style={{ position: 'relative', flex: 1, minWidth: 240 }}>
      <input
        ref={inputRef}
        type="search"
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => q.trim().length >= 2 && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        style={{
          width: '100%',
          padding: '8px 14px',
          border: '1px solid var(--rule)',
          background: 'var(--paper)',
          fontSize: 13,
          color: 'var(--ink)',
          fontFamily: 'inherit',
          outline: 'none',
        }}
      />

      {showDropdown && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 50,
            background: 'var(--paper)',
            border: '1px solid var(--ink)',
            maxHeight: 480,
            overflowY: 'auto',
            boxShadow: '0 12px 32px -16px rgba(30, 46, 52, 0.25)',
          }}
        >
          {loading && flat.length === 0 ? (
            <div style={{ padding: '14px 16px', fontSize: 12, color: 'var(--ink-4)' }}>
              Searching…
            </div>
          ) : flat.length === 0 ? (
            <div style={{ padding: '14px 16px', fontSize: 12, color: 'var(--ink-4)' }}>
              No matches. Press Enter for full results.
            </div>
          ) : (
            <>
              {groups.map(({ name, items, startIndex }) => (
                <div key={name}>
                  <div
                    className="eyebrow"
                    style={{
                      padding: '10px 16px 6px',
                      borderTop: name === groups[0].name ? 'none' : '1px solid var(--rule-soft)',
                    }}
                  >
                    {name}
                  </div>
                  {items.map((item, i) => {
                    const idx = startIndex + i;
                    const active = idx === highlight;
                    return (
                      <button
                        key={`${item.group}-${item.href}-${idx}`}
                        type="button"
                        onMouseEnter={() => setHighlight(idx)}
                        onClick={() => go(item.href)}
                        style={{
                          display: 'flex',
                          width: '100%',
                          alignItems: 'center',
                          gap: 12,
                          padding: '10px 16px',
                          background: active ? 'var(--paper-2)' : 'transparent',
                          border: 'none',
                          borderLeft: active ? '2px solid var(--signal)' : '2px solid transparent',
                          cursor: 'pointer',
                          textAlign: 'left',
                          color: 'inherit',
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: active ? 500 : 400 }}>
                            {item.primary}
                          </div>
                          {item.secondary && (
                            <div
                              style={{
                                marginTop: 2,
                                fontSize: 11,
                                color: 'var(--ink-3)',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {item.secondary}
                            </div>
                          )}
                        </div>
                        {item.pill && item.pillColor && (
                          <span
                            style={{
                              fontSize: 9,
                              fontWeight: 600,
                              letterSpacing: '.16em',
                              textTransform: 'uppercase',
                              color: item.pillColor,
                              border: `1px solid ${item.pillColor}`,
                              padding: '2px 7px',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {item.pill}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
              <div
                style={{
                  padding: '10px 16px',
                  borderTop: '1px solid var(--rule-soft)',
                  fontSize: 11,
                  color: 'var(--ink-4)',
                  letterSpacing: '.08em',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <span>↑↓ to move · ↵ to open · esc to close</span>
                <a
                  href={`/search?q=${encodeURIComponent(q.trim())}`}
                  style={{ color: 'var(--ink-3)', textDecoration: 'none' }}
                >
                  Full results →
                </a>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function groupItems(flat: FlatItem[]): Array<{ name: string; items: FlatItem[]; startIndex: number }> {
  const out: Array<{ name: string; items: FlatItem[]; startIndex: number }> = [];
  let cursor = 0;
  for (const item of flat) {
    const last = out[out.length - 1];
    if (last && last.name === item.group) {
      last.items.push(item);
    } else {
      out.push({ name: item.group, items: [item], startIndex: cursor });
    }
    cursor++;
  }
  return out;
}

function contactTypeColor(type: string): string {
  switch (type) {
    case 'owner': return 'var(--tide-deep)';
    case 'vendor': return 'var(--ink-3)';
    case 'lead': return 'var(--signal)';
    default: return 'var(--ink-4)';
  }
}
