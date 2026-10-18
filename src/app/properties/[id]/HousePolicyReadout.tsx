import Link from 'next/link';

/**
 * The house policy as the rate plan and the listing record read it, shown
 * where those forms used to carry their own copies. The House policy columns
 * on properties are the one store (src/lib/house-policy.ts); this says what
 * they hold and links to the one place they are edited.
 *
 * No hooks and no server imports, so the client panels can render it.
 */

export type HousePolicyValues = {
  checkout: string | null;
  maxOccupancy: number | null;
  pets: string | null;
  quietHours: string | null;
  cancellation: string | null;
  houseRules: string | null;
};

type FieldKey = keyof HousePolicyValues;

const LABEL: Record<FieldKey, string> = {
  checkout: 'Guest checkout',
  maxOccupancy: 'Max occupancy',
  pets: 'Pets',
  quietHours: 'Quiet hours',
  cancellation: 'Cancellation',
  houseRules: 'House rules',
};

/** Long answers print as "on file" so the line stays one glance. */
function shown(key: FieldKey, v: HousePolicyValues): string | null {
  const raw = v[key];
  if (raw == null || String(raw).trim() === '') return null;
  if (key === 'maxOccupancy') return `${raw} guests`;
  const text = String(raw).trim();
  return text.length > 40 ? 'on file' : text;
}

export function HousePolicyReadout({
  propertyId,
  values,
  fields,
}: {
  propertyId: string;
  values: HousePolicyValues;
  fields: FieldKey[];
}) {
  return (
    <div
      style={{
        borderTop: '1px solid var(--rule)',
        borderBottom: '1px solid var(--rule)',
        padding: '10px 0',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px 18px',
        alignItems: 'baseline',
        fontSize: 12,
        color: 'var(--ink-3)',
      }}
    >
      <span className="eyebrow">House policy</span>
      {fields.map((key) => {
        const value = shown(key, values);
        return (
          <span key={key}>
            {LABEL[key]}:{' '}
            <span style={{ color: value ? 'var(--ink)' : 'var(--signal)' }}>{value ?? 'not set'}</span>
          </span>
        );
      })}
      <Link
        href={`/properties/${propertyId}?tab=facts#policy`}
        style={{ color: 'var(--tide-deep)', textDecoration: 'none', marginLeft: 'auto' }}
      >
        Edit on Facts &rarr;
      </Link>
    </div>
  );
}
