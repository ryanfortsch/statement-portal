import { SubmitButton } from '@/components/SubmitButton';
import { DEFAULT_UTILITIES, type GuestAgreementRow } from '@/lib/agreement-types';

/**
 * Shared create/edit form for guest rental agreements. Server-rendered,
 * no client state: kind-specific dials (utilities, snow removal, etc.)
 * are always visible with a "mid-term only" hint — the section builder
 * ignores them for short-term agreements, so a stray checkbox can't leak
 * into the wrong document.
 */
export function AgreementForm({
  action,
  properties,
  defaults,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  properties: { id: string; name: string; address: string; city: string }[];
  defaults?: GuestAgreementRow | null;
  submitLabel: string;
}) {
  const d = defaults ?? null;
  const cancelChoice =
    d == null
      ? '60'
      : d.cancel_cutoff_days == null
        ? 'strict'
        : d.cancel_cutoff_days === 60 && (d.cancel_refund_pct ?? 50) === 50
          ? '60'
          : d.cancel_cutoff_days === 30 && (d.cancel_refund_pct ?? 50) === 50
            ? '30'
            : 'custom';
  const utilities = d ? d.utilities_included : [...DEFAULT_UTILITIES];
  const clauses = d?.custom_clauses ?? [];
  // Existing clauses + two blank rows, capped at the parser's limit of 8.
  const clauseRows = Math.min(8, Math.max(3, clauses.length + 2));

  return (
    <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>
      {d && <input type="hidden" name="id" value={d.id} />}

      {/* ── Property ── */}
      <FormBlock title="Property">
        <div style={grid3}>
          <Field label="Helm property">
            <select name="property_id" defaultValue={d?.property_id ?? ''} style={inputStyle}>
              <option value="">Custom / not in Helm</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.address}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Address override" hint="Blank uses the selected property's address. Set for units, e.g. “3 South Street, Unit B”.">
            <input name="property_address" type="text" defaultValue={d?.property_address ?? ''} placeholder="3 South Street, Unit B" style={inputStyle} />
          </Field>
          <Field label="City / State" hint="Required for custom properties.">
            <input name="property_city" type="text" defaultValue={d?.property_city ?? ''} placeholder="Rockport, MA 01966" style={inputStyle} />
          </Field>
        </div>
      </FormBlock>

      {/* ── Agreement kind ── */}
      <FormBlock title="Agreement kind">
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <RadioCard
            name="kind"
            value="short_term"
            defaultChecked={(d?.kind ?? 'short_term') === 'short_term'}
            title="Short-term"
            body="Vacation stay. License-for-lodging language, standard cancellation windows."
          />
          <RadioCard
            name="kind"
            value="mid_term"
            defaultChecked={d?.kind === 'mid_term'}
            title="Mid-term"
            body="Furnished multi-week/month stay. Hardened no-tenancy waiver, utilities list, holdover + no-residency protections."
          />
        </div>
      </FormBlock>

      {/* ── Guest ── */}
      <FormBlock title="Guest">
        <div style={grid3}>
          <Field label="Guest name" required>
            <input name="guest_name" type="text" required defaultValue={d?.guest_name ?? ''} placeholder="Emily Hancock" style={inputStyle} />
          </Field>
          <Field label="Email" hint="Needed to email the signing link.">
            <input name="guest_email" type="email" defaultValue={d?.guest_email ?? ''} placeholder="guest@example.com" style={inputStyle} />
          </Field>
          <Field label="Phone">
            <input name="guest_phone" type="text" defaultValue={d?.guest_phone ?? ''} placeholder="914-262-4310" style={inputStyle} />
          </Field>
        </div>
        <Field label="Approved occupants" hint="Optional roster line for the Occupancy section, e.g. “Julie Polvinen, Laura Polvinen, and their two (2) children”.">
          <input name="additional_occupants" type="text" defaultValue={d?.additional_occupants ?? ''} style={inputStyle} />
        </Field>
      </FormBlock>

      {/* ── Stay & money ── */}
      <FormBlock title="Stay & money">
        <div style={grid3}>
          <Field label="Check-in date" required>
            <input name="stay_start" type="date" required defaultValue={d?.stay_start ?? ''} style={inputStyle} />
          </Field>
          <Field label="Check-out date" required>
            <input name="stay_end" type="date" required defaultValue={d?.stay_end ?? ''} style={inputStyle} />
          </Field>
          <Field label="Total rental fee ($)" required>
            <input name="rental_fee" type="number" min={0} step="0.01" required defaultValue={d?.rental_fee ?? ''} placeholder="32000" style={inputStyle} />
          </Field>
        </div>
        <div style={grid3}>
          <Field label="Deposit">
            <select name="deposit_kind" defaultValue={d?.deposit_kind ?? 'none'} style={inputStyle}>
              <option value="none">None</option>
              <option value="security">Security deposit (held, returned less deductions)</option>
              <option value="damage">Damage deposit (mid-term, not a MA security deposit)</option>
              <option value="hold">Card pre-authorization hold</option>
            </select>
          </Field>
          <Field label="Deposit amount ($)">
            <input name="deposit_amount" type="number" min={0} step="0.01" defaultValue={d?.deposit_amount ?? ''} placeholder="500" style={inputStyle} />
          </Field>
          <Field label="Sleeps (max occupancy)">
            <input name="max_occupancy" type="number" min={1} defaultValue={d?.max_occupancy ?? ''} placeholder="8" style={inputStyle} />
          </Field>
        </div>
      </FormBlock>

      {/* ── Policies ── */}
      <FormBlock title="Policies">
        <div style={grid3}>
          <Field label="Check-in time">
            <input name="check_in_time" type="text" defaultValue={d?.check_in_time ?? '4:00 PM'} style={inputStyle} />
          </Field>
          <Field label="Check-out time">
            <input name="check_out_time" type="text" defaultValue={d?.check_out_time ?? '11:00 AM'} style={inputStyle} />
          </Field>
          <Field label="Quiet hours">
            <input name="quiet_hours" type="text" defaultValue={d?.quiet_hours ?? '11:00 PM to 7:00 AM'} style={inputStyle} />
          </Field>
        </div>
        <div style={grid3}>
          <Field label="Cancellation">
            <select name="cancel_policy" defaultValue={cancelChoice} style={inputStyle}>
              <option value="60">50% refund &gt; 60 days out (standard)</option>
              <option value="30">50% refund &gt; 30 days out</option>
              <option value="strict">No refunds (strict)</option>
              <option value="custom">Custom (fields →)</option>
            </select>
          </Field>
          <Field label="Custom cutoff (days)" hint="Only read when Cancellation is Custom.">
            <input name="cancel_cutoff_days" type="number" min={0} defaultValue={cancelChoice === 'custom' ? d?.cancel_cutoff_days ?? '' : ''} style={inputStyle} />
          </Field>
          <Field label="Custom refund (%)" hint="Only read when Cancellation is Custom.">
            <input name="cancel_refund_pct" type="number" min={0} max={100} defaultValue={cancelChoice === 'custom' ? d?.cancel_refund_pct ?? '' : ''} style={inputStyle} />
          </Field>
        </div>
      </FormBlock>

      {/* ── Mid-term dials ── */}
      <FormBlock title="Mid-term dials" hint="Only rendered on mid-term agreements; ignored for short-term.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="eyebrow" style={{ fontSize: 10, marginBottom: 2 }}>Utilities included in the rental fee</div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            {DEFAULT_UTILITIES.map((u) => (
              <Check key={u} name="utilities" value={u} label={u} defaultChecked={utilities.includes(u)} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 14 }}>
            <Check name="snow_removal_by_guest" label="Snow removal is Guest's responsibility" defaultChecked={d?.snow_removal_by_guest ?? false} />
            <Check name="cleaning_fee_separate" label="Departure cleaning fee billed separately" defaultChecked={d?.cleaning_fee_separate ?? false} />
            <Check name="midstay_cleaning" label="Complimentary mid-stay refresh cleaning" defaultChecked={d?.midstay_cleaning ?? false} />
            <Check name="no_early_termination" label="No early termination (full fee owed regardless)" defaultChecked={d?.no_early_termination ?? false} />
          </div>
        </div>
      </FormBlock>

      {/* ── Bespoke clauses ── */}
      <FormBlock
        title="Bespoke clauses"
        hint="Each renders as its own numbered section before Governing Law. Blank rows are skipped."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {Array.from({ length: clauseRows }, (_, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 12 }}>
              <input
                name={`clause_title_${i}`}
                type="text"
                defaultValue={clauses[i]?.title ?? ''}
                placeholder="Section title"
                style={inputStyle}
              />
              <textarea
                name={`clause_body_${i}`}
                defaultValue={clauses[i]?.body ?? ''}
                placeholder="Clause text. Blank line starts a new paragraph."
                rows={2}
                style={{ ...inputStyle, resize: 'vertical', minHeight: 44 }}
              />
            </div>
          ))}
        </div>
      </FormBlock>

      {/* ── Internal ── */}
      <FormBlock title="Internal notes" hint="Staff-only. Never rendered on the agreement.">
        <textarea name="internal_notes" defaultValue={d?.internal_notes ?? ''} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
      </FormBlock>

      <div>
        <SubmitButton
          label={submitLabel}
          busyLabel={submitLabel.startsWith('Create') ? 'Creating…' : 'Saving…'}
          style={{
            background: 'var(--ink)',
            color: 'var(--paper)',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            padding: '16px 32px',
            border: 'none',
          }}
        />
      </div>
    </form>
  );
}

// ─── Small building blocks ──────────────────────────────────────────────────

const grid3: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 16,
  marginBottom: 16,
};

const inputStyle: React.CSSProperties = {
  font: 'inherit',
  fontSize: 13,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  padding: '9px 10px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

function FormBlock({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <div style={{ borderBottom: '1px solid var(--ink)', paddingBottom: 8, marginBottom: 16 }}>
        <span
          className="font-serif"
          style={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)', letterSpacing: '-0.01em' }}
        >
          {title}
        </span>
        {hint && <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--ink-4)' }}>{hint}</span>}
      </div>
      {children}
    </section>
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
      <span style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600, color: 'var(--ink-3)' }}>
        {label}
        {required && <span style={{ color: 'var(--signal)' }}> *</span>}
      </span>
      {children}
      {hint && <span style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.45 }}>{hint}</span>}
    </label>
  );
}

function RadioCard({
  name,
  value,
  defaultChecked,
  title,
  body,
}: {
  name: string;
  value: string;
  defaultChecked: boolean;
  title: string;
  body: string;
}) {
  return (
    <label
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        border: '1px solid var(--rule)',
        padding: '14px 16px',
        cursor: 'pointer',
        maxWidth: 380,
        flex: '1 1 300px',
      }}
    >
      <input type="radio" name={name} value={value} defaultChecked={defaultChecked} style={{ marginTop: 3, accentColor: 'var(--signal)' }} />
      <span>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{title}</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, marginTop: 3 }}>{body}</span>
      </span>
    </label>
  );
}

function Check({
  name,
  value,
  label,
  defaultChecked,
}: {
  name: string;
  value?: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)', cursor: 'pointer' }}>
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} style={{ accentColor: 'var(--signal)' }} />
      {label}
    </label>
  );
}
