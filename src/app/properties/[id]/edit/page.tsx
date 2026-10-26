import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmBreadcrumb } from '@/components/HelmBreadcrumb';
import { supabaseAdmin as supabase, isServiceConfigured as isHelmConfigured } from '@/lib/supabase-admin';
import { getPropertyAccess } from '@/lib/property-access';
import { updatePropertyWithState } from '@/app/properties/actions';
import { EditFormShell } from './EditFormShell';
import type { HelmPropertyRow } from '@/lib/properties';
import { formatUsPhone } from '@/lib/phone';
import { isOwnerSession } from '@/lib/helm-access-server';
import { trashDayFact } from '@/lib/civic';

export const dynamic = 'force-dynamic';

async function getProperty(id: string): Promise<HelmPropertyRow | null> {
  if (!isHelmConfigured) return null;
  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // Access codes moved to the RLS-locked property_access table; merge them
  // back so the form's defaultValues pre-fill the same as before.
  const access = await getPropertyAccess(id);
  return { ...(data as HelmPropertyRow), ...access } as HelmPropertyRow;
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

export default async function PropertyEditPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams?: Promise<{ return?: string }>;
}) {
  const { id } = await params;
  const p = await getProperty(id);
  if (!p) notFound();

  // The statement send list and the bank digits are owner fields. The form
  // leaves them out for staff, and performPropertyUpdate leaves the columns
  // untouched for a staff save (an absent field must never clear them).
  const owner = await isOwnerSession();

  // Deep links from the Setup tab carry ?return=setup so the save redirect
  // lands back on that tab. Threaded through the form as a hidden
  // input; the action allowlists the value.
  const returnTab = (await searchParams)?.return ?? '';

  // Bind the property id to the action so the form only needs to submit
  // its FormData payload.
  const action = updatePropertyWithState.bind(null, id);

  // The trash day the street list already answers, shown as the blank's
  // placeholder so a Gloucester home does not look unset (src/lib/civic.ts).
  const isGloucester = (p.city || '').split(',')[0].trim() === 'Gloucester';
  const trash = trashDayFact(p);
  const trashPlaceholder =
    trash.kind === 'day' && trash.source === 'street' ? `${trash.day} (DPW list)` : undefined;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />

      <HelmBreadcrumb
        trail={[
          { label: p.name, href: `/properties/${p.id}` },
          { label: 'Edit facts' },
        ]}
      />

      <section className="max-w-[900px] mx-auto px-10" style={{ paddingTop: 24, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Edit facts</div>
        <h1 className="font-serif" style={{ fontSize: 40, lineHeight: 1.05, fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
          {p.name}
        </h1>
        <p style={{ marginTop: 12, fontSize: 14, color: 'var(--ink-3)', maxWidth: 640, lineHeight: 1.6 }}>
          The groups are the Facts tab&rsquo;s, in its order. Leave a field blank to clear it.
        </p>
      </section>

      <EditFormShell action={action} propertyId={p.id}>
        {returnTab ? <input type="hidden" name="return_tab" value={returnTab} /> : null}
        {/* One vocabulary: after Owner, these groups carry the Facts tab's
            names in the Facts tab's order, and their ids are the anchors the
            fact sheet's Edit links use. The empty spans keep the anchors the
            form used to have (#specs, #utilities, #str, #access) landing. */}

        {/* ── Owner ── */}
        <Group eyebrow="01" id="owner" title="Owner">
          <Row>
            <Field name="owner_full" label="Owner name" defaultValue={p.owner_full} hint="As it should read on the statement, e.g. Khristin Lambert-Vorais" />
            <Field name="owner_greeting" label="Greeting" defaultValue={p.owner_greeting} hint="First name(s) for emails, e.g. Khristin and Carol Ann" />
          </Row>
          {owner && (
            <Field name="owner_emails" label="Owner emails" defaultValue={p.owner_emails.join(', ')} hint="Comma-separated. Everyone here gets the monthly statement." />
          )}
          <Row>
            <Field name="owner_phone" label="Owner phone" type="tel" defaultValue={formatUsPhone(p.owner_phone)} hint="(781) 223-1091" />
            <Field name="owner_preferred_contact" label="Preferred contact" defaultValue={p.owner_preferred_contact} hint="email / phone / text" />
          </Row>
          <Field name="owner_mailing_address" label="Owner mailing address" defaultValue={p.owner_mailing_address} />
        </Group>

        {/* ── Entry and credentials ── */}
        <Group eyebrow="02" id="entry" title="Entry and credentials">
          <span id="access" className="rt-edit-alias" aria-hidden />
          <Field name="guest_access_method" label="Guest access" defaultValue={p.guest_access_method} hint="Smart Lock / Key Box / Other" />
          <Row>
            <Field name="smart_lock_brand" label="Smart lock brand" defaultValue={p.smart_lock_brand} />
            <Field name="smart_lock_code" label="Smart lock code" defaultValue={p.smart_lock_code} />
          </Row>
          <Field name="key_code_location" label="Key / code location" defaultValue={p.key_code_location} />
          <Row>
            <Field name="gate_code" label="Gate code" defaultValue={p.gate_code} hint="Driveway / community gate" />
            <Field name="garage_code" label="Garage code" defaultValue={p.garage_code} hint="Numeric keypad code" />
          </Row>
          <Field name="alarm_system" label="Alarm system" defaultValue={p.alarm_system} />
          <Field name="security_cameras" label="Cameras" defaultValue={p.security_cameras} hint="Yes / No, and locations if yes" />
          <Field
            name="arrival_brief"
            label="Arrival brief (crew)"
            defaultValue={p.arrival_brief}
            id="arrival"
            textarea
            hint="Colleague tone, not guest tone. Where to park, which door, what to expect on the way in. The Field packet's How to get in panel prints this."
          />
          <Field name="supply_closet_location" label="Supply closet" defaultValue={p.supply_closet_location} hint="Where cleaning supplies, linens, and paper goods are kept, e.g. basement utility room, second-floor hall closet" />
        </Group>

        {/* ── Connectivity ── */}
        <Group eyebrow="03" id="connectivity" title="Connectivity">
          <span id="utilities" className="rt-edit-alias" aria-hidden />
          <Row>
            <Field name="wifi_name" label="Wi-Fi name" defaultValue={p.wifi_name} id="wifi" />
            <Field name="wifi_password" label="Wi-Fi password" defaultValue={p.wifi_password} />
          </Row>
          {/* Two-unit homes get a second network. Labels name the unit
              each network covers; leave the whole row blank for single-
              network properties and nothing downstream changes. */}
          <Row>
            <Field name="wifi_label" label="Wi-Fi 1 unit label" defaultValue={p.wifi_label} hint="Only for two-network homes, e.g. Main House" />
            <Field name="wifi_name_2" label="Wi-Fi 2 name" defaultValue={p.wifi_name_2} />
            <Field name="wifi_password_2" label="Wi-Fi 2 password" defaultValue={p.wifi_password_2} />
          </Row>
          <Row>
            <Field name="wifi_label_2" label="Wi-Fi 2 unit label" defaultValue={p.wifi_label_2} hint="e.g. Guest House / Boat House" />
          </Row>
          <Row>
            <Field name="internet_provider" label="Internet" defaultValue={p.internet_provider} />
            <Field name="cable_provider" label="Cable / TV" defaultValue={p.cable_provider} />
          </Row>
          <Row>
            <Field name="num_tvs" label="TVs" type="number" defaultValue={p.num_tvs} />
            <Field name="smart_tv" label="Smart TV" defaultValue={p.smart_tv} hint="Yes / No" />
          </Row>
        </Group>

        {/* ── House and systems ── */}
        <Group eyebrow="04" id="house" title="House and systems">
          <span id="specs" className="rt-edit-alias" aria-hidden />
          <Row>
            <Field name="bedrooms" label="Bedrooms" type="number" defaultValue={p.bedrooms} />
            <Field name="bathrooms" label="Bathrooms" type="number" step="0.5" defaultValue={p.bathrooms} />
            <Field name="square_feet" label="Square feet" type="number" defaultValue={p.square_feet} />
            <Field name="livable_floors" label="Livable floors" type="number" defaultValue={p.livable_floors} />
          </Row>
          <Row>
            <Field name="basement" label="Basement" defaultValue={p.basement} hint="Yes / No, finished or unfinished" />
            <Field name="hoa" label="HOA" defaultValue={p.hoa} />
          </Row>
          <Row>
            <Field name="heating" label="Heating" defaultValue={p.heating} hint="Gas, Electric, Oil, Heat pump…" />
            <Field name="cooling" label="Cooling" defaultValue={p.cooling} hint="Central A/C, Mini-split, None…" />
            <Field name="electricity_provider" label="Electricity" defaultValue={p.electricity_provider} />
          </Row>
          <Row>
            <Field name="thermostat_brand" label="Smart thermostat brand" defaultValue={p.thermostat_brand} hint="Nest / ecobee / Honeywell…" />
            <Field name="thermostat_code" label="Smart thermostat code / PIN" defaultValue={p.thermostat_code} />
          </Row>
          <CheckGroup
            label="Guest gear on-site"
            hint="Tick what the home already keeps on premises. When a guest asks, we tell them it's here instead of opening a prep slip to bring one."
          >
            <CheckField name="has_pack_n_play" label="Pack-n-play" checked={p.has_pack_n_play} />
            <CheckField name="has_high_chair" label="High chair" checked={p.has_high_chair} />
            <CheckField name="has_pullout_bed" label="Pullout bed" checked={p.has_pullout_bed} />
          </CheckGroup>
          <Field
            name="pullout_linens_location"
            label="Pullout linens"
            defaultValue={p.pullout_linens_location}
            hint="Where the pullout sheets are kept, e.g. drawers under the TV. Shows on the inspection's pullout card."
          />
          <Field name="known_issues" label="Known issues" defaultValue={p.known_issues} textarea />
          <Field name="upcoming_maintenance" label="Upcoming maintenance" defaultValue={p.upcoming_maintenance} textarea />
        </Group>

        {/* ── Trash, parking and civic ── */}
        <Group eyebrow="05" id="civic" title="Trash, parking and civic">
          <Row>
            <Field
              name="trash_day"
              label="Trash day"
              defaultValue={p.trash_day}
              id="trash"
              placeholder={trashPlaceholder}
              hint={isGloucester ? 'Blank uses the DPW street list. Set it only once DPW has confirmed the day for this address.' : 'Leave blank outside Gloucester: the city schedule answers, and the guest AI would read a typed day as Gloucester\'s rule.'}
            />
            <Field name="recycling_day" label="Recycling day" defaultValue={p.recycling_day} />
          </Row>
          <Field name="trash_notes" label="Where the carts live" defaultValue={p.trash_notes} hint="Where the indoor bins and outdoor carts live. The city set-out rule is added automatically, do not repeat it here." textarea />
          <CheckGroup label="Carts" hint="Tick when we, or someone we arrange, roll the City carts out to the curb. The guest still brings them back in. The trash-day fridge card then says so instead of asking the guest to roll them out.">
            <CheckField name="carts_handled_by_us" label="We roll the carts out, not the guest" checked={p.carts_handled_by_us} />
          </CheckGroup>
          <Field name="parking" label="Parking" defaultValue={p.parking} id="parking" hint="Garage / Driveway / Street" />
          <Field
            name="parking_regulations"
            label="Parking regulations"
            defaultValue={p.parking_regulations}
            hint="Resident-only zones, street sweeping, snow emergencies, permit info. Overrides the city default."
            textarea
          />
        </Group>

        {/* ── Safety and permits ── */}
        <Group eyebrow="06" id="safety" title="Safety and permits">
          <Row>
            <Field name="gas_shutoff_location" label="Gas shutoff" defaultValue={p.gas_shutoff_location} hint="e.g. basement, behind the boiler" />
            <Field name="water_shutoff_location" label="Water shutoff" defaultValue={p.water_shutoff_location} />
          </Row>
          <Field name="electrical_panel_location" label="Electrical panel" defaultValue={p.electrical_panel_location} />
          <Field
            name="fire_extinguisher_locations"
            label="Fire extinguishers"
            defaultValue={p.fire_extinguisher_locations}
            hint="Comma-separated, e.g. kitchen under sink, basement"
            textarea
          />
          <Field
            name="smoke_detector_locations"
            label="Smoke / CO detectors"
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
          <Field name="str_permit_expires" label="STR permit expires" defaultValue={p.str_permit_expires} id="permit" hint="If known. e.g. 2027-04-30" />
          <Row>
            <Field name="str_registration_id" label="STR registration" defaultValue={p.str_registration_id} />
            <Field name="str_insurance_carrier" label="STR insurance" defaultValue={p.str_insurance_carrier} />
          </Row>
        </Group>

        {/* ── Emergency contact ── */}
        <Group eyebrow="07" id="emergency" title="Emergency contact">
          <Row>
            <Field name="emergency_contact_name" label="Name" defaultValue={p.emergency_contact_name} />
            <Field name="emergency_contact_relationship" label="Relationship" defaultValue={p.emergency_contact_relationship} />
          </Row>
          <Row>
            <Field name="emergency_contact_phone" label="Phone" type="tel" defaultValue={formatUsPhone(p.emergency_contact_phone)} hint="(781) 223-1091" />
            <Field name="emergency_contact_email" label="Email" type="email" defaultValue={p.emergency_contact_email} />
          </Row>
        </Group>

        {/* ── Listing ── */}
        <Group eyebrow="08" id="listing" title="Listing">
          <span id="str" className="rt-edit-alias" aria-hidden />
          <Field name="currently_listed" label="Currently listed" defaultValue={p.currently_listed} hint="Platform(s)" />
          <Field name="existing_listing_urls" label="Listing URLs" defaultValue={p.existing_listing_urls} />
        </Group>

        {/* ── House policy ──
            These were nine ticks in the onboarding catalog recording that
            somebody decided. The decisions themselves had nowhere to live,
            so the listing, the home guide and the concierge all had to
            invent an answer or ask. */}
        <Group eyebrow="09" id="policy-group" title="House policy">
          <Row>
            <Field
              name="default_checkin_time"
              label="Cleaner deadline"
              defaultValue={p.default_checkin_time}
              id="times"
              hint="When the home must be ready, not when the guest arrives (15:00 by default, an hour before a 16:00 guest). Drives the cleaner schedule and Field packets; never sent to the guest AI. The guest check-in is on the rate plan."
            />
            <Field
              name="default_checkout_time"
              label="Guest checkout"
              defaultValue={p.default_checkout_time}
              hint="What the guest is told, e.g. 10:00 AM. The guest AI, the automations and the rate plan all read this one."
            />
          </Row>
          <Row>
            <Field name="quiet_hours" label="Quiet hours" defaultValue={p.quiet_hours} id="policy" hint="e.g. 10pm to 8am" />
            <Field name="max_occupancy" label="Max occupancy" type="number" defaultValue={p.max_occupancy} hint="Guests, as listed. A quote above this is flagged." />
          </Row>
          <Field
            name="pet_policy"
            label="Pet policy"
            defaultValue={p.pet_policy}
            textarea
            hint="The whole answer, not yes/no: species, size, count, fee, refundable or not. A guest asking about dogs gets quoted this."
          />
          <Field
            name="smoking_policy"
            label="Smoking policy"
            defaultValue={p.smoking_policy}
            hint="Include outdoors and decks, which is the half guests actually ask about."
          />
          <Field
            name="cancellation_policy"
            label="Cancellation policy"
            defaultValue={p.cancellation_policy}
            textarea
            hint="Per channel where they differ. The OTA setting lives on the listing; this records what was chosen."
          />
          <Field name="house_rules" label="House rules" defaultValue={p.house_rules} textarea />
          <Field
            name="discount_stance"
            label="Discount stance"
            defaultValue={p.discount_stance}
            textarea
            hint="What we will and will not discount, so a reply does not have to invent one."
          />
        </Group>

        {/* ── Billing ── */}
        <Group eyebrow="10" id="billing" title="Billing">
          {owner && (
            <Field
              name="bank_last4"
              label="Bank account last 4"
              defaultValue={p.bank_last4}
              id="bank"
              maxLength={4}
              hint="Last 4 digits of the account that receives this property's deposits. Used to match Chase deposits on the monthly statement."
            />
          )}
          <Field
            name="cleaning_cost_estimate"
            label="Cleaning cost estimate"
            defaultValue={p.cleaning_cost_estimate}
            id="cleaning"
            type="number"
            step="0.01"
            hint="Expected cost per turn, in dollars. Revenue snapshots and the forecast fall back to this until real cleanings land."
          />
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
function Group({
  eyebrow,
  title,
  id,
  children,
}: {
  eyebrow: string;
  title: string;
  /** Anchor target so Facts can link straight at the group that owns a field. */
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rt-edit-group" id={id} style={{ scrollMarginTop: 100 }}>
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
  /** Anchor target so the detail page can deep-link straight to this field. */
  id?: string;
  maxLength?: number;
  placeholder?: string;
};

function Field({ name, label, defaultValue, type, step, hint, textarea, id, maxLength, placeholder }: FieldProps) {
  const dv = defaultValue == null ? '' : String(defaultValue);
  return (
    <label className="rt-edit-field" id={id}>
      <span className="rt-edit-label">{label}</span>
      {textarea ? (
        <textarea name={name} defaultValue={dv} rows={3} placeholder={placeholder} />
      ) : (
        <input name={name} type={type || 'text'} step={step} maxLength={maxLength} defaultValue={dv} placeholder={placeholder} />
      )}
      {hint && <span className="rt-edit-hint">{hint}</span>}
    </label>
  );
}

/** A labelled cluster of boolean checkboxes (e.g. on-site guest gear). */
function CheckGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rt-edit-field">
      <span className="rt-edit-label">{label}</span>
      <div className="rt-edit-checks">{children}</div>
      {hint && <span className="rt-edit-hint">{hint}</span>}
    </div>
  );
}

/** Single checkbox. An unchecked box submits nothing, so the save action
 *  reads absence as false — no hidden companion input needed. */
function CheckField({ name, label, checked }: { name: string; label: string; checked: boolean }) {
  return (
    <label className="rt-edit-check">
      <input type="checkbox" name={name} defaultChecked={checked} />
      <span>{label}</span>
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
  /* Deep-linked fields (e.g. #bank from the detail stat card) shouldn't
     land under the sticky masthead. */
  .rt-edit-field[id] { scroll-margin-top: 90px; }
  .rt-edit-alias { display: block; height: 0; scroll-margin-top: 100px; }
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
  .rt-edit-checks { display: flex; flex-wrap: wrap; gap: 20px; padding: 2px 0; }
  .rt-edit-check {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: var(--ink);
    cursor: pointer;
  }
  .rt-edit-check input {
    width: 16px;
    height: 16px;
    accent-color: var(--signal);
    cursor: pointer;
  }
`;
