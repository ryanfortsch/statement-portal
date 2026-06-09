'use client';

import { useState } from 'react';
import type { Owner } from '@/lib/projections-types';

/**
 * Stacked owner cards inside the prospect form. Starts with one card; an
 * "Add owner" button stamps additional cards (couples, families). Each card's
 * inputs use indexed names like `owners[0][first_name]` so the server action
 * can rebuild an Owner[] array from FormData.
 */
export function OwnersSection({ initial }: { initial: Owner[] }) {
  const [owners, setOwners] = useState<Owner[]>(
    initial.length > 0
      ? initial
      : [{ first_name: '', last_name: '', email: null, phone: null, full_legal: null }],
  );

  function patch(i: number, p: Partial<Owner>) {
    setOwners((prev) => prev.map((o, j) => (i === j ? { ...o, ...p } : o)));
  }

  function add() {
    setOwners((prev) => [
      ...prev,
      { first_name: '', last_name: '', email: null, phone: null, full_legal: null },
    ]);
  }

  function remove(i: number) {
    setOwners((prev) => prev.filter((_, j) => j !== i));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {owners.map((o, i) => (
        <OwnerCard
          key={i}
          index={i}
          owner={o}
          isFirst={i === 0}
          showRemove={owners.length > 1}
          onChange={(p) => patch(i, p)}
          onRemove={() => remove(i)}
        />
      ))}
      <div>
        <button
          type="button"
          onClick={add}
          style={{
            background: 'transparent',
            color: 'var(--ink)',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            padding: '11px 18px',
            border: '1px solid var(--ink)',
            cursor: 'pointer',
          }}
        >
          + Add owner
        </button>
      </div>
    </div>
  );
}

function OwnerCard({
  index,
  owner,
  isFirst,
  showRemove,
  onChange,
  onRemove,
}: {
  index: number;
  owner: Owner;
  isFirst: boolean;
  showRemove: boolean;
  onChange: (patch: Partial<Owner>) => void;
  onRemove: () => void;
}) {
  const prefix = `owners[${index}]`;
  return (
    <div
      style={{
        border: '1px solid var(--rule)',
        padding: '18px 20px',
        background: 'var(--paper-2)',
      }}
    >
      <div className="flex items-baseline justify-between" style={{ marginBottom: 12 }}>
        <div className="eyebrow">
          {isFirst ? 'Primary owner' : `Owner ${index + 1}`}
          {isFirst && (
            <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--ink-4)', fontStyle: 'italic', letterSpacing: '0.04em', textTransform: 'none' }}>
              used as the contract signatory + Gmail sync key
            </span>
          )}
        </div>
        {showRemove && (
          <button
            type="button"
            onClick={onRemove}
            style={{
              background: 'transparent',
              color: 'var(--ink-4)',
              fontSize: 10,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              padding: '4px 8px',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Remove
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="First name" required>
          <input
            name={`${prefix}[first_name]`}
            required
            value={owner.first_name}
            onChange={(e) => onChange({ first_name: e.target.value })}
            placeholder="Bethany"
            style={inputStyle}
          />
        </Field>
        <Field label="Last name" required>
          <input
            name={`${prefix}[last_name]`}
            required
            value={owner.last_name}
            onChange={(e) => onChange({ last_name: e.target.value })}
            placeholder="Giblin"
            style={inputStyle}
          />
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <Field label="Email" hint={isFirst ? 'Gmail sync uses every owner’s email' : undefined}>
          <input
            name={`${prefix}[email]`}
            type="email"
            value={owner.email ?? ''}
            onChange={(e) => onChange({ email: e.target.value || null })}
            placeholder="bethany@example.com"
            style={inputStyle}
          />
        </Field>
        <Field label="Phone">
          <input
            name={`${prefix}[phone]`}
            type="tel"
            inputMode="tel"
            value={owner.phone ?? ''}
            onChange={(e) => {
              const next = formatPhoneInput(e.target.value);
              onChange({ phone: next || null });
            }}
            placeholder="(978) 555 1234"
            style={inputStyle}
          />
        </Field>
      </div>

      {isFirst && (
        <div style={{ marginTop: 12 }}>
          <Field label="Full legal name (optional)" hint="Defaults to first + last; override only if different from above (e.g. maiden name)">
            <input
              name={`${prefix}[full_legal]`}
              value={owner.full_legal ?? ''}
              onChange={(e) => onChange({ full_legal: e.target.value || null })}
              placeholder=""
              style={inputStyle}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

// ─── Layout primitives (mirrors ProjectionForm.tsx so they look the same) ───
function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="eyebrow">
        {label}
        {required && <span style={{ color: 'var(--signal)', marginLeft: 4 }}>*</span>}
      </span>
      {children}
      {hint && <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{hint}</span>}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  color: 'var(--ink)',
  fontSize: 14,
  fontWeight: 400,
  padding: '10px 12px',
  outline: 'none',
  width: '100%',
};

/**
 * Live-format a phone input as the user types into the format Dotti
 * uses on the new-prospect form: "(413) 519 9986" — paren around the
 * area code, space between exchange and line, no dash.
 *
 * Reformat-from-digits approach: strip non-digits, drop a leading
 * country-code 1 if exactly 11 digits, take the first 10, and rebuild
 * the parenthesized form per length bracket. Works for both forward
 * typing and backspace because we never re-introduce a digit the user
 * deleted — we always reformat from the current digit string.
 */
function formatPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  const trimmed = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  const ten = trimmed.slice(0, 10);
  if (ten.length === 0) return '';
  if (ten.length <= 3) return `(${ten}`;
  if (ten.length <= 6) return `(${ten.slice(0, 3)}) ${ten.slice(3)}`;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)} ${ten.slice(6)}`;
}
