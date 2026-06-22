import Link from 'next/link';

/**
 * Shared form for creating + editing an internal property note. Server
 * component — the action prop is wired by the caller (createPropertyNote
 * for /notes/new, updatePropertyNote.bind(null, id) for the edit page).
 *
 * Mirrors NoticeEditorForm for visual consistency, but the field set
 * is different: notes have an optional `tag` for free-form
 * categorization ("hvac", "plumbing", "neighbor") rather than the
 * notice's `eyebrow` headline kicker. Body is also optional — a title
 * alone is a valid note (e.g. "Fireplace flue sticks. Wiggle to open.").
 */
export function NoteEditorForm({
  action,
  propertyId,
  initial,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void> | void;
  propertyId: string;
  initial?: { title?: string | null; body?: string | null; tag?: string | null; guest_facing?: boolean | null };
  submitLabel: string;
}) {
  return (
    <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <Field label="Title" required hint="The headline. One line. Used as the card title in the Property Notes accordion.">
        <input
          name="title"
          type="text"
          required
          maxLength={140}
          defaultValue={initial?.title ?? ''}
          placeholder="Fireplace flue sticks open"
          style={inputStyle}
        />
      </Field>

      <Field
        label="Body"
        hint="Optional. The detail — how to handle it, history, anything a new operator should know."
      >
        <textarea
          name="body"
          rows={6}
          maxLength={4000}
          defaultValue={initial?.body ?? ''}
          placeholder={'Wiggle the handle a few times to seat it. Don\'t force it.'}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
        />
      </Field>

      <Field
        label="Tag"
        hint="Optional. Free-form category for filtering — e.g. hvac, plumbing, exterior, vendor, neighbor."
      >
        <input
          name="tag"
          type="text"
          maxLength={40}
          defaultValue={initial?.tag ?? ''}
          placeholder="hvac"
          style={inputStyle}
        />
      </Field>

      <label
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
          cursor: 'pointer',
          border: '1px solid var(--rule)',
          padding: '14px 16px',
        }}
      >
        <input
          name="guest_facing"
          type="checkbox"
          defaultChecked={initial?.guest_facing ?? false}
          style={{ marginTop: 2, width: 16, height: 16, accentColor: 'var(--tide-deep)', flexShrink: 0 }}
        />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--ink)',
            }}
          >
            Guest-facing knowledge
          </span>
          <span style={{ fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.5 }}>
            Add this to the guest-messaging knowledge base — something a guest would be told (a quirk of
            the home, a local tip). Leave unchecked for internal ops only your team should see.
          </span>
        </span>
      </label>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
        <button type="submit" style={primaryButtonStyle}>
          {submitLabel}
        </button>
        <Link href={`/properties/${propertyId}`} style={secondaryLinkStyle}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

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
      <span
        className="eyebrow"
        style={{
          fontSize: 10,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
          fontWeight: 600,
        }}
      >
        {label}
        {required ? <span style={{ color: 'var(--negative)', marginLeft: 4 }}>*</span> : null}
      </span>
      {children}
      {hint ? (
        <span style={{ fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.5 }}>{hint}</span>
      ) : null}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid var(--rule)',
  borderBottom: '1px solid var(--ink)',
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 14,
  padding: '10px 12px',
  outline: 'none',
  boxSizing: 'border-box',
};

const primaryButtonStyle: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '13px 22px',
  border: '1px solid var(--ink)',
  cursor: 'pointer',
};

const secondaryLinkStyle: React.CSSProperties = {
  color: 'var(--ink-3)',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '13px 14px',
  textDecoration: 'none',
};
