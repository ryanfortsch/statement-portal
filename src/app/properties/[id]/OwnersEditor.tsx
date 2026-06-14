'use client';

import { useState, useTransition } from 'react';
import { saveOwnerCards, type OwnerCard } from '@/app/properties/actions';

/**
 * Inline editor for the structured `owners` array on a property.
 *
 * Renders one card per owner (first/last/email/phone/role + primary
 * toggle) with add/remove. Saves the whole array via the server action;
 * server-side normalization handles E.164 phone formatting + empty-card
 * pruning. Sits below the existing Owner collapsible section on the
 * property detail page and feeds the Owner Messaging pipeline through
 * the stay-concierge sync endpoint.
 *
 * The existing `owner_full` / `owner_emails` scalars are NOT touched by
 * this component — they remain the source of truth for statements and
 * contracts. The structured owners array is additive: it's how we tie
 * an inbound owner SMS or email back to a property.
 */
export function OwnersEditor({
  propertyId,
  initialOwners,
}: {
  propertyId: string;
  initialOwners: OwnerCard[];
}) {
  const [owners, setOwners] = useState<OwnerCard[]>(
    initialOwners.length > 0 ? initialOwners : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isDirty = JSON.stringify(owners) !== JSON.stringify(initialOwners);

  const update = (i: number, patch: Partial<OwnerCard>) => {
    setOwners((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  };

  const remove = (i: number) => {
    setOwners((prev) => prev.filter((_, idx) => idx !== i));
  };

  const add = () => {
    setOwners((prev) => [
      ...prev,
      {
        first_name: '',
        last_name: '',
        email: '',
        phone: '',
        is_primary: prev.length === 0,
        role: 'owner',
        notes: '',
      },
    ]);
  };

  const setPrimary = (i: number) => {
    setOwners((prev) =>
      prev.map((o, idx) => ({ ...o, is_primary: idx === i })),
    );
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await saveOwnerCards(propertyId, owners);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOwners(res.owners);
      setSavedAt(new Date().toLocaleTimeString());
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 620 }}>
          The primary card auto-syncs from the Owner block above on every
          save (name, phone, first email), so you only ever have to enter
          that info once. Add cards here for additional contacts: a
          spouse with their own cell, an accountant copied on replies, a
          second phone for the same person.
        </div>
        <button
          type="button"
          onClick={add}
          style={pillButton('outlined')}
        >
          + Add contact
        </button>
      </div>

      {owners.length === 0 && (
        <div
          style={{
            border: '1px dashed var(--rule)',
            padding: '16px 18px',
            fontSize: 12,
            color: 'var(--ink-4)',
          }}
        >
          No primary owner derived yet. Fill in Owner / Phone / Emails in
          the block above and save, or add a contact here directly.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {owners.map((o, i) => (
          <div
            key={i}
            style={{
              border: '1px solid var(--rule)',
              padding: '14px 16px',
              background: o.is_primary ? 'var(--paper-2)' : 'var(--paper)',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '10px 16px',
            }}
          >
            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <span className="eyebrow" style={{ color: 'var(--ink-3)' }}>
                {o.is_primary ? 'Primary (auto-synced)' : `Additional ${i}`}
              </span>
              <div style={{ display: 'flex', gap: 12 }}>
                {!o.is_primary && (
                  <button type="button" onClick={() => setPrimary(i)} style={linkButton}>
                    make primary
                  </button>
                )}
                {!o.is_primary && (
                  <button type="button" onClick={() => remove(i)} style={linkButton}>
                    remove
                  </button>
                )}
              </div>
            </div>

            {o.is_primary && (
              <div style={{
                gridColumn: '1 / -1',
                fontSize: 11,
                color: 'var(--ink-4)',
                lineHeight: 1.5,
                marginTop: -4,
              }}>
                Name, phone, and email come from the Owner block above. Edit
                there to change them, not here.
              </div>
            )}

            <Field
              label="First name"
              value={o.first_name}
              onChange={(v) => update(i, { first_name: v })}
              placeholder="Simon"
              disabled={o.is_primary}
            />
            <Field
              label="Last name"
              value={o.last_name}
              onChange={(v) => update(i, { last_name: v })}
              placeholder="Prudenzi"
              disabled={o.is_primary}
            />
            <Field
              label="Email"
              value={o.email}
              onChange={(v) => update(i, { email: v })}
              placeholder="simon@example.com"
              type="email"
              disabled={o.is_primary}
            />
            <Field
              label="Phone"
              value={o.phone}
              onChange={(v) => update(i, { phone: v })}
              placeholder="+19782658548"
              type="tel"
              disabled={o.is_primary}
            />
            <Field
              label="Role"
              value={o.role}
              onChange={(v) => update(i, { role: v })}
              placeholder="owner"
            />
            <Field
              label="Notes (optional)"
              value={o.notes}
              onChange={(v) => update(i, { notes: v })}
              placeholder="best reached evenings"
            />
          </div>
        ))}
      </div>

      {error && (
        <div role="alert" style={{ fontSize: 12, color: 'var(--signal)', fontWeight: 500 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          onClick={save}
          disabled={!isDirty || isPending}
          style={{
            ...pillButton('primary'),
            opacity: !isDirty || isPending ? 0.5 : 1,
            cursor: !isDirty || isPending ? 'not-allowed' : 'pointer',
          }}
        >
          {isPending ? 'Saving…' : 'Save owners'}
        </button>
        {savedAt && !isDirty && (
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>saved at {savedAt}</span>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="eyebrow" style={{ color: 'var(--ink-4)', fontSize: 9 }}>
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        style={{
          fontFamily: 'inherit',
          fontSize: 13,
          color: disabled ? 'var(--ink-3)' : 'var(--ink)',
          background: disabled ? 'transparent' : 'var(--paper)',
          border: '1px solid var(--rule)',
          padding: '6px 8px',
          cursor: disabled ? 'not-allowed' : 'text',
        }}
      />
    </label>
  );
}

function pillButton(variant: 'primary' | 'outlined'): React.CSSProperties {
  return {
    fontSize: 11,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    fontWeight: 600,
    padding: '7px 14px',
    border: '1px solid var(--ink)',
    background: variant === 'primary' ? 'var(--ink)' : 'var(--paper)',
    color: variant === 'primary' ? 'var(--paper)' : 'var(--ink)',
    cursor: 'pointer',
  };
}

const linkButton: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  fontWeight: 500,
  color: 'var(--ink-3)',
  background: 'transparent',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
};
