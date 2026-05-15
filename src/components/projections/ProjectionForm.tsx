import type { Owner, ProjectionRow } from '@/lib/projections-types';
import { CustomClausesField } from './CustomClausesField';
import { OwnersSection } from './OwnersSection';
import { MoneyInput } from './MoneyInput';

/**
 * Shared input form for new + edit projections. Submits to a server action
 * passed via `action`. Field names match the `buildPayload()` parser in
 * src/app/projections/actions.ts.
 *
 * Numeric fields that represent percentages (mgmt_fee_pct, year2_growth_pct)
 * use whole numbers in the UI (25 = 25%) and are converted to decimals
 * server-side.
 */

type Props = {
  action: (formData: FormData) => Promise<void>;
  initial?: Partial<ProjectionRow>;
  submitLabel?: string;
  /** When present, the row's last-updated timestamp surfaces as a chip
   *  next to the Save button so the user gets visible feedback that the
   *  most recent save (or redline apply) actually landed. Pass
   *  `projection.updated_at` from the page. */
  lastSavedAt?: string | null;
};

const DEFAULT_PRESENTATION_MONTH = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
})();

export function ProjectionForm({ action, initial, submitLabel = 'Save', lastSavedAt }: Props) {
  const v = initial ?? {};
  const pct = (n: number | null | undefined, fallback: number) =>
    n != null ? Math.round(n * 100) : fallback;

  return (
    <form action={action} className="space-y-10">
      {/* ─── Owners ────────────────────────────────────────────────────────── */}
      <Section eyebrow="01" title="Owners">
        <OwnersSection initial={initialOwnersFor(initial)} />
      </Section>

      {/* ─── Property ──────────────────────────────────────────────────────── */}
      <Section eyebrow="02" title="Property">
        <Row>
          <Field label="Property address" required>
            <input
              name="property_address"
              required
              defaultValue={v.property_address ?? ''}
              placeholder="36 Granite St"
              style={inputStyle}
            />
          </Field>
          <Field label="Property type">
            <select
              name="property_type"
              defaultValue={v.property_type ?? 'House'}
              style={selectStyle}
            >
              <option value="House">House</option>
              <option value="Condo">Condo</option>
              <option value="Cottage">Cottage</option>
              <option value="Townhouse">Townhouse</option>
              <option value="Apartment">Apartment</option>
            </select>
          </Field>
          {/* Carry the existing property_city through unchanged on edits so
              we don't accidentally clobber a manually-set city (e.g. 20 Enon
              Rd / Beverly MA, whose Market is Gloucester). New prospects
              skip this and the server derives the city from `market`. */}
          <input type="hidden" name="property_city" defaultValue={v.property_city ?? ''} />
        </Row>
        <Row>
          <Field label="Market" required>
            <select
              name="market"
              required
              defaultValue={v.market ?? 'Rockport'}
              style={selectStyle}
            >
              <option value="Rockport">Rockport</option>
              <option value="Gloucester">Gloucester</option>
            </select>
          </Field>
          <Field label="Bedrooms" required>
            <select
              name="bedrooms"
              required
              defaultValue={v.bedrooms ?? 2}
              style={selectStyle}
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
              <option value={5}>5</option>
              <option value={6}>6+</option>
            </select>
          </Field>
          <Field label="Home value" required hint="Zillow-equivalent">
            <MoneyInput
              name="home_value"
              required
              min={0}
              step={1000}
              defaultValue={v.home_value ?? ''}
              placeholder="850,000"
            />
          </Field>
        </Row>
        <Row>
          <Field label="Neighborhood">
            <input
              name="neighborhood"
              defaultValue={v.neighborhood ?? ''}
              placeholder="Back Beach"
              style={inputStyle}
            />
          </Field>
          <Field label="Interior grade">
            <input
              name="interior_grade"
              defaultValue={v.interior_grade ?? ''}
              placeholder="A / B / C"
              style={inputStyle}
            />
          </Field>
        </Row>
      </Section>

      {/* ─── Presentation ──────────────────────────────────────────────────── */}
      <Section eyebrow="03" title="Presentation">
        <Row>
          <Field label="Presentation month" required hint="Cover page date, e.g. March 2026">
            <input
              name="presentation_month"
              required
              type="month"
              defaultValue={v.presentation_month ?? DEFAULT_PRESENTATION_MONTH}
              style={inputStyle}
            />
          </Field>
          <Field label="Drive time from HQ (min)" hint="From 85 Eastern Ave, Gloucester. Auto-computed via OpenStreetMap on save when blank. Enter a value to override.">
            <input
              name="drive_time_minutes"
              type="number"
              min={0}
              max={120}
              step={1}
              defaultValue={v.drive_time_minutes ?? ''}
              placeholder="auto"
              style={inputStyle}
            />
          </Field>
        </Row>
        <Row>
          <Field label="Ramp" hint="Off: full year from January. On: months before the go-live month are zero; the go-live month and the next two ramp at 0.2 / 0.5 / 1.0 of seasonality. Year 2 numbers always use the normalized full year, regardless.">
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', border: '1px solid var(--rule)', cursor: 'pointer', fontSize: 14 }}>
              <input
                type="checkbox"
                name="apply_ramp"
                defaultChecked={!!v.apply_ramp}
                style={{ width: 16, height: 16, accentColor: 'var(--signal)' }}
              />
              <span>Apply ramp</span>
            </label>
          </Field>
          <Field label="Go-live month" hint="When ramp is on, the first month the property earns income.">
            <select
              name="start_month"
              defaultValue={v.start_month ?? 5}
              style={selectStyle}
            >
              {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </Field>
        </Row>
      </Section>

      {/* ─── Assumptions ───────────────────────────────────────────────────── */}
      <Section eyebrow="04" title="Assumptions">
        <Row>
          <Field label="Management fee %" required>
            <input
              name="mgmt_fee_pct"
              required
              type="number"
              min={0}
              max={100}
              step={1}
              defaultValue={pct(v.mgmt_fee_pct, 25)}
              style={inputStyle}
            />
          </Field>
          <Field label="Year 2 growth %" required>
            <input
              name="year2_growth_pct"
              required
              type="number"
              min={-100}
              max={200}
              step={1}
              defaultValue={pct(v.year2_growth_pct, 10)}
              style={inputStyle}
            />
          </Field>
          <Field label="Turnovers / year" required>
            <input
              name="turnovers_per_year"
              required
              type="number"
              min={0}
              step={1}
              defaultValue={v.turnovers_per_year ?? 45}
              style={inputStyle}
            />
          </Field>
        </Row>
        <Row>
          <Field label="Base cleaning ($)" required hint="Per turnover">
            <MoneyInput
              name="base_cleaning"
              required
              min={0}
              step={5}
              defaultValue={v.base_cleaning ?? 200}
            />
          </Field>
          <Field label="Add'l per BR > 2 ($)" required>
            <MoneyInput
              name="addl_cleaning_per_br"
              required
              min={0}
              step={5}
              defaultValue={v.addl_cleaning_per_br ?? 50}
            />
          </Field>
        </Row>
      </Section>

      {/* ─── Overrides (optional) ──────────────────────────────────────────── */}
      <Section eyebrow="05" title="Overrides (optional)">
        <p style={{ fontSize: 12, color: 'var(--ink-4)', marginBottom: 16, marginTop: -4, lineHeight: 1.55, maxWidth: 620 }}>
          Leave blank to use the model. Set revenue overrides to bypass the
          50/50 blend. Set hero overrides to control the cover-page range
          directly (otherwise it shows ramped Year 1 → full Year 1).
        </p>
        <Row>
          <Field label="Revenue override — Low ($)">
            <MoneyInput
              name="revenue_override_low"
              min={0}
              step={1000}
              defaultValue={v.revenue_override_low ?? ''}
            />
          </Field>
          <Field label="Revenue override — High ($)">
            <MoneyInput
              name="revenue_override_high"
              min={0}
              step={1000}
              defaultValue={v.revenue_override_high ?? ''}
            />
          </Field>
        </Row>
        <Row>
          <Field label="Hero range — Low ($)" hint="Cover page lower bound">
            <MoneyInput
              name="hero_low_override"
              min={0}
              step={1000}
              defaultValue={v.hero_low_override ?? ''}
            />
          </Field>
          <Field label="Hero range — High ($)" hint="Cover page upper bound">
            <MoneyInput
              name="hero_high_override"
              min={0}
              step={1000}
              defaultValue={v.hero_high_override ?? ''}
            />
          </Field>
        </Row>
      </Section>

      {/* ─── Contract terms ────────────────────────────────────────────────── */}
      <Section eyebrow="06" title="Contract terms">
        <p style={{ fontSize: 12, color: 'var(--ink-4)', marginBottom: 16, marginTop: -4, lineHeight: 1.55, maxWidth: 620 }}>
          Defaults match Rising Tide&rsquo;s standard contract. Edit per-deal terms
          below; they flow through to the contract render. Boilerplate clauses
          (responsibilities, termination, force majeure, etc.) are not editable
          from here.
        </p>
        <Row>
          <Field label="Term start" hint="Agreement commences">
            <input
              name="term_start"
              type="date"
              defaultValue={v.term_start ?? ''}
              style={inputStyle}
            />
          </Field>
          <Field label="Term end" hint="Initial term ends">
            <input
              name="term_end"
              type="date"
              defaultValue={v.term_end ?? ''}
              style={inputStyle}
            />
          </Field>
        </Row>
        <Row>
          <Field label="Initial deposit ($)" required>
            <MoneyInput
              name="initial_deposit"
              required
              min={0}
              step={100}
              defaultValue={v.initial_deposit ?? 2000}
            />
          </Field>
          <Field label="Min account balance ($)" required>
            <MoneyInput
              name="min_account_balance"
              required
              min={0}
              step={100}
              defaultValue={v.min_account_balance ?? 2000}
            />
          </Field>
          <Field label="Reputation damages ($)" required hint="If owner sells without notice">
            <MoneyInput
              name="reputation_fee"
              required
              min={0}
              step={500}
              defaultValue={v.reputation_fee ?? 5000}
            />
          </Field>
        </Row>
        <Row>
          <Field label="Min availability (days/year)" required>
            <input
              name="min_availability_days"
              required
              type="number"
              min={0}
              max={365}
              step={1}
              defaultValue={v.min_availability_days ?? 270}
              style={inputStyle}
            />
          </Field>
          <Field label="Sale notification (days)" required hint="Notice required if owner sells">
            <input
              name="sale_notification_days"
              required
              type="number"
              min={0}
              step={1}
              defaultValue={v.sale_notification_days ?? 185}
              style={inputStyle}
            />
          </Field>
        </Row>
      </Section>

      {/* ─── Custom clauses (optional, per-deal) ────────────────────────── */}
      <Section eyebrow="07" title="Custom clauses (optional)">
        <p style={{ fontSize: 12, color: 'var(--ink-4)', marginBottom: 16, marginTop: -4, lineHeight: 1.55, maxWidth: 620 }}>
          Per-deal addenda that get rendered as a &ldquo;Rider&rdquo; page after Sale
          Protection in the contract. Add as many as the deal requires; leave
          empty for the standard contract.
        </p>
        <CustomClausesField initial={v.custom_clauses ?? null} />
      </Section>

      

      <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 24, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="submit"
          style={{
            background: 'var(--ink)',
            color: 'var(--paper)',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            padding: '14px 28px',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          {submitLabel} →
        </button>
        {lastSavedAt ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              background: 'rgba(74, 157, 107, 0.14)',
              color: '#2a5e3f',
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: '.02em',
            }}
            title={`Server timestamp: ${lastSavedAt}`}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#4a9d6b',
                display: 'inline-block',
              }}
            />
            Saved at {formatSavedAt(lastSavedAt)}
          </span>
        ) : null}
        <span style={{ fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic' }}>
          If the contract preview is open in another tab, refresh that tab to see the new values.
        </span>
      </div>
    </form>
  );
}

function formatSavedAt(iso: string): string {
  try {
    // Pin to Rising Tide HQ tz — this component renders server-side and
    // Vercel runs in UTC, so without a timeZone hint the chip would read
    // 4h ahead of local. All staff are on Eastern, so it's a hard pin.
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/New_York',
    });
  } catch {
    return iso;
  }
}

// ─── Layout primitives ───────────────────────────────────────────────────────
/**
 * Build the initial owners array for the form. Pulls from `owners` if the
 * record already has the structured field; otherwise falls back to deriving a
 * single owner from the legacy scalar fields (so existing prospects render
 * one pre-filled card and don't lose their data).
 */
function initialOwnersFor(initial: Partial<ProjectionRow> | undefined): Owner[] {
  if (initial?.owners && Array.isArray(initial.owners) && initial.owners.length > 0) {
    return initial.owners;
  }
  // Legacy fallback: derive a single owner from the scalar fields.
  const legacyName = initial?.prospect_full_legal || initial?.prospect_name || '';
  const parts = legacyName.split(/\s+/);
  const first = initial?.prospect_first_name || parts[0] || '';
  const last = parts.length > 1 ? parts.slice(1).join(' ') : '';
  if (!first && !last && !initial?.prospect_email && !initial?.prospect_phone) {
    return []; // empty → OwnersSection seeds one blank card
  }
  return [
    {
      first_name: first,
      last_name: last,
      email: initial?.prospect_email ?? null,
      phone: initial?.prospect_phone ?? null,
      full_legal: initial?.prospect_full_legal ?? null,
    },
  ];
}

function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline gap-3" style={{ marginBottom: 18 }}>
        <span className="font-mono" style={{ fontSize: 11, color: 'var(--signal)', letterSpacing: '.08em' }}>
          {eyebrow}
        </span>
        <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
          {title}
        </h2>
      </div>
      <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {children}
      </div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 18 }}>{children}</div>;
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
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


const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
  appearance: 'none',
  paddingRight: 32,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%23506068' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
  backgroundSize: '16px',
};
