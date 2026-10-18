'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ContactRow, ContactType } from '@/lib/crm';
import { CONTACT_TYPE_LABELS } from '@/lib/crm';
import type { LastTouch } from './page';
import { RefreshCrmButton } from './RefreshCrmButton';
import { NewContactModal } from './NewContactModal';
import { GLOUCESTER_TZ } from '@/lib/stable-time';

/**
 * The CRM list: the contacts ledger, filtered by type and searched. The
 * number triage (unknown Quo numbers, address-book suggestions) moved to
 * /messaging as one card on 2026-10-18, so /crm opens straight on the list.
 */
type PropertyMini = { id: string; name: string };

type Props = {
  contacts: ContactRow[];
  properties: PropertyMini[];
  counts: Record<ContactType | 'all', number>;
  lastTouchByContact: Record<string, LastTouch>;
};

type FilterId = 'all' | ContactType;

export function CrmListClient({ contacts, properties, counts, lastTouchByContact }: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterId>('all');
  const [query, setQuery] = useState('');
  const [showNew, setShowNew] = useState(false);

  const propertyMap = useMemo(() => new Map(properties.map((p) => [p.id, p.name])), [properties]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((c) => {
      if (filter !== 'all' && c.type !== filter) return false;
      if (q) {
        const haystack = [
          c.name,
          c.organization ?? '',
          ...(c.emails ?? []),
          c.phone ?? '',
          ...(c.tags ?? []),
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [contacts, filter, query]);

  return (
    <>
      {/* TAB ROW + SEARCH + NEW */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 16, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Pill active={filter === 'all'} label="All" count={counts.all} onClick={() => setFilter('all')} />
          <Pill active={filter === 'owner'} label="Owners" count={counts.owner} onClick={() => setFilter('owner')} />
          <Pill active={filter === 'vendor'} label="Vendors" count={counts.vendor} onClick={() => setFilter('vendor')} />
          <Pill active={filter === 'lead'} label="Leads" count={counts.lead} onClick={() => setFilter('lead')} accent="var(--signal)" />
          <Pill active={filter === 'other'} label="Other" count={counts.other} onClick={() => setFilter('other')} />
          <span style={{ flex: 1 }} />
          <input
            type="search"
            placeholder="Search name, email, tag…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              minWidth: 240,
              padding: '8px 12px',
              border: '1px solid var(--rule)',
              background: 'var(--paper)',
              fontSize: 13,
              color: 'var(--ink)',
              fontFamily: 'inherit',
            }}
          />
          <RefreshCrmButton />
          <button
            type="button"
            onClick={() => setShowNew(true)}
            style={{
              background: 'var(--ink)',
              color: 'var(--paper)',
              border: '1px solid var(--ink)',
              padding: '8px 14px',
              fontSize: 11,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            New contact
          </button>
        </div>
      </section>

      {/* LIST */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        {filtered.length === 0 ? (
          <div
            style={{
              borderTop: '1px solid var(--ink)',
              padding: '40px 0',
              textAlign: 'center',
              color: 'var(--ink-3)',
            }}
          >
            {contacts.length === 0
              ? 'No contacts yet. New contact adds one.'
              : 'No contacts match this filter.'}
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {filtered.map((c) => (
              <Link
                key={c.id}
                href={`/crm/${c.id}`}
                style={{
                  display: 'block',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto auto',
                    gap: 24,
                    alignItems: 'baseline',
                    padding: '20px 0',
                    borderBottom: '1px solid var(--rule)',
                  }}
                >
                  <div>
                    <h2 className="font-serif" style={{ fontSize: 20, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
                      {c.name}
                    </h2>
                    <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)' }}>
                      {c.organization && <>{c.organization} · </>}
                      {c.emails && c.emails.length > 0 ? c.emails[0] : ''}
                      {c.linked_property_ids && c.linked_property_ids.length > 0 && (
                        <>
                          {' · '}
                          {c.linked_property_ids
                            .map((pid) => propertyMap.get(pid) ?? pid)
                            .join(', ')}
                        </>
                      )}
                    </div>
                    {lastTouchByContact[c.id] && (
                      <div suppressHydrationWarning style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em' }}>
                        <span style={{ color: 'var(--tide-deep)', fontWeight: 600 }}>{lastTouchByContact[c.id].channel}</span>
                        {' · '}
                        &ldquo;{truncate(lastTouchByContact[c.id].summary, 80)}&rdquo;
                        {' · '}
                        {formatRelative(lastTouchByContact[c.id].at)}
                      </div>
                    )}
                  </div>
                  <span
                    style={{
                      fontSize: 9, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
                      color: typeColor(c.type),
                      border: `1px solid ${typeColor(c.type)}`,
                      padding: '2px 8px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {CONTACT_TYPE_LABELS[c.type]}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.18em', textTransform: 'uppercase' }}>
                    Open →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {showNew && (
        <NewContactModal
          properties={properties}
          // The type pill that is on picks the type; a vendor otherwise.
          initialType={filter === 'all' ? undefined : filter}
          onClose={() => setShowNew(false)}
          onCreated={(id) => {
            setShowNew(false);
            router.push(`/crm/${id}`);
          }}
        />
      )}

    </>
  );
}

function Pill({
  active,
  label,
  count,
  onClick,
  accent,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
  accent?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? 'var(--ink)' : 'transparent',
        color: active ? 'var(--paper)' : (accent ?? 'var(--ink)'),
        border: `1px solid ${active ? 'var(--ink)' : (accent ?? 'var(--rule)')}`,
        padding: '6px 14px',
        fontSize: 11,
        letterSpacing: '.14em',
        textTransform: 'uppercase',
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      {label} <span style={{ opacity: 0.7, marginLeft: 4 }}>{count}</span>
    </button>
  );
}

function typeColor(type: ContactType): string {
  switch (type) {
    case 'owner': return 'var(--tide-deep)';
    case 'vendor': return 'var(--ink-3)';
    case 'lead': return 'var(--signal)';
    case 'other': return 'var(--ink-4)';
  }
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n).trim()}…` : s;
}

function formatRelative(iso: string): string {
  try {
    const then = new Date(iso);
    const diffMs = Date.now() - then.getTime();
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: GLOUCESTER_TZ });
  } catch {
    return iso;
  }
}

