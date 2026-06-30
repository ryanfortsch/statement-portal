'use client';

import { useState } from 'react';

/**
 * W-9 taxpayer-ID field: the type selector (SSN vs EIN) and the number, paired
 * so the number formats and caps to the selected type as you type. SSN renders
 * "123-45-6789", EIN renders "12-3456789", both hard-capped at 9 digits so you
 * can't run on forever. Switching type reformats what's already entered. The
 * server strips non-digits and requires exactly 9, so the dashes are cosmetic.
 */
function formatTin(raw: string, type: 'ssn' | 'ein'): string {
  const d = raw.replace(/\D/g, '').slice(0, 9);
  if (!d) return '';
  if (type === 'ein') {
    // xx-xxxxxxx
    return d.length <= 2 ? d : `${d.slice(0, 2)}-${d.slice(2)}`;
  }
  // ssn: xxx-xx-xxxx
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

export function TinInput({
  labelStyle,
  inputStyle,
}: {
  labelStyle: React.CSSProperties;
  inputStyle: React.CSSProperties;
}) {
  const [type, setType] = useState<'ssn' | 'ein'>('ssn');
  const [value, setValue] = useState('');

  return (
    <>
      <div style={{ flex: 1 }}>
        <label style={labelStyle}>Taxpayer ID type</label>
        <select
          name="w9_tin_type"
          required
          value={type}
          onChange={(e) => {
            const t = e.target.value === 'ein' ? 'ein' : 'ssn';
            setType(t);
            setValue((v) => formatTin(v, t));
          }}
          style={inputStyle}
        >
          <option value="ssn">SSN (individual)</option>
          <option value="ein">EIN (business)</option>
        </select>
      </div>
      <div style={{ flex: 2 }}>
        <label style={labelStyle}>{type === 'ssn' ? 'SSN (9 digits)' : 'EIN (9 digits)'}</label>
        <input
          name="w9_tin"
          type="text"
          required
          inputMode="numeric"
          autoComplete="off"
          placeholder={type === 'ssn' ? '123-45-6789' : '12-3456789'}
          value={value}
          onChange={(e) => setValue(formatTin(e.target.value, type))}
          style={inputStyle}
        />
      </div>
    </>
  );
}
