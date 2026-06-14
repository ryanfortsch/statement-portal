import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import { updatePropertyWithState } from '@/app/properties/actions';
import { EditFormShell } from './EditFormShell';
import type { HelmPropertyRow } from '@/lib/properties';
import { formatUsPhone } from '@/lib/phone';

export const dynamic = 'force-dynamic';

async function getProperty(id: string): Promise<HelmPropertyRow | null> {
  if (!isHelmConfigured) return null;
  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as HelmPropertyRow) ?? null;
}

/**
 * Edit a property's operational + safety data.
 *
 * Identity fields (id, name, address, owner_*, management_fee_pct) live
 * on the detail page only and require a separate code path to change.
 * This form covers the editable subset that staff need to fill in
 * mid-cycle: utilities, parking, trash, safety equipment, emergency
 * contact, etc.
 *
 * Pre-populates from the row, falling back to '' for null columns. The
 * server action coerces empty strings back to null on save so cleared
 * fields actually clear in the DB.
 */
type Params = { id: string };

export default async function PropertyEditPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const p = await getProperty(id);
  if (!p) notFound();

  // Bind the property id to the action so the form only needs to submit
  // its FormData payload.
  const action = updatePropertyWithState.bind(null, id);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="properties" />

      <div className="max-w-[900px] mx-auto px-10" style={{ paddingTop: 24, width: '100%' }}>
        <Link
          href={`/properties/${p.id}`}
          style={{
            fontSize: 11,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            textDecoration: 'none',
          }}
        >
          ← {p.name}
        </Link>
      </div>

      <section className="max-w-[900px] mx-auto px-10" style={{ paddingTop: 24, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Edit operational data</div>
        <h1 className="font-serif" style={{ fontSize: 40, lineHeight: 1.05, fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
          {p.name}
        </h1>
        <p style={{ marginTop: 12, fontSize: 14, color: 'var(--ink-3)', maxWidth: 640, lineHeight: 1.6 }}>
          Fill in or update operational details for this property. Saved changes flow through to the
          guest deliverables (Welcome Guide, Wi-Fi Placard, Information Note) and to anything that
          reads from the properties table. Leave a field blank to clear it.
        </p>
      </section>

      <EditFormShell action={action} propertyId={p.id}>
        {/* ── Owner contact ── */}
        <Group eyebrow="01" title="Owner contact">
          <Row>
            <Field name="owner_full" label="Owner name" defaultValue={p.owner_full} hint="As it should read on the statement — e.g. Khristin Lambert-Vorais" />
            <Field name="owner_greeting" label="Greeting" defaultValue={p.owner_greeting} hint="First name(s) for emails — e.g. Khristin and Carol Ann" />
          </Row>
          <Field name="owner_emails" label="Owner emails" defaultValue={p.owner_emails.join(', ')} hint="Comma-separated. Everyone here gets the monthly statement." />
          <Row>
            <Field name="owner_phone" label="Owner phone" type="tel" defaultValue={formatUsPhone(p.owner_phone)} hint="(781) 223-1091" />
            <Field name="owner_preferred_contact" label="Preferred contact" defaultValue={p.owner_preferred_contact} hint="email / phone / text" />
          </Row>
          <Field name="owner_mailing_address" label="Owner mailing address" defaultValue={p.owner_mailing_address} />
        </Group>

        {/* ── Property specs ── */}
        <Group eyebrow="02" title="Property specs">
          <Row>
            <Field name="bedrooms" label="Bedrooms" type="number" defaultValue={p.bedrooms} />
            <Field name="bathrooms" label="Bathrooms" type="number" step="0.5" defaultValue={p.bathrooms} />
            <Field name="square_feet" label="Square feet" type="number" defaultValue={p.square_feet} />
            <Field name="livable_floors" label="Livable floors" type="number" defaultValue={p.livable_floors} />
          </Row>
          <Row>
            <Field name="basement" label="Basement" defaultValue={p.basement} hint="Yes / No — finished or unfinished" />
            <Field name="parking" label="Parking" defaultValue={p.parking} hint="Garage / Driveway / Street" />
            <Field name="hoa" label="HOA" defaultValue={p.hoa} />
          </Row>
        </Group>

        {/* ── Utilities ── */}
        <Group eyebrow="03" title="Utilities">
          <Row>
            <Field name="electricity_provider" label="Electricity provider" defaultValue={p.electricity_provider} />
            <Field name="heating" label="Heating" defaultValue={p.heating} hint="Gas, Electric, Oil, Heat pump…" />
          </Row>
          <Row>
            <Field name="cooling" label="Cooling" defaultValue={p.cooling} hint="Central A/C, Mini-split, None…" />
            <Field name="internet_provider" label="Internet provider" defaultValue={p.internet_provider} />
          </Row>
          <Row>
            <Field name="cable_provider" label="Cable / TV provider" defaultValue={p.cable_provider} />
            <Field name="wifi_name" label="Wi-Fi name" defaultValue={p.wifi_name} />
            <Field name="wifi_password" label="Wi-Fi password" defaultValue={p.wifi_password} />
          </Row>
          {/* Two-unit homes get a second network. Labels name the unit
              each network covers; leave the whole row blank for single-
              network properties and nothing downstream changes. */}
          <Row>
            <Field name="wifi_label" label="Wi-Fi 1 unit label" defaultValue={p.wifi_label} hint="Only for two-network homes — e.g. Main House" />
            <Field name="wifi_name_2" label="Wi-Fi 2 name" defaultValue={p.wifi_name_2} />
            <Field name="wifi_password_2" label="Wi-Fi 2 password" defaultValue={p.wifi_password_2} />
          </Row>
          <Row>
            <Field name="wifi_label_2" label="Wi-Fi 2 unit label" defaultValue={p.wifi_label_2} hint="e.g. Guest House / Boat House" />
          </Row>
          <Row>
            <Field name="thermostat_brand" label="Thermostat brand" defaultValue={p.thermostat_brand} hint="Nest / ecobee / Honeywell…" />
            <Field name="thermostat_code" label="Thermostat code / PIN" defaultValue={p.thermostat_code} />
          </Row>
          <Row>
            <Field name="num_tvs" label="Number of TVs" type="number" defaultValue={p.num_tvs} />
            <Field name="smart_tv" label="Smart TV?" defaultValue={p.smart_tv} hint="Yes / No" />
          </Row>
        </Group>

        {/* ── STR setup ── */}
        <Group eyebrow="04" title="STR setup">
          <Field name="currently_listed" label="Currently listed?" defaultValue={p.currently_listed} hint="Platform(s)" />
          <Field name="existing_listing_urls" label="Existing listing URL(s)" defaultValue={p.existing_listing_urls} />
          <Row>
            <Field name="str_registration_id" label="STR registration #" defaultValue={p.str_registration_id} />
            <Field name="str_insurance_carrier" label="STR insurance carrier" defaultValue={p.str_insurance_carrier} />
          </Row>
          <Field name="guest_access_method" label="Guest access method" defaultValue={p.guest_access_method} hint="Smart Lock / Key Box / Other" />
          <Row>
            <Field name="smart_lock_brand" label="Smart lock brand" defaultValue={p.smart_lock_brand} />
            <Field name="smart_lock_code" label="Smart lock code" defaultValue={p.smart_lock_code} />
          </Row>
          <Field name="security_cameras" label="Security cameras" defaultValue={p.security_cameras} hint="Yes / No — locations if yes" />
        </Group>

        {/* ── Access & notes ── */}
        <Group eyebrow="05" title="Property access & notes">
          <Field name="key_code_location" label="Key / code location" defaultValue={p.key_code_location} />
          <Field name="alarm_system" label="Alarm system" defaultValue={p.alarm_system} />
          <Row>
            <Field name="garage_code" label="Garage code" defaultValue={p.garage_code} hint="Numeric keypad code" />
            <Field name="gate_code" label="Gate code" defaultValue={p.gate_code} hint="Driveway / community gate" />
          </Row>
          <Field name="known_issues" label="Known issues" defaultValue={p.known_issues} textarea />
          <Field name="upcoming_maintenance" label="Upcoming maintenance" defaultValue={p.upcoming_maintenance} textarea />
          {/* Freeform notes live in the Property Notes accordion on the
              property page now — one row per discrete note. The form
              field that lived here has been retired in favor of the
              structured editor at /properties/[id]/notes/new. */}
        </Group>

        {/* ── Emergency contact ── */}
        <Group eyebrow="06" title="Emergency contact">
          <Row>
            <Field name="emergency_contact_name" label="Name" defaultValue={p.emergency_contact_name} />
            <Field name="emergency_contact_relationship" label="Relationship" defaultValue={p.emergency_contact_relationship} />
          </Row>
          <Row>
            <Field name="emergency_contact_phone" label="Phone" type="tel" defaultValue={formatUsPhone(p.emergency_contact_phone)} hint="(781) 223-1091" />
            <Field name="emergency_contact_email" label="Email" type="email" defaultValue={p.emergency_contact_email} />
          </Row>
        </Group>

        {/* ── Inspection & safety ── */}
        <Group eyebrow="07" title="Inspection & safety">
          <Row>
            <Field name="trash_day" label="Trash pickup day" defaultValue={p.trash_day} hint="Auto-derived from address for Gloucester — set here to override" />
            <Field name="recycling_day" label="Recycling pickup day" defaultValue={p.recycling_day} />
          </Row>
          <Field name="trash_notes" label="Trash & recycling notes" defaultValue={p.trash_notes} hint="Bin location, opt-out, special instructions" textarea />
          <Field
            name="parking_regulations"
            label="Parking regulations"
            defaultValue={p.parking_regulations}
            hint="Resident-only zones, street sweeping, snow emergencies, permit info — overrides the city default"
            textarea
          />
          <Row>
            <Field name="gas_shutoff_location" label="Gas shutoff location" defaultValue={p.gas_shutoff_location} hint="e.g. basement, behind the boiler" />
            <Field name="water_shutoff_location" label="Water shutoff location" defaultValue={p.water_shutoff_location} />
          </Row>
          <Field name="electrical_panel_location" label="Electrical panel location" defaultValue={p.electrical_panel_location} />
          <Field
            name="fire_extinguisher_locations"
            label="Fire extinguisher locations"
            defaultValue={p.fire_extinguisher_locations}
            hint="Comma-separated, e.g. kitchen under sink, basement"
            textarea
          />
          <Field
            name="smoke_detector_locations"
            label="Smoke / CO detector locations"
            defaultValue={p.smoke_detector_locations}
            hint="Each floor / hallway / bedroom"
            textarea
          />
          <Field
            name="fire_exit_locations"
            label="Fire exits"
            defaultValue={p.fire_exit_locations}
            hint="Primary + secondary egress"
            textarea
          />
          <Field name="str_permit_expires" label="STR permit expiration" defaultValue={p.str_permit_expires} hint="If known. e.g. 2027-04-30" />
        </Group>

        {/* Save button + inline error banner + draft restore live in
            EditFormShell so failures keep the form (and Dotti's typing)
            on screen instead of bouncing to the dead error page. */}
      </EditFormShell>

      <style>{editCss}</style>
    </div>
  );
}

// ─── Layout components ──────────────────────────────────────────────────────
function Group({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <div className="rt-edit-group">
      <div className="rt-edit-group-h">
        <span className="rt-edit-group-num">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      <div className="rt-edit-group-body">{children}</div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="rt-edit-row">{children}</div>;
}

type FieldProps = {
  name: string;
  label: string;
  defaultValue: string | number | null;
  type?: string;
  step?: string;
  hint?: string;
  textarea?: boolean;
};

function Field({ name, label, defaultValue, type, step, hint, textarea }: FieldProps) {
  const dv = defaultValue == null ? '' : String(defaultValue);
  return (
    <label className="rt-edit-field">
      <span className="rt-edit-label">{label}</span>
      {textarea ? (
        <textarea name={name} defaultValue={dv} rows={3} />
      ) : (
        <input name={name} type={type || 'text'} step={step} defaultValue={dv} />
      )}
      {hint && <span className="rt-edit-hint">{hint}</span>}
    </label>
  );
}

const editCss = `
  .rt-edit-group { border-top: 1px solid var(--ink); padding-top: 22px; }
  .rt-edit-group-h {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 18px;
  }
  .rt-edit-group-num {
    font-family: var(--font-mono-dash), ui-monospace, monospace;
    font-size: 11px;
    color: var(--signal);
    letter-spacing: 0.08em;
    font-weight: 500;
  }
  .rt-edit-group-h h2 {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 22px;
    font-weight: 400;
    letter-spacing: -0.01em;
    color: var(--ink);
    margin: 0;
  }
  .rt-edit-group-body { display: flex; flex-direction: column; gap: 16px; }
  .rt-edit-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
  }
  .rt-edit-field { display: flex; flex-direction: column; gap: 6px; }
  .rt-edit-label {
    font-size: 11px;
    letter-spacing: 0.06em;
    color: var(--ink);
    font-weight: 500;
  }
  .rt-edit-field input,
  .rt-edit-field textarea {
    font: inherit;
    font-size: 14px;
    color: var(--ink);
    background: var(--paper);
    border: 1px solid var(--rule);
    padding: 10px 12px;
    outline: none;
    width: 100%;
    box-sizing: border-box;
    font-family: var(--font-inter), system-ui, sans-serif;
  }
  .rt-edit-field textarea { resize: vertical; min-height: 70px; }
  .rt-edit-field input:focus,
  .rt-edit-field textarea:focus { border-color: var(--ink); }
  .rt-edit-hint { font-size: 11px; color: var(--ink-4); font-style: italic; }
`;
