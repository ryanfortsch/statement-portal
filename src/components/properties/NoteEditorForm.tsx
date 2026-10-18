import { RetainedPropertyForm } from './RetainedPropertyForm';

/**
 * Shared form for creating + editing a property note. Server content with a
 * recoverable client form wrapper. The action prop is wired by the caller
 * (createPropertyNote for /notes/new, updatePropertyNote.bind(null, id) for
 * the edit page).
 *
 * A note is a FACT (what we know: What we know on Facts, and the Guest KB
 * when ticked; never resolved) or an ISSUE (something to fix: Flagged at the
 * house on Now, resolved when fixed). Body and tag are optional; a title
 * alone is a valid note ("Fireplace flue sticks. Wiggle to open.").
 */
export function NoteEditorForm({
  action,
  propertyId,
  initial,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void> | void;
  propertyId: string;
  initial?: { title?: string | null; body?: string | null; tag?: string | null; guest_facing?: boolean | null; kind?: 'fact' | 'issue' | null };
  submitLabel: string;
}) {
  const kind = initial?.kind ?? 'fact';
  return (
    <RetainedPropertyForm action={action} submitLabel={submitLabel} buttonStyle={primaryButtonStyle} cancelHref={kind === 'issue' ? `/properties/${propertyId}?tab=now` : `/properties/${propertyId}?tab=facts`} style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <legend
          className="eyebrow"
          style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 600, marginBottom: 8 }}
        >
          This is
        </legend>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          <KindOption value="fact" checked={kind === 'fact'} title="A fact" detail="Stays true: a quirk, a workaround, a vendor, a local tip. Listed in What we know on Facts." />
          <KindOption value="issue" checked={kind === 'issue'} title="An issue" detail="Needs fixing. Listed in Flagged at the house on Now until someone resolves it." />
        </div>
      </fieldset>

      <Field label="Title" required hint="One line, the way it reads in the list.">
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
        hint="Optional. The detail: how to handle it, history, anything a new operator should know."
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
        hint="Optional. One word that sorts it, e.g. hvac, plumbing, exterior, vendor, neighbor."
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
            Guest KB
          </span>
          <span style={{ fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.5 }}>
            The guest AI knows this and may tell a guest (a quirk of the home, a local tip). Leave
            unticked for something only the team should see.
          </span>
        </span>
      </label>

    </RetainedPropertyForm>
  );
}

function KindOption({ value, checked, title, detail }: { value: 'fact' | 'issue'; checked: boolean; title: string; detail: string }) {
  return (
    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', border: '1px solid var(--rule)', padding: '12px 14px' }}>
      <input type="radio" name="kind" value={value} defaultChecked={checked} style={{ marginTop: 3, accentColor: 'var(--ink)' }} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{title}</span>
        <span style={{ fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.5 }}>{detail}</span>
      </span>
    </label>
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
