'use client';

/**
 * The homes a contact is linked to, as checkboxes. A multi-select with a
 * "Hold ⌘ to select multiple" hint did the job before; it is unusable on a
 * phone and wrong on Windows. Order is kept as ticked.
 */
export function PropertyCheckboxes({
  properties,
  value,
  onChange,
  disabled = false,
}: {
  properties: Array<{ id: string; name: string }>;
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const ticked = new Set(value);
  return (
    <div
      role="group"
      aria-label="Linked properties"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: '6px 14px',
        maxHeight: 180,
        overflowY: 'auto',
        border: '1px solid var(--rule)',
        padding: '10px 12px',
      }}
    >
      {properties.map((p) => (
        <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)', cursor: disabled ? 'default' : 'pointer' }}>
          <input
            type="checkbox"
            checked={ticked.has(p.id)}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked ? [...value, p.id] : value.filter((id) => id !== p.id))}
          />
          {p.name}
        </label>
      ))}
    </div>
  );
}
