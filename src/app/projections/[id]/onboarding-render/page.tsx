import { notFound } from 'next/navigation';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { ProjectionRow, OnboardingData } from '@/lib/projections-types';

export const dynamic = 'force-dynamic';

/**
 * Printable owner-onboarding intake document at
 * /projections/<id>/onboarding-render. This is the deliverable the Drive
 * archiver (and a future "download intake" button) renders to PDF — the
 * owner's submitted answers laid out as a clean record. Public via
 * proxy.ts so headless Chromium can reach it; the editor pages stay
 * auth-gated.
 *
 * Same editorial system as the other Helm deliverables: paper ground,
 * Fraunces display, grouped key/value sections. Empty fields are
 * omitted so the document only shows what the owner actually provided.
 */

async function getProjection(id: string): Promise<ProjectionRow | null> {
  const { data } = await supabase.from('projections').select('*').eq('id', id).maybeSingle();
  return (data as ProjectionRow | null) ?? null;
}

type Item = { label: string; value: string | undefined };
type Group = { title: string; items: Item[] };

function buildGroups(d: OnboardingData): Group[] {
  return [
    {
      title: 'Owner',
      items: [
        { label: 'Full name', value: d.full_name },
        { label: 'Phone', value: d.phone },
        { label: 'Email', value: d.email },
        { label: 'Mailing address', value: d.mailing_address },
        { label: 'Preferred contact', value: d.preferred_contact },
      ],
    },
    {
      title: 'Property',
      items: [
        { label: 'Address', value: d.property_address },
        { label: 'Type', value: d.property_type },
        { label: 'HOA', value: d.hoa },
        { label: 'Bedrooms', value: d.bedrooms },
        { label: 'Bathrooms', value: d.bathrooms },
        { label: 'Square feet', value: d.square_feet },
        { label: 'Livable floors', value: d.livable_floors },
        { label: 'Basement', value: d.basement },
        { label: 'Parking', value: d.parking },
      ],
    },
    {
      title: 'Utilities',
      items: [
        { label: 'Electricity', value: d.electricity_provider },
        { label: 'Heating', value: d.heating },
        { label: 'Cooling', value: d.cooling },
        { label: 'Internet', value: d.internet_provider },
        { label: 'Cable', value: d.cable_provider },
        { label: 'WiFi network', value: d.wifi_name },
        { label: 'WiFi password', value: d.wifi_password },
        { label: 'WiFi network 2', value: d.wifi_name_2 },
        { label: 'WiFi password 2', value: d.wifi_password_2 },
        { label: 'Number of TVs', value: d.num_tvs },
        { label: 'Smart TV', value: d.smart_tv },
      ],
    },
    {
      title: 'Short-term rental setup',
      items: [
        { label: 'Currently listed', value: d.currently_listed },
        { label: 'Listing URLs', value: d.listing_urls },
        { label: 'STR registration #', value: d.str_registration },
        { label: 'STR insurance', value: d.str_insurance },
        { label: 'Guest access method', value: d.guest_access_method },
        { label: 'Smart lock brand', value: d.smart_lock_brand },
        { label: 'Smart lock code', value: d.smart_lock_code },
        { label: 'Security cameras', value: d.security_cameras },
      ],
    },
    {
      title: 'Access & notes',
      items: [
        { label: 'Key / code location', value: d.key_code_location },
        { label: 'Alarm system', value: d.alarm_system },
        { label: 'Known issues', value: d.known_issues },
        { label: 'Upcoming maintenance', value: d.upcoming_maintenance },
        { label: 'Notes', value: d.notes },
      ],
    },
    {
      title: 'Emergency contact',
      items: [
        { label: 'Name', value: d.emergency_name },
        { label: 'Relationship', value: d.emergency_relationship },
        { label: 'Phone', value: d.emergency_phone },
        { label: 'Email', value: d.emergency_email },
      ],
    },
    {
      title: 'Safety & municipal',
      items: [
        { label: 'Trash day', value: d.trash_day },
        { label: 'Recycling day', value: d.recycling_day },
        { label: 'Trash notes', value: d.trash_notes },
        { label: 'Parking regulations', value: d.parking_regulations },
        { label: 'Gas shutoff', value: d.gas_shutoff_location },
        { label: 'Water shutoff', value: d.water_shutoff_location },
        { label: 'Electrical panel', value: d.electrical_panel_location },
        { label: 'Fire extinguishers', value: d.fire_extinguisher_locations },
        { label: 'Smoke detectors', value: d.smoke_detector_locations },
        { label: 'Fire exits', value: d.fire_exit_locations },
        { label: 'STR permit expires', value: d.str_permit_expires },
      ],
    },
    {
      title: 'Guest home guide',
      items: [
        { label: 'Parking', value: d.guide_parking },
        { label: 'Heating & cooling', value: d.guide_climate },
        { label: 'Bathrooms', value: d.guide_bathrooms },
        { label: 'Kitchen & appliances', value: d.guide_kitchen },
        { label: 'Special amenities', value: d.guide_amenities },
      ],
    },
  ];
}

export default async function OnboardingRenderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projection = await getProjection(id);
  if (!projection) notFound();

  const data = projection.onboarding_data;
  const ownerName = projection.prospect_full_legal || projection.prospect_name || 'Owner';
  const submitted = projection.onboarding_submitted_at
    ? new Date(projection.onboarding_submitted_at).toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York',
      })
    : null;

  // Only render groups that have at least one filled value.
  const groups = data
    ? buildGroups(data)
        .map((g) => ({ ...g, items: g.items.filter((it) => it.value && String(it.value).trim()) }))
        .filter((g) => g.items.length > 0)
    : [];

  return (
    <>
      <style>{css}</style>
      <div className="ob-doc">
        <div className="ob-page">
          <div className="ob-eyebrow">Rising Tide &middot; Owner Onboarding</div>
          <h1 className="ob-h1">Property Intake</h1>
          <div className="ob-rule" />
          <div className="ob-meta">
            <div className="ob-meta-row"><span>Property</span><span>{projection.property_address}</span></div>
            <div className="ob-meta-row"><span>Owner</span><span>{ownerName}</span></div>
            {submitted && <div className="ob-meta-row"><span>Submitted</span><span>{submitted}</span></div>}
          </div>

          {groups.length === 0 ? (
            <p className="ob-empty">No onboarding intake has been submitted for this property yet.</p>
          ) : (
            groups.map((g) => (
              <section key={g.title} className="ob-group">
                <h2 className="ob-group-title">{g.title}</h2>
                <div className="ob-kv">
                  {g.items.map((it) => (
                    <div key={it.label} className="ob-kv-row">
                      <div className="ob-k">{it.label}</div>
                      <div className="ob-v">{it.value}</div>
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </>
  );
}

const css = `
  @page { size: 8.5in 11in; margin: 56px 64px; }
  html, body { margin: 0; padding: 0; background: var(--paper, #faf7f1); }
  .ob-doc {
    font-family: var(--font-inter), system-ui, sans-serif;
    color: var(--ink, #1e2e34);
    background: var(--paper, #faf7f1);
  }
  .ob-page { max-width: 720px; margin: 0 auto; padding: 56px 64px; }
  @media print { .ob-page { padding: 0; max-width: none; } }
  .ob-eyebrow {
    font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase;
    color: var(--signal, #c85a3a); font-weight: 600; margin-bottom: 12px;
  }
  .ob-h1 {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 40px; line-height: 1.05; font-weight: 300;
    letter-spacing: -0.02em; margin: 0; color: var(--ink, #1e2e34);
  }
  .ob-rule { width: 64px; height: 2px; background: var(--signal, #c85a3a); margin: 24px 0; }
  .ob-meta { margin-bottom: 36px; font-size: 13px; }
  .ob-meta-row {
    display: flex; gap: 16px; padding: 6px 0;
    border-bottom: 1px solid var(--rule, #e8dfcc);
  }
  .ob-meta-row span:first-child {
    flex: 0 0 110px; color: var(--ink-3, #506068);
    font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; padding-top: 2px;
  }
  .ob-meta-row span:last-child { color: var(--ink, #1e2e34); font-weight: 500; }
  .ob-group { margin-bottom: 28px; break-inside: avoid; page-break-inside: avoid; }
  .ob-group-title {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 18px; font-weight: 500; color: var(--ink, #1e2e34);
    margin: 0 0 12px; padding-bottom: 8px;
    border-bottom: 1px solid var(--ink, #1e2e34);
  }
  .ob-kv { display: flex; flex-direction: column; gap: 8px; }
  .ob-kv-row { display: grid; grid-template-columns: 160px 1fr; gap: 16px; font-size: 13px; line-height: 1.5; }
  .ob-k {
    color: var(--ink-3, #506068); font-size: 10px;
    letter-spacing: 0.1em; text-transform: uppercase; padding-top: 2px;
  }
  .ob-v { color: var(--ink, #1e2e34); white-space: pre-wrap; }
  .ob-empty { font-size: 14px; color: var(--ink-3, #506068); font-style: italic; }
`;
