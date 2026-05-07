'use client';

import { useState, useTransition } from 'react';
import type { AddressMatch } from '@/lib/competitors/types';
import { setListingAddress, clearListingAddress } from '@/app/competitors/actions';

type Props = {
  competitorId: string;
  listingSlug: string;
  listingName: string;
  city: string;
  currentAddress: AddressMatch | undefined;
  onClose: () => void;
};

/**
 * Inline editor for a competitor listing's verified address. Renders below
 * a row in the inventory table. Pre-fills from whatever the read-merge
 * surfaced (DB override > static research > nothing) so a user can iterate
 * on a partial guess without retyping everything.
 *
 * Submits via server action; on success the page revalidates and the
 * parent collapses this back into the row. Errors stay visible.
 */
export function AddressEditor({
  competitorId,
  listingSlug,
  listingName,
  city,
  currentAddress,
  onClose,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await setListingAddress(competitorId, listingSlug, formData);
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  async function onClear() {
    if (!confirm('Remove the user-verified address? Listing will revert to the research overlay.')) return;
    setError(null);
    startTransition(async () => {
      try {
        await clearListingAddress(competitorId, listingSlug);
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  const vgsiUrl = vgsiUrlForCity(city);

  return (
    <form
      action={onSubmit}
      style={{
        gridColumn: '1 / -1',
        background: 'var(--paper-2)',
        border: '1px solid var(--ink)',
        padding: '20px 24px',
        marginBottom: 12,
        marginTop: -1,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div className="eyebrow" style={{ color: 'var(--signal)', marginBottom: 4 }}>
            Verify address
          </div>
          <div className="font-serif" style={{ fontSize: 18, color: 'var(--ink)' }}>
            {listingName} <span style={{ color: 'var(--ink-3)' }}>· {city}</span>
          </div>
        </div>

        {vgsiUrl && (
          <a
            href={vgsiUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: 10,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              fontWeight: 500,
              color: 'var(--ink)',
              textDecoration: 'none',
              border: '1px solid var(--ink)',
              padding: '6px 12px',
              background: 'var(--paper)',
              whiteSpace: 'nowrap',
            }}
          >
            Open VGSI for {city} →
          </a>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 14,
        }}
      >
        <Field
          name="address_line"
          label="Full address (required)"
          defaultValue={currentAddress?.addressGuess ?? ''}
          placeholder="2 Eastern Point Blvd, Gloucester, MA 01930"
          required
          fullWidth
        />
        <Field
          name="street"
          label="Street"
          defaultValue={currentAddress?.street ?? ''}
          placeholder="Eastern Point Blvd"
        />
        <Field
          name="neighborhood"
          label="Neighborhood"
          defaultValue={currentAddress?.neighborhood ?? ''}
          placeholder="Eastern Point, East Gloucester"
        />
        <Field
          name="owner"
          label="Owner of record (per VGSI)"
          defaultValue={currentAddress?.owner ?? ''}
          placeholder="Mcavoy, Elizabeth K"
        />
        <Field
          name="owner_note"
          label="Owner note"
          defaultValue={currentAddress?.ownerNote ?? ''}
          placeholder="LLC owned by John Smith per Sec of State filing"
        />
        <Field
          name="evidence"
          label="Source / evidence"
          defaultValue={
            currentAddress?.userVerified ? currentAddress?.evidence ?? '' : ''
          }
          placeholder="VGSI parcel #134-22, accessed 2026-05-07"
          fullWidth
        />
      </div>

      {error && (
        <div
          style={{
            background: 'var(--paper)',
            border: '1px solid var(--negative)',
            borderLeft: '3px solid var(--negative)',
            color: 'var(--negative)',
            padding: '8px 12px',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="submit"
          disabled={isPending}
          style={{
            fontSize: 11,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            fontWeight: 600,
            padding: '8px 16px',
            background: 'var(--ink)',
            color: 'var(--paper)',
            border: '1px solid var(--ink)',
            cursor: isPending ? 'not-allowed' : 'pointer',
            opacity: isPending ? 0.6 : 1,
            fontFamily: 'inherit',
          }}
        >
          {isPending ? 'Saving…' : 'Save verified address'}
        </button>

        <button
          type="button"
          onClick={onClose}
          disabled={isPending}
          style={{
            fontSize: 11,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            padding: '8px 14px',
            background: 'transparent',
            color: 'var(--ink-3)',
            border: '1px solid var(--rule)',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Cancel
        </button>

        {currentAddress?.userVerified && (
          <button
            type="button"
            onClick={onClear}
            disabled={isPending}
            style={{
              fontSize: 11,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              padding: '8px 14px',
              background: 'transparent',
              color: 'var(--negative)',
              border: '1px solid var(--negative)',
              cursor: 'pointer',
              marginLeft: 'auto',
              fontFamily: 'inherit',
            }}
          >
            Remove verification
          </button>
        )}
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  defaultValue,
  placeholder,
  required,
  fullWidth,
}: {
  name: string;
  label: string;
  defaultValue: string;
  placeholder?: string;
  required?: boolean;
  fullWidth?: boolean;
}) {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        gridColumn: fullWidth ? '1 / -1' : 'auto',
      }}
    >
      <span className="eyebrow" style={{ fontSize: 9, color: 'var(--ink-3)' }}>
        {label}
      </span>
      <input
        type="text"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        style={{
          border: 'none',
          borderBottom: '1px solid var(--ink)',
          background: 'transparent',
          padding: '6px 2px',
          fontSize: 14,
          color: 'var(--ink)',
          outline: 'none',
          fontFamily: 'inherit',
        }}
      />
    </label>
  );
}

const VGSI_TOWN_SLUGS: Record<string, string> = {
  Gloucester: 'gloucesterma',
  Rockport: 'rockportma',
  Beverly: 'beverlyma',
  'Manchester-by-the-Sea': 'manchesterma',
  Salem: 'salemma',
  Marblehead: 'marbleheadma',
  Essex: 'essexma',
  Newbury: 'newburyma',
  Ipswich: 'ipswichma',
};

function vgsiUrlForCity(city: string): string | null {
  const slug = VGSI_TOWN_SLUGS[city];
  if (!slug) return 'https://www.vgsi.com/massachusetts-online-database/';
  return `https://gis.vgsi.com/${slug}/`;
}
