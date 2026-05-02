import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { ProjectionForm } from '@/components/projections/ProjectionForm';
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
import { updateProjection, deleteProjection, markSent } from '../actions';

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
  const remove = deleteProjection.bind(null, id);
  const send = markSent.bind(null, id);

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
            maxWidth: 720,
          }}
        >
          {projection.property_address}
          <span style={{ color: 'var(--ink-3)', fontWeight: 300 }}> · </span>
          <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>{projection.prospect_name}</em>
        </h1>
      </section>

      {/* PREVIEW PANEL */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 32, width: '100%' }}>
        <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)', padding: '28px 0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 28 }}>
            <Stat
              label="Cover range"
              value={fmtMoneyRange(computed.heroLow, computed.heroHigh)}
              sub="Year 1 estimate (net)"
              accent
            />
            <Stat
              label="Year 1 (full)"
              value={fmtMoney(roundToThousand(computed.year1.mid.netPayout))}
              sub={`${fmtMoney(roundToThousand(computed.year1.low.netPayout))} – ${fmtMoney(roundToThousand(computed.year1.high.netPayout))}`}
            />
            <Stat
              label="Year 1 ramped"
              value={fmtMoney(roundToThousand(computed.year1Ramped.netPayout))}
              sub={`${computed.year1Ramped.activeMonthCount} active months`}
            />
            <Stat
              label="Year 2"
              value={fmtMoney(roundToThousand(computed.year2.netPayout))}
              sub={`+${fmtPercent(projection.year2_growth_pct)} on Year 1`}
            />
          </div>
          <div style={{ marginTop: 20, fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.6 }}>
            Tiered % rule: {fmtMoney(computed.tieredRevenue)} ({fmtPercent(computed.tieredRate)}). AirDNA 3-yr avg: {fmtMoney(computed.airdna3YrAvg, { decimals: 0 })} ({computed.airdnaYears.map((y) => y.year).join(', ')}). Blended gross: {fmtMoney(computed.blendedGrossRevenue)}. Annual cleaning: {fmtMoney(computed.year1.mid.cleaningExpense)}.
          </div>
        </div>
      </section>

      {/* DELIVERABLE LINKS + STATE ACTIONS */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 40, width: '100%' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <Link
            href={`/projections/${id}/render`}
            target="_blank"
            style={primaryActionStyle}
          >
            Projection ↗
          </Link>
          <Link
            href={`/projections/${id}/guide`}
            target="_blank"
            style={secondaryActionStyle}
          >
            Partnership Guide ↗
          </Link>
          <Link
            href={`/projections/${id}/contract`}
            target="_blank"
            style={secondaryActionStyle}
          >
            Contract ↗
          </Link>
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
          <span style={{ flex: 1 }} />
          <form action={remove}>
            <button
              type="submit"
              style={{
                background: 'transparent',
                color: 'var(--negative)',
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                padding: '14px 20px',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Delete
            </button>
          </form>
        </div>
      </section>

      {/* OWNER ONBOARDING INTAKE — public link + status */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 40, width: '100%' }}>
        <OnboardingPanel projection={projection} />
      </section>

      {/* EDIT FORM */}
      <section className="max-w-[860px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Edit inputs</div>
        <ProjectionForm action={update} initial={projection} submitLabel="Save changes" />
      </section>
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
