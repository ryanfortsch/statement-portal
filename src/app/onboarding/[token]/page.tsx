import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { getPropertyAccess } from '@/lib/property-access';
import type { ProjectionRow, OnboardingData } from '@/lib/projections-types';
import type { HelmPropertyRow } from '@/lib/properties';
import { submitOnboarding } from '@/app/projections/actions';
import { OnboardingAutoSave } from '@/components/onboarding/OnboardingAutoSave';
import { SubmitButton } from '@/components/SubmitButton';

export const dynamic = 'force-dynamic';

// Token-gated onboarding form: collects utilities / access / emergency
// contact for a specific prospect. Never index in search.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

type OnboardingTarget =
  | { kind: 'projection'; row: ProjectionRow }
  | { kind: 'property'; row: HelmPropertyRow };

/**
 * Join an address line + city/state line into a single display string with
 * a guaranteed ", " separator. Trims each part so trailing whitespace on
 * either column doesn't produce double-spacing or a stray run-together.
 */
function joinAddress(addr: string | null | undefined, city: string | null | undefined): string {
  const parts = [addr, city]
    .map((s) => (s == null ? '' : String(s).trim()))
    .filter((s) => s.length > 0);
  return parts.join(', ');
}

/**
 * Format a raw US phone string into "(xxx) xxx-xxxx". Strips non-digits
 * first so prospect-side entries like "7812231091" render correctly in
 * the onboarding form's pre-fill. Returns the original input untouched
 * for non-US shapes so we don't mangle legitimate non-standard data.
 */
function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return String(raw);
}

async function getOnboardingTarget(token: string): Promise<OnboardingTarget | null> {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;

  // Try the prospect path first (existing behavior). Fall back to the
  // managed-property path so the same /onboarding/<token> URL works for
  // both flows.
  const { data: projRow } = await supabase
    .from('projections')
    .select('*')
    .eq('onboarding_token', token)
    .maybeSingle();
  if (projRow) return { kind: 'projection', row: projRow as ProjectionRow };

  const { data: propRow } = await supabase
    .from('properties')
    .select('*')
    .eq('onboarding_token', token)
    .maybeSingle();
  if (propRow) {
    // Access codes (wifi/lock/key-location/alarm) moved to property_access;
    // merge them back so the form pre-fills what's already on file.
    const access = await getPropertyAccess((propRow as HelmPropertyRow).id);
    return { kind: 'property', row: { ...(propRow as HelmPropertyRow), ...access } };
  }

  return null;
}

/** Build a synthetic OnboardingData blob from a managed property's
 *  first-class columns so the form can pre-populate with what's on file
 *  today. The owner's submission overwrites these columns, so subsequent
 *  loads will reflect the freshly-submitted values. */
function onboardingDataFromProperty(p: HelmPropertyRow): OnboardingData {
  const out: OnboardingData = {};
  const set = (k: keyof OnboardingData, v: string | number | null | undefined) => {
    if (v == null || v === '') return;
    out[k] = String(v);
  };

  // Owner contact (Personal section). full_name + phone + email +
  // mailing + preferred_contact come straight off the property.
  set('full_name', p.owner_full);
  set('phone', p.owner_phone);
  set('email', (p.owner_emails ?? [])[0]);
  set('mailing_address', p.owner_mailing_address);
  set('preferred_contact', p.owner_preferred_contact);

  // Property characteristics
  set('property_address', `${p.address}${p.city ? `, ${p.city}` : ''}`);
  set('property_type', p.type_of_unit);
  set('hoa', p.hoa);
  set('bedrooms', p.bedrooms);
  set('bathrooms', p.bathrooms);
  set('square_feet', p.square_feet);
  set('livable_floors', p.livable_floors);
  set('basement', p.basement);
  set('parking', p.parking);

  // Utilities
  set('electricity_provider', p.electricity_provider);
  set('heating', p.heating);
  set('cooling', p.cooling);
  set('internet_provider', p.internet_provider);
  set('cable_provider', p.cable_provider);
  set('wifi_name', p.wifi_name);
  set('wifi_password', p.wifi_password);
  set('wifi_name_2', p.wifi_name_2);
  set('wifi_password_2', p.wifi_password_2);
  set('num_tvs', p.num_tvs);
  set('smart_tv', p.smart_tv);

  // Guest home guide. Pre-fill from the property's current guide
  // customization so the owner sees (and can improve) exactly what
  // guests read today. Bathrooms / kitchen only surface when the picker
  // slot still points at that catalog key - a staff-repurposed slot
  // (e.g. Hot Tub in slot 5) is not the owner's bathroom answer.
  const guideOv = p.home_guide_overrides ?? {};
  set('guide_parking', guideOv.parking);
  set('guide_climate', guideOv.climate);
  if (!guideOv.slot5 || guideOv.slot5.key === 'bathrooms') {
    set('guide_bathrooms', guideOv.slot5?.body ?? guideOv.bathrooms);
  }
  if (!guideOv.slot6 || guideOv.slot6.key === 'kitchen') {
    set('guide_kitchen', guideOv.slot6?.body ?? guideOv.kitchen);
  }
  // guide_amenities intentionally not pre-filled: its landing spot is a
  // guest-facing property note, and the note upsert skips unchanged
  // bodies, so a blank round-trip costs nothing.

  // STR setup
  set('currently_listed', p.currently_listed);
  set('listing_urls', p.existing_listing_urls);
  set('str_registration', p.str_registration_id);
  set('str_insurance', p.str_insurance_carrier);
  set('guest_access_method', p.guest_access_method);
  set('smart_lock_brand', p.smart_lock_brand);
  set('smart_lock_code', p.smart_lock_code);
  set('security_cameras', p.security_cameras);

  // Access & notes
  set('key_code_location', p.key_code_location);
  set('alarm_system', p.alarm_system);
  set('known_issues', p.known_issues);
  set('upcoming_maintenance', p.upcoming_maintenance);
  // p.property_notes was retired in migration 20260528. The owner's
  // freeform notes from a prior submission live in public.property_notes
  // (one row per note) now; pre-filling them into this form is the
  // wrong shape anyway since the form's textarea expects a single blob.
  // If we want to surface them here we'd need to render the rows
  // separately. Leaving 'notes' empty so the operator can capture any
  // new context this round without seeing stale text.

  // Emergency contact
  set('emergency_name', p.emergency_contact_name);
  set('emergency_relationship', p.emergency_contact_relationship);
  set('emergency_phone', p.emergency_contact_phone);
  set('emergency_email', p.emergency_contact_email);

  // Inspection & safety
  set('trash_day', p.trash_day);
  set('recycling_day', p.recycling_day);
  set('trash_notes', p.trash_notes);
  set('parking_regulations', p.parking_regulations);
  set('gas_shutoff_location', p.gas_shutoff_location);
  set('water_shutoff_location', p.water_shutoff_location);
  set('electrical_panel_location', p.electrical_panel_location);
  set('fire_extinguisher_locations', p.fire_extinguisher_locations);
  set('smoke_detector_locations', p.smoke_detector_locations);
  set('fire_exit_locations', p.fire_exit_locations);
  set('str_permit_expires', p.str_permit_expires);

  return out;
}

export default async function OnboardingFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const target = await getOnboardingTarget(token);
  if (!target) notFound();

  // If they've already submitted, send them to the thank-you page. Owners
  // can re-open the form (the link still works) but the default landing
  // is a confirmation; they re-submit by hitting the form URL again.
  const submittedAt =
    target.kind === 'projection'
      ? target.row.onboarding_submitted_at
      : target.row.onboarding_submitted_at;
  if (submittedAt) {
    redirect(`/onboarding/${token}/thanks`);
  }

  let greetingName: string;
  let propertyAddress: string;
  let fullName: string;
  let ob: OnboardingData;

  if (target.kind === 'projection') {
    const prospect = target.row;
    greetingName = prospect.prospect_first_names || prospect.prospect_first_name || '';
    propertyAddress = joinAddress(prospect.property_address, prospect.property_city);
    fullName = prospect.prospect_full_legal || prospect.prospect_name;
    ob = { ...(prospect.onboarding_data || {}) };
    // Prospect inputs as fallbacks for fields the form pre-populates from
    // the projection's intake answers (phone, property_type, bedrooms).
    // Owner answers always win once they fill the form. Phone is
    // normalized to (xxx) xxx-xxxx so the pre-filled value looks like a
    // phone number instead of a 10-digit blob.
    if (!ob.phone && prospect.prospect_phone) ob.phone = formatPhone(prospect.prospect_phone);
    if (!ob.property_type && prospect.property_type) ob.property_type = prospect.property_type;
    if (!ob.bedrooms && prospect.bedrooms) ob.bedrooms = String(prospect.bedrooms);
  } else {
    const property = target.row;
    greetingName = property.owner_greeting || property.owner_full || '';
    propertyAddress = joinAddress(property.address, property.city);
    fullName = property.owner_full || '';
    // Pre-populate from the property's current first-class columns so
    // the owner sees what's on file and can correct it.
    ob = onboardingDataFromProperty(property);
    // Same phone normalization as the projection branch.
    if (ob.phone) ob.phone = formatPhone(ob.phone);
  }

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
            A few details about <strong>{propertyAddress}</strong>{' '}so we can deliver the best possible service from day one. Your answers save automatically as you type — feel free to pause and come back. Tap Submit at the bottom when you&rsquo;re done.
          </p>
        </section>

        <OnboardingAutoSave>
        <form action={submitOnboarding} className="rt-pub-form">
          <input type="hidden" name="token" value={token} />

          {/* ── Personal ── */}
          <Section eyebrow="01" title="Personal Information">
            <Row>
              <Field name="full_name" label="Full name" required defaultValue={ob.full_name ?? fullName} />
              <Field name="phone" label="Phone number" type="tel" required defaultValue={ob.phone ?? ''} />
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
              <Field name="property_type" label="Property type" required defaultValue={ob.property_type} hint="Single-family, Condo, Townhouse, etc." />
              <Field name="hoa" label="HOA" defaultValue={ob.hoa} hint="Yes / No — name if applicable" />
            </Row>
            <Row>
              <Field name="bedrooms" label="Bedrooms" type="number" required defaultValue={ob.bedrooms} />
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
              <Field name="wifi_name_2" label="Second WiFi network" defaultValue={ob.wifi_name_2} hint="Only if the home runs a second router (guest suite, boat house, in-law)" />
              <Field name="wifi_password_2" label="Second WiFi password" defaultValue={ob.wifi_password_2} />
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
              <Field name="str_registration" label="STR registration #" defaultValue={ob.str_registration} hint="Room Occupancy Certificate number" />
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

          {/* ── Inspection & Safety ── */}
          {/*
            Required for the Gloucester STR permit inspection (a posted
            "Information Note" inside every short-term rental). Also useful
            for Operations + emergency response in any jurisdiction.
          */}
          <Section eyebrow="07" title="Inspection & Safety">
            <Row>
              <Field name="trash_day" label="Trash pickup day" defaultValue={ob.trash_day} hint="e.g. Tuesday" />
              <Field name="recycling_day" label="Recycling pickup day" defaultValue={ob.recycling_day} hint="e.g. Tuesday (alternating weeks)" />
            </Row>
            <Field name="trash_notes" label="Trash & recycling notes" defaultValue={ob.trash_notes} hint="Bin location, opt-out, special instructions" textarea />
            <Field
              name="parking_regulations"
              label="Parking regulations"
              defaultValue={ob.parking_regulations}
              hint="Resident-only zones, street sweeping schedule, snow emergencies, permit info"
              textarea
            />
            <Row>
              <Field name="gas_shutoff_location" label="Gas shutoff location" defaultValue={ob.gas_shutoff_location} hint="e.g. basement, behind the boiler" />
              <Field name="water_shutoff_location" label="Water shutoff location" defaultValue={ob.water_shutoff_location} hint="e.g. basement, near the meter" />
            </Row>
            <Field name="electrical_panel_location" label="Electrical panel location" defaultValue={ob.electrical_panel_location} hint="e.g. basement utility room" />
            <Field
              name="fire_extinguisher_locations"
              label="Fire extinguisher locations"
              defaultValue={ob.fire_extinguisher_locations}
              hint="Comma-separated, e.g. kitchen under sink, basement"
              textarea
            />
            <Field
              name="smoke_detector_locations"
              label="Smoke / CO detector locations"
              defaultValue={ob.smoke_detector_locations}
              hint="Each floor / hallway / bedroom"
              textarea
            />
            <Field
              name="fire_exit_locations"
              label="Fire exits"
              defaultValue={ob.fire_exit_locations}
              hint="Primary + secondary egress (front door, back deck, etc.)"
              textarea
            />
            <Field name="str_permit_expires" label="STR permit expiration" defaultValue={ob.str_permit_expires} hint="If known. e.g. 2027-04-30" />
          </Section>

          {/* ── Guest home guide ── */}
          {/*
            The pipeline into the printed "Welcome Home" guide + the guest
            knowledge base. Answers flow to home_guide_overrides (parking /
            climate fill the fixed cells, bathrooms / kitchen the default
            picker slots) and the amenities blurb lands as a guest-facing
            property note. Nobody knows the house like the owner, so we ask
            while we have them.
          */}
          <Section eyebrow="08" title="Your Home, for Guests">
            <p className="rt-pub-section-lead">
              These answers go straight into the one-page welcome guide we print and post in the home.
              Write them the way you&rsquo;d explain the house to a friend staying for the weekend; we&rsquo;ll
              polish the wording before anything is published.
            </p>
            <Field
              name="guide_parking"
              label="Parking, in your words"
              defaultValue={ob.guide_parking}
              hint="Where guests should park, how many cars fit, anything to avoid (neighbor's spot, street rules)"
              textarea
            />
            <Field
              name="guide_climate"
              label="Heating & cooling tips"
              defaultValue={ob.guide_climate}
              hint="How the thermostats work, window units, wood stove season, any quirks"
              textarea
            />
            <Field
              name="guide_bathrooms"
              label="Bathrooms"
              defaultValue={ob.guide_bathrooms}
              hint="Hot-water wait, water pressure, shower quirks, septic do's and don'ts"
              textarea
            />
            <Field
              name="guide_kitchen"
              label="Kitchen & appliances"
              defaultValue={ob.guide_kitchen}
              hint="Coffee maker, stove or oven quirks, dishwasher, disposal, anything with a trick to it"
              textarea
            />
            <Field
              name="guide_amenities"
              label="Special amenities"
              defaultValue={ob.guide_amenities}
              hint="Hot tub, grill, fire pit, laundry, beach gear, bikes: how to use them and any rules"
              textarea
            />
          </Section>

          <div className="rt-pub-submit">
            <SubmitButton label="Submit form" busyLabel="Submitting…" />
            <p>Once you submit, we&rsquo;ll take it from here. Questions? Reach Allie at <a href="mailto:allie@risingtidestr.com">allie@risingtidestr.com</a> or (978) 865-2387.</p>
          </div>
        </form>
        </OnboardingAutoSave>

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
  .rt-pub-section-lead {
    margin: -4px 0 2px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--ink-3);
    max-width: 560px;
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
