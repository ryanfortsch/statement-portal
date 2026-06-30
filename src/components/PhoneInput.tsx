'use client';

import { useState } from 'react';
import { formatUsPhone } from '@/lib/phone';

/**
 * Phone field that formats to the house style "(xxx) yyy-zzzz" live as you
 * type. Progressive: shows "(917", then "(917) 287", then "(917) 287-9285".
 * Pasting an 11-digit number with a leading 1 drops the 1. Submits a plain
 * <input name=...> so server actions read it unchanged.
 */
function progressive(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  d = d.slice(0, 10);
  if (!d) return '';
  if (d.length < 4) return `(${d}`;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export function PhoneInput({
  name,
  defaultValue,
  placeholder,
  required,
  style,
}: {
  name: string;
  defaultValue?: string | null;
  placeholder?: string;
  required?: boolean;
  style?: React.CSSProperties;
}) {
  const [value, setValue] = useState(() => formatUsPhone(defaultValue));
  return (
    <input
      name={name}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      required={required}
      placeholder={placeholder}
      value={value}
      onChange={(e) => setValue(progressive(e.target.value))}
      style={style}
    />
  );
}
