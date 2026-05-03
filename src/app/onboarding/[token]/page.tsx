import { redirect, notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { ProjectionRow } from '@/lib/projections-types';
import { submitOnboarding } from '@/app/projections/actions';

export const dynamic = 'force-dynamic';

async function getProspect(token: string): Promise<ProjectionRow | null> {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const { data } = await supabase
    .from('projections')
    .select('*')
    .eq('onboarding_token', token)
    .maybeSingle();
  return (data as ProjectionRow | null) ?? null;
}

export default async function OnboardingFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const prospect = await getProspect(token);
  if (!prospect) notFound();

  // If they've already submitted, send them to the thank-you page.
  if (prospect.onboarding_submitted_at) {
    redirect(`/onboarding/${token}/thanks`);
  }

  const greetingName = prospect.prospect_first_names || prospect.prospect_first_name || '';
  const propertyAddress = `${prospect.property_address}${prospect.property_city ? `, ${prospect.property_city}` : ''}`;
  const fullName = prospect.prospect_full_legal || prospect.prospect_name;
  const ob = prospect.onboarding_data || {};

  return (
    <>
      <style>{publicCss}</style>

      <div className="rt-public">
        <header className="rt-pub-mast">
          <div className="rt-pub-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/rising-tide-logo.png" alt="Rising Tide" />
            <span>Rising Tide</span>
          </div>
          <span className="rt-pub-tag">Owner Onboarding</span>
        </header>

        <section className="rt-pub-hero">
          <div className="eyebrow">Welcome{greetingName ? `, ${greetingName.split(/[, ]/)[0]}` : ''}</div>
          <h1>Tell us about <em>your home.</em></h1>
          <p className="rt-pub-lead">
            A few details about <strong>{propertyAddress}</strong> so we can deliver the best possible service from day one. Your answers are saved when you submit; you can&rsquo;t lose progress mid-form, but try to complete it in one sitting.
          </p>
        </section>

        <form action={submitOnboarding} className="rt-pub-form">
          <input type="hidden" name="token" value={token} />

          {/* ── Personal ── */}
          <Section eyebrow="01" title="Personal Information">
            <Row>
              <Field name="full_name" label="Full name" required defaultValue={ob.full_name ?? fullName} />
              <Field name="phone" label="Phone number" type="tel" required defaultValue={ob.phone ?? prospect.prospect_phone ?? ''} />
            </Row>
            <Row>
              <Field name="email" label="Email address" type="email" required defaultValue={ob.email} />
              <Field name="preferred_contact" label="Preferred contact method" required as="select" defaultValue={ob.preferred_contact}>
                <option value="">Choose…</option>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
                <option value="text">Text</option>
              </Field>
            </Row>
            <Field name="mailing_address" label="Mailing address" required defaultValue={ob.mailing_address} />
          </Section>

          {/* ── Property ── */}
          <Section eyebrow="02" title="Property Information">
            <Field name="property_address" label="Property address" required defaultValue={ob.property_address ?? propertyAddress} />
            <Row>
              <Field name="property_type" label="Property type" required defaultValue={ob.property_type ?? prospect.property_type} hint="Single-family, Condo, Townhouse, etc." />
              <Field name="hoa" label="HOA" defaultValue={ob.hoa} hint="Yes / No — name if applicable" />
            </Row>
            <Row>
              <Field name="bedrooms" label="Bedrooms" type="number" required defaultValue={ob.bedrooms ?? String(prospect.bedrooms || '')} />
              <Field name="bathrooms" label="Bathrooms" type="number" step="0.5" required defaultValue={ob.bathrooms} />
              <Field name="square_feet" label="Square feet" type="number" defaultValue={ob.square_feet} />
              <Field name="livable_floors" label="Livable floors" type="number" defaultValue={ob.livable_floors} />
            </Row>
            <Row>
              <Field name="basement" label="Basement" defaultValue={ob.basement} hint="Yes / No — finished or unfinished" />
              <Field name="parking" label="Parking" defaultValue={ob.parking} hint="Garage / Driveway / Street" />
            </Row>
          </Section>

          {/* ── Utilities ── */}
          <Section eyebrow="03" title="Utilities">
            <Row>
              <Field name="electricity_provider" label="Electricity provider" defaultValue={ob.electricity_provider} />
              <Field name="heating" label="Heating" defaultValue={ob.heating} hint="Gas, Electric, Oil, Heat pump…" />
            </Row>
            <Row>
              <Field name="cooling" label="Cooling" defaultValue={ob.cooling} hint="Central A/C, Mini-split, Window units, None" />
              <Field name="internet_provider" label="Internet provider" defaultValue={ob.internet_provider} />
            </Row>
            <Row>
              <Field name="cable_provider" label="Cable / TV provider" defaultValue={ob.cable_provider} hint="Xfinity, Spectrum, None" />
              <Field name="wifi_name" label="WiFi name" defaultValue={ob.wifi_name} />
              <Field name="wifi_password" label="WiFi password" defaultValue={ob.wifi_password} />
            </Row>
            <Row>
              <Field name="num_tvs" label="Number of TVs" type="number" defaultValue={ob.num_tvs} />
              <Field name="smart_tv" label="Smart TV?" defaultValue={ob.smart_tv} hint="Yes / No" />
            </Row>
          </Section>

          {/* ── STR ── */}
          <Section eyebrow="04" title="Short-term Rental Information">
            <Field name="currently_listed" label="Currently listed?" defaultValue={ob.currently_listed} hint="Platform(s) if yes — Airbnb, VRBO, etc." />
            <Field name="listing_urls" label="Existing listing URL(s)" defaultValue={ob.listing_urls} />
            <Row>
              <Field name="str_registration" label="STR registration #" defaultValue={ob.str_registration} hint="If applicable in your municipality" />
              <Field name="str_insurance" label="STR insurance carrier" defaultValue={ob.str_insurance} hint="Policy # if available" />
            </Row>
            <Field name="guest_access_method" label="Guest access method" defaultValue={ob.guest_access_method} hint="Smart Lock / Key Box / Other" />
            <Row>
              <Field name="smart_lock_brand" label="Smart lock brand" defaultValue={ob.smart_lock_brand} />
              <Field name="smart_lock_code" label="Model / access code" defaultValue={ob.smart_lock_code} />
            </Row>
            <Field name="security_cameras" label="Security camera(s)" defaultValue={ob.security_cameras} hint="Yes / No — locations if yes" />
          </Section>

          {/* ── Access & Notes ── */}
          <Section eyebrow="05" title="Property Access & Notes">
            <Field name="key_code_location" label="Key / code location" defaultValue={ob.key_code_location} />
            <Field name="alarm_system" label="Alarm system" defaultValue={ob.alarm_system} hint="Yes / No — code if applicable" />
            <Field name="known_issues" label="Known issues" defaultValue={ob.known_issues} hint="Appliances, HVAC, roof, etc." textarea />
            <Field name="upcoming_maintenance" label="Upcoming maintenance" defaultValue={ob.upcoming_maintenance} hint="Any scheduled work we should know about" textarea />
            <Field name="notes" label="Notes for Rising Tide" defaultValue={ob.notes} textarea />
          </Section>

          {/* ── Emergency contact ── */}
          <Section eyebrow="06" title="Emergency Contact">
            <Row>
              <Field name="emergency_name" label="Name" required defaultValue={ob.emergency_name} />
              <Field name="emergency_relationship" label="Relationship" required defaultValue={ob.emergency_relationship} hint="Neighbor, Family, Contractor…" />
            </Row>
            <Row>
              <Field name="emergency_phone" label="Phone number" type="tel" required defaultValue={ob.emergency_phone} />
              <Field name="emergency_email" label="Email address" type="email" defaultValue={ob.emergency_email} />
            </Row>
          </Section>

          <div className="rt-pub-submit">
            <button type="submit">Submit form</button>
            <p>Once you submit, we&rsquo;ll take it from here. Questions? Reach Allie at <a href="mailto:allie@risingtidestr.com">allie@risingtidestr.com</a> or (978) 865-2387.</p>
          </div>
        </form>

        <footer className="rt-pub-foot">
          Rising Tide &middot; risingtidestr.com &middot; allie@risingtidestr.com &middot; (978) 865-2387
        </footer>
      </div>
    </>
  );
}

// ─── Form components ────────────────────────────────────────────────────────
function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <div className="rt-pub-section">
      <div className="rt-pub-section-h">
        <span className="rt-pub-section-num">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      <div className="rt-pub-section-body">{children}</div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="rt-pub-row">{children}</div>;
}

type FieldProps = {
  name: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
  type?: string;
  step?: string;
  hint?: string;
  textarea?: boolean;
  as?: 'select';
  children?: React.ReactNode;
};

function Field(props: FieldProps) {
  const { name, label, defaultValue = '', required, type, step, hint, textarea, as, children } = props;
  return (
    <label className="rt-pub-field">
      <span className="rt-pub-label">
        {label}
        {required && <span className="rt-pub-req"> *</span>}
      </span>
      {as === 'select' ? (
        <select name={name} required={required} defaultValue={defaultValue}>
          {children}
        </select>
      ) : textarea ? (
        <textarea name={name} required={required} defaultValue={defaultValue} rows={3} />
      ) : (
        <input
          name={name}
          type={type || 'text'}
          step={step}
          required={required}
          defaultValue={defaultValue}
        />
      )}
      {hint && <span className="rt-pub-hint">{hint}</span>}
    </label>
  );
}

// ─── CSS ────────────────────────────────────────────────────────────────────
const publicCss = `
  html, body {
    background: var(--paper);
    margin: 0;
    padding: 0;
    color: var(--ink);
  }
  body { font-family: var(--font-inter), system-ui, sans-serif; }

  .rt-public {
    max-width: 720px;
    margin: 0 auto;
    padding: 0 24px 80px;
  }
  .rt-pub-mast {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 24px 0 18px;
    border-bottom: 1px solid var(--ink);
  }
  .rt-pub-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 18px;
    font-weight: 500;
    color: var(--ink);
    letter-spacing: -0.005em;
  }
  .rt-pub-brand img { width: 28px; height: 28px; }
  .rt-pub-tag {
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-4);
    font-weight: 500;
  }
  .eyebrow {
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-4);
    font-weight: 500;
  }

  .rt-pub-hero { padding: 56px 0 36px; }
  .rt-pub-hero h1 {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 44px;
    line-height: 1.05;
    font-weight: 300;
    letter-spacing: -0.02em;
    color: var(--ink);
    margin: 12px 0 0;
    max-width: 560px;
  }
  .rt-pub-hero h1 em { color: var(--tide-deep); font-weight: 400; }
  .rt-pub-lead {
    margin: 18px 0 0;
    font-size: 14px;
    line-height: 1.6;
    color: var(--ink-3);
    max-width: 560px;
  }

  /* Form */
  .rt-pub-form { display: flex; flex-direction: column; gap: 36px; }

  .rt-pub-section {
    border-top: 1px solid var(--ink);
    padding-top: 22px;
  }
  .rt-pub-section-h {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 18px;
  }
  .rt-pub-section-num {
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    font-size: 11px;
    color: var(--signal);
    letter-spacing: 0.08em;
    font-weight: 500;
  }
  .rt-pub-section-h h2 {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 22px;
    font-weight: 400;
    letter-spacing: -0.01em;
    color: var(--ink);
    margin: 0;
  }
  .rt-pub-section-body {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .rt-pub-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
  }

  /* Field */
  .rt-pub-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .rt-pub-label {
    font-size: 11px;
    letter-spacing: 0.06em;
    color: var(--ink);
    font-weight: 500;
  }
  .rt-pub-req { color: var(--signal); }
  .rt-pub-field input,
  .rt-pub-field textarea,
  .rt-pub-field select {
    font: inherit;
    font-size: 14px;
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--rule);
    padding: 10px 12px;
    outline: none;
    width: 100%;
    box-sizing: border-box;
  }
  .rt-pub-field textarea {
    resize: vertical;
    min-height: 70px;
    font-family: var(--font-inter), system-ui, sans-serif;
  }
  .rt-pub-field input:focus,
  .rt-pub-field textarea:focus,
  .rt-pub-field select:focus {
    border-color: var(--ink);
  }
  .rt-pub-field select {
    cursor: pointer;
    appearance: none;
    padding-right: 36px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%23506068' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    background-size: 16px;
  }
  .rt-pub-hint { font-size: 11px; color: var(--ink-4); font-style: italic; }

  /* Submit */
  .rt-pub-submit {
    margin-top: 20px;
    padding-top: 24px;
    border-top: 1px solid var(--ink);
  }
  .rt-pub-submit button {
    background: var(--ink);
    color: var(--paper);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    padding: 16px 32px;
    border: none;
    cursor: pointer;
  }
  .rt-pub-submit p {
    margin: 14px 0 0;
    font-size: 12px;
    color: var(--ink-3);
    max-width: 540px;
    line-height: 1.55;
  }
  .rt-pub-submit a { color: var(--signal); text-decoration: none; }
  .rt-pub-submit a:hover { text-decoration: underline; }

  /* Footer */
  .rt-pub-foot {
    margin-top: 56px;
    padding-top: 18px;
    border-top: 1px solid var(--rule);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ink-4);
    text-align: center;
  }

  /* Mobile */
  @media (max-width: 640px) {
    .rt-pub-hero h1 { font-size: 32px; }
    .rt-pub-row { grid-template-columns: 1fr; }
  }
`;
