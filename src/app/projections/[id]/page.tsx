import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { ProjectionForm } from '@/components/projections/ProjectionForm';
import { DownloadPdfButton } from '@/components/projections/DownloadPdfButton';
import { ContractRedlinesPanel } from '@/components/projections/ContractRedlinesPanel';
import { DeleteProspectButton } from '@/components/projections/DeleteProspectButton';
import { ResetContractButton } from '@/components/projections/ResetContractButton';
import { supabase } from '@/lib/supabase';
import type { ProjectionRow } from '@/lib/projections-types';
import {
  computeProjection,
  fmtMoney,
  fmtMoneyRange,
  fmtMonthYear,
  fmtPercent,
  roundToThousand,
} from '@/lib/projections-model';
import { updateProjection, markSent, promoteToProperty } from '../actions';

export const dynamic = 'force-dynamic';

async function getProjection(id: string): Promise<ProjectionRow | null> {
  const { data, error } = await supabase.from('projections').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return data as ProjectionRow;
}

export default async function ProjectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projection = await getProjection(id);
  if (!projection) notFound();

  const computed = computeProjection(projection);
  const update = updateProjection.bind(null, id);
  const send = markSent.bind(null, id);
  const promote = promoteToProperty.bind(null, id);

  // For the Danger zone delete confirmation: prefer the structured
  // owner's last name when populated; otherwise fall back to the last
  // token of the legacy prospect_name string. Prospects with no
  // surname at all (rare — manual entries) get a minimal "type
  // DELETE" guard so the typed-confirm panel still works.
  const ownerLastName =
    projection.owners?.[0]?.last_name?.trim() ||
    projection.prospect_name?.trim().split(/\s+/).slice(-1)[0] ||
    'DELETE';
  const hasContractEdits =
    ((projection.contract_overrides as unknown[] | null)?.length ?? 0) > 0 ||
    (projection.custom_clauses?.length ?? 0) > 0;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="projections" />

      {/* HERO */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          <Link href="/projections" style={{ color: 'var(--ink-4)', textDecoration: 'none' }}>
            ← Prospects
          </Link>
          {' · '}
          <span>{fmtMonthYear(projection.presentation_month)}</span>
          {' · '}
          <span style={{ color: projection.status === 'sent' ? 'var(--positive)' : 'var(--ink-4)' }}>
            {projection.status === 'sent' ? 'Sent' : 'Draft'}
          </span>
        </div>
        <h1
          className="font-serif"
          style={{
            fontSize: 44,
            lineHeight: 1.05,
            fontWeight: 300,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            margin: 0,
            maxWidth: 720,
          }}
        >
          {projection.property_address}
          {projection.property_city && (
            <span style={{ color: 'var(--ink-3)', fontWeight: 300 }}>
              {', '}{projection.property_city.split(',')[0]}
            </span>
          )}
        </h1>
        <p
          style={{
            marginTop: 12,
            fontSize: 14,
            color: 'var(--ink-3)',
            lineHeight: 1.5,
          }}
        >
          Prepared for{' '}
          <span style={{ color: 'var(--tide-deep)', fontStyle: 'italic' }}>
            {projection.prospect_name}
          </span>
        </p>
      </section>

      {/* PREVIEW PANEL */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 32, width: '100%' }}>
        <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)', padding: '28px 0' }}>
          {(() => {
            // Hide "Year 1 ramped" when it equals "Year 1 (full)" — happens
            // whenever the ramp covers all 12 months. Otherwise the two
            // adjacent cells show identical numbers and read as a bug.
            const fullMid = roundToThousand(computed.year1.mid.netPayout);
            const rampMid = roundToThousand(computed.year1Ramped.netPayout);
            const showRamp = rampMid !== fullMid;
            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 28 }}>
                <Stat
                  label="Cover range"
                  value={fmtMoneyRange(computed.heroLow, computed.heroHigh)}
                  sub="Year 1 estimate (net)"
                  accent
                />
                <Stat
                  label="Year 1"
                  value={fmtMoney(fullMid)}
                  sub={`${fmtMoney(roundToThousand(computed.year1.low.netPayout))} – ${fmtMoney(roundToThousand(computed.year1.high.netPayout))}`}
                />
                {showRamp && (
                  <Stat
                    label="Year 1 ramped"
                    value={fmtMoney(rampMid)}
                    sub={`${computed.year1Ramped.activeMonthCount} active months`}
                  />
                )}
                <Stat
                  label="Year 2"
                  value={fmtMoney(roundToThousand(computed.year2.netPayout))}
                  sub={`+${fmtPercent(projection.year2_growth_pct)} on Year 1`}
                />
              </div>
            );
          })()}
          <div style={{ marginTop: 20, fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.6 }}>
            Tiered % rule: {fmtMoney(computed.tieredRevenue)} ({fmtPercent(computed.tieredRate)}). AirDNA 3-yr avg: {fmtMoney(computed.airdna3YrAvg, { decimals: 0 })} ({computed.airdnaYears.map((y) => y.year).join(', ')}). Blended gross: {fmtMoney(computed.blendedGrossRevenue)}. Annual cleaning: {fmtMoney(computed.year1.mid.cleaningExpense)}.
          </div>
        </div>
      </section>

      {/* DELIVERABLE LINKS + STATE ACTIONS */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 40, width: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Open in browser */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <Link href={`/projections/${id}/render`} target="_blank" style={primaryActionStyle}>
              Projection ↗
            </Link>
            <Link href={`/projections/${id}/guide`} target="_blank" style={secondaryActionStyle}>
              Partnership Guide ↗
            </Link>
            <Link href={`/projections/${id}/contract`} target="_blank" style={secondaryActionStyle}>
              Contract ↗
            </Link>
          </div>
          {/* Download PDFs (server-rendered via Puppeteer). PDFs are
              print-final; for negotiation, the Redlines panel below
              applies edits to the projection record and re-renders. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <DownloadPdfButton projectionId={id} type="projection" label="Download Projection" />
            <DownloadPdfButton projectionId={id} type="guide" label="Download Guide" />
            <DownloadPdfButton projectionId={id} type="contract" label="Download Contract" />
          </div>
        </div>
        {/* Active state actions only — no destructive operations here.
            Reset / Delete live in the Danger zone block at the bottom
            of the page so a misclick can't wipe the prospect (Dotti hit
            an old one-click DELETE on 36 Granite thinking it would
            reset the contract). */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 18 }}>
          {projection.status === 'draft' ? (
            <form action={send}>
              <button
                type="submit"
                style={{
                  background: 'transparent',
                  color: 'var(--ink)',
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: '.18em',
                  textTransform: 'uppercase',
                  padding: '14px 20px',
                  border: '1px solid var(--ink)',
                  cursor: 'pointer',
                }}
              >
                Mark as sent
              </button>
            </form>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.08em' }}>
              Sent {projection.sent_at ? new Date(projection.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
            </span>
          )}
        </div>
      </section>

      {/* CONTRACT REDLINES — AI-driven or precise edit applier. Slots
          between the deliverable downloads and the contract signing /
          edit form so it reads as a step in the negotiation flow. */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 24, width: '100%' }}>
        <ContractRedlinesPanel projection={projection} />
      </section>

      {/* CONTRACT SIGNING: public link + signed status */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 40, width: '100%' }}>
        <ContractSigningPanel projection={projection} />
      </section>

      {/* OWNER ONBOARDING INTAKE: public link + status */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 40, width: '100%' }}>
        <OnboardingPanel projection={projection} />
      </section>

      {/* PROMOTE TO MANAGED PROPERTY */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 40, width: '100%' }}>
        <PromotePanel projection={projection} promote={promote} />
      </section>

      {/* EDIT FORM
          The `key` is set to projection.updated_at so the form fully
          remounts whenever the row's updated_at advances (after Save or
          after applyContractRedlines). Without that, the form inputs use
          `defaultValue` which only sets on mount — so the user would see
          stale values after a redline apply and risk clobbering them on
          their next Save. */}
      <section className="max-w-[860px] mx-auto px-10" style={{ paddingBottom: 40, flex: 1, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Edit inputs</div>
        <ProjectionForm
          key={projection.updated_at ?? 'no-ts'}
          action={update}
          initial={projection}
          submitLabel="Save changes"
          lastSavedAt={projection.updated_at}
        />
      </section>

      {/* DANGER ZONE
          Reset Contract = wipe all redline overrides + legacy Rider
          clauses, revert the contract to the standard template. The
          prospect record itself stays intact. This is what Dotti was
          reaching for when she hit the old one-click DELETE on the
          36 Granite prospect thinking it meant "restart the contract."

          Delete Prospect = the full destructive action. Now requires
          typing the owner's last name to confirm; nuclear option for
          when a prospect was created in error.

          Lives at the very bottom of the page, visually walled off
          with a red border so a misclick is impossible. */}
      <section className="max-w-[860px] mx-auto px-10" style={{ paddingBottom: 80, width: '100%' }}>
        <div
          style={{
            borderTop: '1px solid var(--rule)',
            paddingTop: 24,
            marginTop: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div className="eyebrow" style={{ color: 'var(--negative)' }}>Danger zone</div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 320px', minWidth: 280 }}>
              <div className="font-serif" style={{ fontSize: 16, color: 'var(--ink)', margin: '0 0 4px' }}>
                Reset contract
              </div>
              <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6, maxWidth: 480 }}>
                Clears every redline override + Rider clause applied to this prospect&rsquo;s contract.
                The contract reverts to the standard template. <strong>Prospect record, inputs,
                signing token, and onboarding intake stay intact.</strong>
              </p>
              <ResetContractButton projectionId={id} hasOverrides={hasContractEdits} />
            </div>

            <div style={{ flex: '1 1 320px', minWidth: 280 }}>
              <div className="font-serif" style={{ fontSize: 16, color: 'var(--negative)', margin: '0 0 4px' }}>
                Delete prospect
              </div>
              <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6, maxWidth: 480 }}>
                Permanently removes <strong>{projection.prospect_name}</strong> and everything tied to
                this projection. Recovery is a Supabase support ticket. Use Reset contract instead
                if you just want to restart the negotiation.
              </p>
              <DeleteProspectButton
                projectionId={id}
                prospectName={projection.prospect_name || 'this prospect'}
                prospectLastName={ownerLastName}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function ContractSigningPanel({ projection }: { projection: ProjectionRow }) {
  const signedAt = projection.contract_signed_at;
  const signedName = projection.contract_signed_name;
  const link = `/contract/${projection.onboarding_token}`;

  return (
    <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)', padding: '24px 0' }}>
      <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
        <h3 className="font-serif" style={{ fontSize: 20, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
          Contract signing
        </h3>
        <span className="eyebrow" style={{ color: signedAt ? 'var(--positive)' : 'var(--ink-4)' }}>
          {signedAt
            ? `Signed ${new Date(signedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
            : 'Not yet signed'}
        </span>
      </div>

      {!signedAt && (
        <p style={{ marginTop: 0, marginBottom: 12, fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 720 }}>
          Send this link to the owner once the contract terms are settled. They&rsquo;ll read the contract on screen, type their full legal name, and submit. Their typed name + timestamp + IP / user-agent are recorded as their electronic signature (ESIGN/UETA-compliant). Once signed, the contract PDF reflects the signature.
        </p>
      )}

      {signedAt && signedName && (
        <p style={{ marginTop: 0, marginBottom: 12, fontSize: 13, color: 'var(--ink)', lineHeight: 1.55, maxWidth: 720 }}>
          Signed by <strong>{signedName}</strong> on {new Date(signedAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}
          {projection.contract_signed_ip ? ` from ${projection.contract_signed_ip}` : ''}.
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <code
          className="font-mono"
          style={{
            flex: '1 1 320px',
            background: 'var(--paper-2)',
            border: '1px solid var(--rule)',
            padding: '10px 12px',
            fontSize: 12,
            color: 'var(--ink-3)',
            overflowX: 'auto',
            whiteSpace: 'nowrap',
          }}
        >
          {link}
        </code>
        <Link
          href={link}
          target="_blank"
          style={{
            background: 'transparent',
            color: 'var(--ink)',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            padding: '11px 18px',
            border: '1px solid var(--ink)',
            textDecoration: 'none',
          }}
        >
          Open ↗
        </Link>
      </div>
    </div>
  );
}

function OnboardingPanel({ projection }: { projection: ProjectionRow }) {
  const submitted = projection.onboarding_submitted_at;
  const data = projection.onboarding_data;
  const link = `/onboarding/${projection.onboarding_token}`;
  return (
    <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)', padding: '24px 0' }}>
      <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
        <h3 className="font-serif" style={{ fontSize: 20, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
          Owner onboarding intake
        </h3>
        <span className="eyebrow" style={{ color: submitted ? 'var(--positive)' : 'var(--ink-4)' }}>
          {submitted ? `Submitted ${new Date(submitted).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : 'Not yet submitted'}
        </span>
      </div>

      {!submitted && (
        <p style={{ marginTop: 0, marginBottom: 12, fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 720 }}>
          Send this link to the owner once the contract is signed. They&rsquo;ll fill in property details, utilities, access, and an emergency contact. Their answers land back here.
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <code
          className="font-mono"
          style={{
            flex: '1 1 320px',
            background: 'var(--paper-2)',
            border: '1px solid var(--rule)',
            padding: '10px 12px',
            fontSize: 12,
            color: 'var(--ink-3)',
            overflowX: 'auto',
            whiteSpace: 'nowrap',
          }}
        >
          {link}
        </code>
        <Link
          href={link}
          target="_blank"
          style={{
            background: 'transparent',
            color: 'var(--ink)',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            padding: '11px 18px',
            border: '1px solid var(--ink)',
            textDecoration: 'none',
          }}
        >
          Open ↗
        </Link>
      </div>

      {submitted && data && <OnboardingSummary data={data} />}
    </div>
  );
}

function OnboardingSummary({ data }: { data: NonNullable<ProjectionRow['onboarding_data']> }) {
  type Item = { label: string; value: string | undefined };
  const groups: { title: string; items: Item[] }[] = [
    {
      title: 'Personal',
      items: [
        { label: 'Name', value: data.full_name },
        { label: 'Phone', value: data.phone },
        { label: 'Email', value: data.email },
        { label: 'Mailing', value: data.mailing_address },
        { label: 'Preferred', value: data.preferred_contact },
      ],
    },
    {
      title: 'Property',
      items: [
        { label: 'Type', value: data.property_type },
        { label: 'HOA', value: data.hoa },
        { label: 'BR / BA', value: [data.bedrooms, data.bathrooms].filter(Boolean).join(' / ') || undefined },
        { label: 'Sq Ft', value: data.square_feet },
        { label: 'Floors', value: data.livable_floors },
        { label: 'Basement', value: data.basement },
        { label: 'Parking', value: data.parking },
      ],
    },
    {
      title: 'Utilities',
      items: [
        { label: 'Electric', value: data.electricity_provider },
        { label: 'Heating', value: data.heating },
        { label: 'Cooling', value: data.cooling },
        { label: 'Internet', value: data.internet_provider },
        { label: 'Cable', value: data.cable_provider },
        { label: 'WiFi name', value: data.wifi_name },
        { label: 'WiFi pass', value: data.wifi_password },
        { label: 'TVs', value: [data.num_tvs, data.smart_tv].filter(Boolean).join(' · ') || undefined },
      ],
    },
    {
      title: 'STR',
      items: [
        { label: 'Listed?', value: data.currently_listed },
        { label: 'URLs', value: data.listing_urls },
        { label: 'Reg #', value: data.str_registration },
        { label: 'Insurance', value: data.str_insurance },
        { label: 'Access', value: data.guest_access_method },
        { label: 'Smart lock', value: [data.smart_lock_brand, data.smart_lock_code].filter(Boolean).join(' · ') || undefined },
        { label: 'Cameras', value: data.security_cameras },
      ],
    },
    {
      title: 'Access & notes',
      items: [
        { label: 'Key/code', value: data.key_code_location },
        { label: 'Alarm', value: data.alarm_system },
        { label: 'Issues', value: data.known_issues },
        { label: 'Maintenance', value: data.upcoming_maintenance },
        { label: 'Notes', value: data.notes },
      ],
    },
    {
      title: 'Emergency contact',
      items: [
        { label: 'Name', value: data.emergency_name },
        { label: 'Relationship', value: data.emergency_relationship },
        { label: 'Phone', value: data.emergency_phone },
        { label: 'Email', value: data.emergency_email },
      ],
    },
  ];

  return (
    <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 28, borderTop: '1px solid var(--rule)', paddingTop: 22 }}>
      {groups.map((g) => (
        <div key={g.title}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>{g.title}</div>
          {g.items.filter((it) => !!it.value).map((it) => (
            <div key={it.label} style={{ padding: '6px 0', borderBottom: '1px solid var(--rule-soft)', fontSize: 12 }}>
              <span style={{ color: 'var(--ink-4)', display: 'inline-block', width: 92 }}>{it.label}</span>
              <span style={{ color: 'var(--ink)' }}>{it.value}</span>
            </div>
          ))}
          {g.items.every((it) => !it.value) && (
            <div style={{ padding: '6px 0', fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic' }}>No answers in this section.</div>
          )}
        </div>
      ))}
    </div>
  );
}

function PromotePanel({ projection, promote }: { projection: ProjectionRow; promote: () => Promise<void> }) {
  const promoted = !!projection.property_id;
  const submitted = !!projection.onboarding_submitted_at;

  if (promoted) {
    return (
      <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)', padding: '20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Promoted to managed property</div>
          <div style={{ fontSize: 14, color: 'var(--ink-3)' }}>
            This prospect was promoted into the Properties module.
          </div>
        </div>
        <Link
          href={`/properties/${projection.property_id}`}
          style={{
            background: 'transparent',
            color: 'var(--ink)',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            padding: '11px 18px',
            border: '1px solid var(--ink)',
            textDecoration: 'none',
          }}
        >
          Open property →
        </Link>
      </div>
    );
  }

  return (
    <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)', padding: '20px 0' }}>
      <div className="flex items-baseline justify-between" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <h3 className="font-serif" style={{ fontSize: 20, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
          Promote to managed property
        </h3>
        <span className="eyebrow" style={{ color: submitted ? 'var(--positive)' : 'var(--ink-4)' }}>
          {submitted ? 'Onboarding submitted' : 'Onboarding pending'}
        </span>
      </div>
      <p style={{ marginTop: 4, marginBottom: 14, fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 720 }}>
        Once the contract is signed and the owner has submitted the onboarding form, promote this prospect into a managed property. We&rsquo;ll create a record in <Link href="/properties" style={{ color: 'var(--ink)', textDecoration: 'underline' }}>Properties</Link> with all the operational details copied over (utilities, access, emergency contact). The prospect record stays as the sales artifact.
      </p>
      <form action={promote}>
        <button
          type="submit"
          disabled={!submitted}
          style={{
            background: submitted ? 'var(--ink)' : 'var(--paper-2)',
            color: submitted ? 'var(--paper)' : 'var(--ink-4)',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            padding: '14px 28px',
            border: 'none',
            cursor: submitted ? 'pointer' : 'not-allowed',
          }}
        >
          {submitted ? 'Promote to managed property →' : 'Awaiting onboarding submission'}
        </button>
      </form>
    </div>
  );
}

const primaryActionStyle: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '14px 28px',
  textDecoration: 'none',
};

const secondaryActionStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '13px 22px',
  textDecoration: 'none',
  border: '1px solid var(--ink)',
};

function Stat({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>
      <div
        className="font-serif tabular-nums"
        style={{
          fontSize: accent ? 30 : 24,
          fontWeight: 400,
          color: accent ? 'var(--signal)' : 'var(--ink)',
          lineHeight: 1.05,
        }}
      >
        {value}
      </div>
      {sub && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-3)' }}>{sub}</div>}
    </div>
  );
}
