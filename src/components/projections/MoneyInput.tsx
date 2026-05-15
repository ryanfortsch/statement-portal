'use client';

import { useState } from 'react';

/**
 * Dollar-value input that formats with thousands separators as the user
 * types. Dotti's complaint: "you're not sure how many zeros you put in"
 * when typing $850000 — commas fix that.
 *
 * Submits the raw digits (with commas) as a text value. The server-side
 * `num()` / `numOrNull()` parsers in src/app/projections/actions.ts
 * already strip "$" and "," so "$850,000" → 850000 cleanly. Using
 * inputmode="numeric" pops the number pad on mobile but keeps the
 * input as text so we can render commas.
 *
 * Mirrors the existing money cluster (wrap + "$" prefix + input) so the
 * design language stays identical to the previous bare `<input
 * type="number">` version.
 */
export function MoneyInput({
  name,
  defaultValue,
  required,
  placeholder,
  min,
  // step exists for parity with the previous numeric input API but is
  // unused now that this is a text input — kept so callers don't have to
  // change their props.
  step: _step,
}: {
  name: string;
  defaultValue?: string | number | null;
  required?: boolean;
  placeholder?: string;
  min?: number;
  step?: number;
}) {
  const [raw, setRaw] = useState<string>(() => {
    if (defaultValue === undefined || defaultValue === null || defaultValue === '') return '';
    const n = Number(String(defaultValue).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? String(Math.round(n)) : '';
  });

  const formatted = formatWithCommas(raw);

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Strip everything that isn't a digit so paste-of-"$850,000" works
    // and so accidental letters can't sneak in.
    const digitsOnly = e.target.value.replace(/[^0-9]/g, '');
    if (typeof min === 'number' && digitsOnly !== '' && Number(digitsOnly) < min) {
      setRaw(String(min));
    } else {
      setRaw(digitsOnly);
    }
  }

  return (
    <div style={moneyWrapStyle}>
      <span style={moneyPrefixStyle} aria-hidden="true">$</span>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        name={name}
        required={required}
        placeholder={placeholder}
        value={formatted}
        onChange={onChange}
        style={moneyInputStyle}
      />
    </div>
  );
}

function formatWithCommas(digits: string): string {
  if (!digits) return '';
  // Insert thousands separators by reversing, chunking, and reversing back.
  // Avoids Intl.NumberFormat to keep the empty / partial-typed state intact
  // (e.g. "8" stays "8", not "0").
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Re-declare here so the component is self-contained — the styles in
// ProjectionForm.tsx aren't exported, and matching them keeps every
// money field visually identical.
const moneyWrapStyle: React.CSSProperties = {
  position: 'relative',
  display: 'block',
  width: '100%',
};
const moneyPrefixStyle: React.CSSProperties = {
  position: 'absolute',
  left: 12,
  top: '50%',
  transform: 'translateY(-50%)',
  fontSize: 14,
  color: 'var(--ink-3)',
  pointerEvents: 'none',
  fontFamily: 'var(--font-fraunces), "Times New Roman", serif',
};
const moneyInputStyle: React.CSSProperties = {
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  color: 'var(--ink)',
  fontSize: 14,
  fontWeight: 400,
  padding: '10px 12px 10px 24px',
  outline: 'none',
  width: '100%',
};
