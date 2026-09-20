'use client';

import { useState } from 'react';

/** The search controls. A plain GET form so every result is a shareable URL
 *  and the back button behaves. */
export function PaymentsSearchForm({
  properties,
  initial,
}: {
  properties: { id: string; name: string }[];
  initial: {
    email: string;
    q: string;
    propertyId: string;
    from: string;
    to: string;
    includeUnsuccessful: boolean;
  };
}) {
  const [includeUnsuccessful, setIncludeUnsuccessful] = useState(initial.includeUnsuccessful);
  const input: React.CSSProperties = {
    border: '1px solid var(--ink-3)',
    background: 'var(--paper)',
    color: 'var(--ink)',
    padding: '10px 12px',
    fontSize: 14,
    width: '100%',
  };
  const label: React.CSSProperties = { display: 'block', marginBottom: 6, color: 'var(--ink-3)' };

  return (
    <form method="GET" style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', alignItems: 'end' }}>
      <div>
        <span className="eyebrow" style={label}>Guest email</span>
        <input type="email" name="email" defaultValue={initial.email} placeholder="guest@example.com" style={input} />
      </div>
      <div>
        <span className="eyebrow" style={label}>Name or description</span>
        <input type="text" name="q" defaultValue={initial.q} placeholder="a surname, or Good Harbor" style={input} />
      </div>
      <div>
        <span className="eyebrow" style={label}>Home</span>
        <select name="property_id" defaultValue={initial.propertyId} style={input}>
          <option value="">Every home</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <div>
        <span className="eyebrow" style={label}>From</span>
        <input type="date" name="from" defaultValue={initial.from} style={input} />
      </div>
      <div>
        <span className="eyebrow" style={label}>To</span>
        <input type="date" name="to" defaultValue={initial.to} style={input} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-3)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            name="include_unsuccessful"
            value="1"
            checked={includeUnsuccessful}
            onChange={(e) => setIncludeUnsuccessful(e.target.checked)}
          />
          Include failed and refunded
        </label>
        <button
          type="submit"
          style={{
            background: 'var(--ink)',
            color: 'var(--paper)',
            border: '2px solid var(--ink)',
            padding: '11px 20px',
            fontSize: 12,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Search
        </button>
      </div>
    </form>
  );
}
