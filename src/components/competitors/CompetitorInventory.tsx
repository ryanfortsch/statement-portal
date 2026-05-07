'use client';

import { useMemo, useState } from 'react';
import type { CompetitorListing } from '@/lib/competitors/types';
import { AddressEditor } from './AddressEditor';

type SortKey = 'name' | 'city' | 'bedrooms' | 'bathrooms' | 'maxGuests' | 'address';
type SortDir = 'asc' | 'desc';

type Props = {
  listings: CompetitorListing[];
  /** Cities sorted by listing count, used to build the filter chip row. */
  cities: string[];
  /** Competitor id used by the inline AddressEditor when persisting overrides. */
  competitorId: string;
};

type AddressFilter = 'all' | 'high' | 'medium' | 'low' | 'unknown';

const GRID_TEMPLATE = '1.1fr 1.1fr 120px 50px 50px 60px 56px 50px 38px';

/**
 * The full inventory table. Filters by town and pet policy, free-text search
 * on the listing name, and sortable columns. Pure client-side — phase 1
 * data is small enough (~66 rows) that we don't need server pagination.
 */
export function CompetitorInventory({ listings, cities, competitorId }: Props) {
  const [city, setCity] = useState<string>('All');
  const [pets, setPets] = useState<'all' | 'yes' | 'no'>('all');
  const [addr, setAddr] = useState<AddressFilter>('all');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('city');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [editingSlug, setEditingSlug] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return listings.filter((l) => {
      if (city !== 'All' && l.city !== city) return false;
      if (pets === 'yes' && !l.petFriendly) return false;
      if (pets === 'no' && l.petFriendly) return false;
      if (addr !== 'all') {
        const conf = l.address?.confidence ?? 'unknown';
        if (conf !== addr) return false;
      }
      if (q) {
        const haystack = [
          l.name,
          l.city,
          l.address?.street ?? '',
          l.address?.neighborhood ?? '',
          l.address?.addressGuess ?? '',
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [listings, city, pets, addr, query]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const addressDisplay = (l: CompetitorListing) =>
      l.address?.addressGuess ?? l.address?.street ?? l.address?.neighborhood ?? '';
    arr.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortKey) {
        case 'name':       return a.name.localeCompare(b.name) * dir;
        case 'city':       return (a.city.localeCompare(b.city) || a.name.localeCompare(b.name)) * dir;
        case 'bedrooms':   return ((a.bedrooms - b.bedrooms) || a.name.localeCompare(b.name)) * dir;
        case 'bathrooms':  return ((a.bathrooms - b.bathrooms) || a.name.localeCompare(b.name)) * dir;
        case 'maxGuests':  return ((a.maxGuests - b.maxGuests) || a.name.localeCompare(b.name)) * dir;
        case 'address':    return (addressDisplay(a).localeCompare(addressDisplay(b)) || a.name.localeCompare(b.name)) * dir;
      }
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const setSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' || key === 'city' ? 'asc' : 'desc');
    }
  };

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 14 }}>Inventory</div>

      {/* FILTER BAR */}
      <div
        style={{
          display: 'flex',
          gap: 24,
          alignItems: 'center',
          flexWrap: 'wrap',
          paddingBottom: 16,
          borderBottom: '1px solid var(--rule)',
          marginBottom: 0,
        }}
      >
        <input
          type="search"
          placeholder="Search name or town..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            flex: '1 1 220px',
            border: 'none',
            borderBottom: '1px solid var(--ink)',
            background: 'transparent',
            padding: '8px 2px',
            fontSize: 14,
            outline: 'none',
            color: 'var(--ink)',
            minWidth: 200,
          }}
        />

        <ChipGroup
          label="Town"
          options={['All', ...cities]}
          value={city}
          onChange={setCity}
        />

        <ChipGroup
          label="Pets"
          options={[
            { value: 'all', label: 'All' },
            { value: 'yes', label: 'Pet OK' },
            { value: 'no',  label: 'No pets' },
          ]}
          value={pets}
          onChange={(v) => setPets(v as 'all' | 'yes' | 'no')}
        />

        <ChipGroup
          label="Address"
          options={[
            { value: 'all',     label: 'All' },
            { value: 'high',    label: 'Verified' },
            { value: 'medium',  label: 'Street' },
            { value: 'low',     label: 'Hood' },
            { value: 'unknown', label: 'Unknown' },
          ]}
          value={addr}
          onChange={(v) => setAddr(v as AddressFilter)}
        />

        <span
          style={{
            fontSize: 11,
            color: 'var(--ink-3)',
            letterSpacing: '.04em',
            marginLeft: 'auto',
          }}
          aria-live="polite"
        >
          {sorted.length} of {listings.length}
        </span>
      </div>

      {/* TABLE */}
      <div role="table" style={{ display: 'block' }}>
        <div
          role="row"
          style={{
            display: 'grid',
            gridTemplateColumns: GRID_TEMPLATE,
            gap: 14,
            padding: '14px 0 10px',
            borderBottom: '1px solid var(--ink)',
            fontSize: 9,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            fontWeight: 600,
          }}
        >
          <SortHeader label="Listing"    active={sortKey === 'name'}      dir={sortDir} onClick={() => setSort('name')} />
          <SortHeader label="Address"    active={sortKey === 'address'}   dir={sortDir} onClick={() => setSort('address')} />
          <SortHeader label="Town"       active={sortKey === 'city'}      dir={sortDir} onClick={() => setSort('city')} />
          <SortHeader label="BR"         active={sortKey === 'bedrooms'}  dir={sortDir} onClick={() => setSort('bedrooms')} align="right" />
          <SortHeader label="BA"         active={sortKey === 'bathrooms'} dir={sortDir} onClick={() => setSort('bathrooms')} align="right" />
          <SortHeader label="Sleeps"     active={sortKey === 'maxGuests'} dir={sortDir} onClick={() => setSort('maxGuests')} align="right" />
          <span style={{ textAlign: 'center' }}>Pets</span>
          <span style={{ textAlign: 'right' }}>Link</span>
          <span style={{ textAlign: 'center' }}>Edit</span>
        </div>

        {sorted.map((l) => {
          const isEditing = editingSlug === l.slug;
          return (
            <div key={l.slug}>
              <div
                role="row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: GRID_TEMPLATE,
                  gap: 14,
                  alignItems: 'baseline',
                  padding: '14px 0',
                  borderBottom: isEditing ? 'none' : '1px solid var(--rule)',
                  fontSize: 13,
                  background: isEditing ? 'var(--paper-2)' : undefined,
                }}
              >
                <span className="font-serif" style={{ fontSize: 16, color: 'var(--ink)' }}>{l.name}</span>
                <AddressCell address={l.address} />
                <span style={{ color: 'var(--ink-3)' }}>{l.city}</span>
                <span className="font-mono tabular-nums" style={{ textAlign: 'right', color: 'var(--ink)' }}>
                  {l.bedrooms === 0 ? <span style={{ fontSize: 11, letterSpacing: '.04em' }}>STD</span> : l.bedrooms}
                </span>
                <span className="font-mono tabular-nums" style={{ textAlign: 'right', color: 'var(--ink)' }}>{formatBath(l.bathrooms)}</span>
                <span className="font-mono tabular-nums" style={{ textAlign: 'right', color: 'var(--ink)' }}>{l.maxGuests}</span>
                <span style={{ textAlign: 'center' }}>
                  {l.petFriendly ? (
                    <span
                      title="Pet friendly"
                      style={{
                        fontSize: 9, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
                        color: 'var(--paper)', background: 'var(--ink)', padding: '2px 7px',
                      }}
                    >
                      Yes
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>—</span>
                  )}
                </span>
                <span style={{ textAlign: 'right' }}>
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      fontSize: 10,
                      letterSpacing: '.18em',
                      textTransform: 'uppercase',
                      color: 'var(--ink)',
                      textDecoration: 'none',
                      borderBottom: '1px solid var(--rule)',
                    }}
                  >
                    View →
                  </a>
                </span>
                <span style={{ textAlign: 'center' }}>
                  <button
                    type="button"
                    onClick={() => setEditingSlug(isEditing ? null : l.slug)}
                    title={isEditing ? 'Cancel' : 'Verify address'}
                    aria-label={isEditing ? 'Cancel verification' : `Verify ${l.name} address`}
                    style={{
                      background: isEditing ? 'var(--ink)' : 'transparent',
                      color: isEditing ? 'var(--paper)' : 'var(--ink-3)',
                      border: '1px solid',
                      borderColor: isEditing ? 'var(--ink)' : 'var(--rule)',
                      padding: '4px 8px',
                      fontSize: 12,
                      cursor: 'pointer',
                      lineHeight: 1,
                      fontFamily: 'inherit',
                    }}
                  >
                    {isEditing ? '×' : '✎'}
                  </button>
                </span>
              </div>

              {isEditing && (
                <AddressEditor
                  competitorId={competitorId}
                  listingSlug={l.slug}
                  listingName={l.name}
                  city={l.city}
                  currentAddress={l.address}
                  onClose={() => setEditingSlug(null)}
                />
              )}
            </div>
          );
        })}

        {sorted.length === 0 && (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink-4)', fontSize: 12 }}>
            No listings match these filters.
          </div>
        )}
      </div>
    </div>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  align = 'left',
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: 'left' | 'right';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        textAlign: align,
        fontSize: 9,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        color: active ? 'var(--ink)' : 'var(--ink-3)',
        fontWeight: active ? 700 : 600,
        fontFamily: 'inherit',
      }}
    >
      {label}{active ? <span style={{ marginLeft: 4 }}>{dir === 'asc' ? '↑' : '↓'}</span> : null}
    </button>
  );
}

function formatBath(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

function AddressCell({ address }: { address?: CompetitorListing['address'] }) {
  if (!address || address.confidence === 'unknown') {
    return <span style={{ color: 'var(--ink-4)', fontSize: 12 }}>—</span>;
  }
  const primary = address.addressGuess ?? address.street ?? address.neighborhood ?? '';
  const sub =
    address.addressGuess && address.neighborhood
      ? address.neighborhood
      : address.street && address.neighborhood && address.street !== address.neighborhood
      ? address.neighborhood
      : null;

  const conf = address.confidence;
  const isUserVerified = !!address.userVerified;
  const chipColor = isUserVerified
    ? 'var(--tide-deep)'
    : conf === 'high' ? 'var(--positive)'
    : conf === 'medium' ? 'var(--ink)'
    : 'var(--ink-4)';
  const chipBg = isUserVerified
    ? 'rgba(46, 92, 110, 0.14)'
    : conf === 'high' ? 'rgba(58, 107, 74, 0.12)'
    : conf === 'medium' ? 'rgba(30, 46, 52, 0.08)'
    : 'transparent';
  const chipBorder = !isUserVerified && conf === 'low' ? '1px dashed var(--ink-4)' : 'none';
  const chipLabel = isUserVerified
    ? '✓ YOU'
    : conf === 'high' ? 'VERIFIED' : conf === 'medium' ? 'STREET' : 'HOOD';

  return (
    <span
      title={address.evidence ?? undefined}
      style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 2 }}
    >
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
        <span
          style={{
            color: 'var(--ink)',
            fontSize: 13,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {primary}
        </span>
        <span
          style={{
            fontSize: 8,
            letterSpacing: '.16em',
            fontWeight: 700,
            color: chipColor,
            background: chipBg,
            border: chipBorder,
            padding: '1px 5px',
            flexShrink: 0,
          }}
        >
          {chipLabel}
        </span>
      </span>
      {sub && (
        <span style={{ fontSize: 11, color: 'var(--ink-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {sub}
        </span>
      )}
      {address.owner && (
        <span
          title={address.ownerNote ?? undefined}
          className="font-serif"
          style={{
            fontSize: 11,
            fontStyle: 'italic',
            color: 'var(--tide-deep)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          owned by {address.owner}
        </span>
      )}
    </span>
  );
}

type ChipOption = string | { value: string; label: string };

function ChipGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ChipOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span className="eyebrow" style={{ fontSize: 9, color: 'var(--ink-4)' }}>{label}</span>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {options.map((opt) => {
          const v = typeof opt === 'string' ? opt : opt.value;
          const text = typeof opt === 'string' ? opt : opt.label;
          const active = v === value;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              style={{
                fontSize: 10,
                letterSpacing: '.12em',
                textTransform: 'uppercase',
                fontWeight: active ? 700 : 500,
                padding: '5px 10px',
                border: '1px solid',
                borderColor: active ? 'var(--ink)' : 'var(--rule)',
                background: active ? 'var(--ink)' : 'var(--paper)',
                color: active ? 'var(--paper)' : 'var(--ink-3)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {text}
            </button>
          );
        })}
      </div>
    </div>
  );
}
