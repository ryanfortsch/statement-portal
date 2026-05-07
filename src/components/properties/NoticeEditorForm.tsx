import Link from 'next/link';

/**
 * Shared form for creating + editing a bespoke property notice. Server
 * component — the action prop is wired to a server action by the caller
 * (createNotice for /notices/new, updateNotice.bind(null, id) for the
 * edit page). Mirrors the visual language of the property edit form so
 * authoring a notice feels like part of the same Helm shell.
 *
 * `submitLabel` lets us say "Create notice" vs. "Save changes" without
 * the form needing to know which mode it's in.
 */
export function NoticeEditorForm({
  action,
  propertyId,
  initial,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void> | void;
  propertyId: string;
  initial?: { eyebrow?: string | null; title?: string | null; body?: string | null };
  submitLabel: string;
}) {
  return (
    <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <Field
        label="Eyebrow"
        hint="Optional. Short kicker that sits above the title — e.g. “Bathroom”, “Please note”, “Parking”."
      >
        <input
          name="eyebrow"
          type="text"
          maxLength={40}
          defaultValue={initial?.eyebrow ?? ''}
          placeholder="Bathroom"
          style={inputStyle}
        />
      </Field>

      <Field label="Title" required hint="The headline. Set in serif, big — make it readable from across the room.">
        <input
          name="title"
          type="text"
          required
          maxLength={120}
          defaultValue={initial?.title ?? ''}
          placeholder="Please run the fan during showers."
          style={inputStyle}
        />
      </Field>

      <Field
        label="Body"
        required
        hint="The explanation. One or two short paragraphs; separate paragraphs with a blank line. Aim for a couple sentences total — anything longer overflows a 4 × 6 placard."
      >
        <textarea
          name="body"
          required
          rows={8}
          maxLength={1200}
          defaultValue={initial?.body ?? ''}
          placeholder={
            'The button may not depress, but the fan still runs and shuts off automatically a few minutes after you finish.\n\nLeaving it off causes moisture damage to the ceiling.'
          }
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
        />
      </Field>

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
