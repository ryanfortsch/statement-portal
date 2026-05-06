import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { DownloadPropertyPdfButton } from '@/components/properties/DownloadPropertyPdfButton';
import { PhotoThumbs } from '@/components/PhotoUploader';
import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import type { HelmPropertyRow } from '@/lib/properties';
import { ResolveNoteButton } from './ResolveNoteButton';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

type HelmStatementRow = {
  id: string;
  month: string;
  status: string;
  num_stays: number;
  nights_booked: number;
  rental_revenue: number;
  owner_payout: number;
};

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

type PropertyNoteRow = {
  id: string;
  note_text: string;
  author_email: string;
  created_at: string;
  inspection_id: string | null;
  photo_urls: string[] | null;
};

async function getPinnedPropertyNotes(propertyId: string): Promise<PropertyNoteRow[]> {
  if (!isHelmConfigured) return [];
  try {
    const { data, error } = await supabase
      .from('inspection_notes')
      .select('id, note_text, author_email, created_at, inspection_id, photo_urls')
      .eq('property_id', propertyId)
      .eq('note_type', 'PROPERTY_NOTE')
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    return (data ?? []) as PropertyNoteRow[];
  } catch {
    return [];
  }
}

type RecentInspectionRow = {
  id: string;
  inspector_name: string;
  started_at: string | null;
  completed_at: string | null;
  total_items: number;
  pass_count: number;
  issue_count: number;
  na_count: number;
};

async function getRecentInspections(propertyId: string): Promise<RecentInspectionRow[]> {
  if (!isHelmConfigured) return [];
  try {
    const { data, error } = await supabase
      .from('inspections')
      .select('id, inspector_name, started_at, completed_at, total_items, pass_count, issue_count, na_count')
      .eq('property_id', propertyId)
      .order('started_at', { ascending: false })
      .limit(6);
    if (error) throw error;
    return (data ?? []) as RecentInspectionRow[];
  } catch {
    return [];
  }
}

async function getRecentStatements(propertyId: string): Promise<HelmStatementRow[]> {
  if (!isHelmConfigured) return [];
  try {
    const { data, error } = await supabase
      .from('property_statements')
      .select('id, num_stays, nights_booked, rental_revenue, owner_payout, statement_periods!inner(month, status)')
      .eq('property_id', propertyId)
      .order('statement_periods(month)', { ascending: false })
      .limit(6);
    if (error) throw error;
    return (data ?? []).map((row: {
      id: string;
      num_stays: number;
      nights_booked: number;
      rental_revenue: number;
      owner_payout: number;
      statement_periods: { month: string; status: string } | { month: string; status: string }[];
    }) => {
      const period = Array.isArray(row.statement_periods) ? row.statement_periods[0] : row.statement_periods;
      return {
        id: row.id,
        month: period?.month ?? '',
        status: period?.status ?? '',
        num_stays: row.num_stays,
        nights_booked: row.nights_booked,
        rental_revenue: row.rental_revenue,
        owner_payout: row.owner_payout,
      };
    });
  } catch {
    return [];
  }
}

type Params = { id: string };

export default async function PropertyDetailPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const p = await getProperty(id);
  if (!p) notFound();

  const [statements, pinnedNotes, recentInspections] = await Promise.all([
    getRecentStatements(p.id),
    getPinnedPropertyNotes(p.id),
    getRecentInspections(p.id),
  ]);

  // Internal-first display: the address-without-suffix name as the hero,
  // the external "Stay at ..." marketing title (if any) as a quieter
  // subtitle below.
  const display = p.name;
  const subtitle = p.title || '';

  // The Information Note (House & civic info) is framed around the Gloucester
  // STR permit ordinance — it cites that ordinance in the header, references
  // the city-issued STR permit ID in the footer, and pulls a Gloucester-only
  // street-keyed trash schedule. For Rockport / Beverly / out-of-state
  // properties it's the wrong document, so we hide the tile (and the
  // /info-note route 404s) anywhere outside Gloucester.
  const isGloucester = (p.city || '').split(',')[0].trim().toLowerCase() === 'gloucester';

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="properties" />

      {/* BACK + EDIT */}
      <div
        className="max-w-[1100px] mx-auto px-10"
        style={{ paddingTop: 24, width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <Link
          href="/properties"
          style={{
            fontSize: 11,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            textDecoration: 'none',
          }}
        >
          ← All Properties
        </Link>
        <Link
          href={`/properties/${p.id}/edit`}
          style={{
            fontSize: 11,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--ink)',
            textDecoration: 'none',
            border: '1px solid var(--rule)',
            padding: '8px 14px',
            fontWeight: 500,
          }}
        >
          Edit operational data
        </Link>
      </div>

      {/* HERO */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 24, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Property</div>
        <h1
          className="font-serif"
          style={{
            fontSize: 48,
            lineHeight: 1.05,
            fontWeight: 300,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            maxWidth: 720,
          }}
        >
          {display}
        </h1>
        {subtitle && (
          <p style={{ marginTop: 12, fontSize: 16, color: 'var(--ink-3)' }}>
            {subtitle}
          </p>
        )}
        <p style={{ marginTop: 6, fontSize: 14, color: 'var(--ink-3)' }}>
          {p.address}, {p.city}
        </p>

        {!p.is_active && (
          <div
            style={{
              marginTop: 18,
              padding: '8px 14px',
              borderLeft: '3px solid var(--negative)',
              background: 'var(--paper-2)',
              fontSize: 12,
              color: 'var(--negative)',
              display: 'inline-block',
            }}
          >
            <strong>Inactive</strong>
            {p.deactivated_reason ? ` · ${p.deactivated_reason}` : ''}
            {p.deactivated_at ? ` · ${formatDate(p.deactivated_at)}` : ''}
          </div>
        )}
      </section>

      {/* STAT GRID */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 56, width: '100%' }}>
        <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <Stat label="Mgmt Fee" value={`${p.management_fee_pct}%`} />
            <Stat
              label="Cleaning Est"
              value={p.cleaning_cost_estimate != null ? `$${p.cleaning_cost_estimate}` : '—'}
            />
            <Stat label="Bank ··" value={p.bank_last4 ? `**${p.bank_last4}` : '—'} />
            <Stat label="Owner" value={p.owner_last} last />
          </div>
        </div>
      </section>

      {/* GUEST DELIVERABLES — Stay Cape Ann home guide + WiFi placard + Information Note */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 48, width: '100%' }}>
        <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
          <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
            Guest Deliverables
          </h2>
          <span className="eyebrow">Stay Cape Ann</span>
        </div>
        <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 22 }}>
          <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 720 }}>
            Print-ready guest artifacts pre-populated from this property&rsquo;s onboarding answers
            (WiFi, parking, climate, safety equipment, etc). Edit operational data below to refresh.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            {/* Welcome Guide tile */}
            <div style={{ border: '1px solid var(--rule)', padding: '18px 18px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="eyebrow">Welcome Guide</div>
              <h3 className="font-serif" style={{ fontSize: 18, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
                Stay Cape Ann home guide
              </h3>
              <p style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55 }}>
                One-page editorial guide. Wi-Fi, climate, kitchen, parking, trash, hassle-free departure.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
                <Link href={`/properties/${p.id}/home-guide`} target="_blank" style={primaryActionStyle}>
                  Open ↗
                </Link>
                <DownloadPropertyPdfButton propertyId={p.id} type="home-guide" label="Download PDF" />
              </div>
            </div>
            {/* WiFi Placard tile */}
            <div style={{ border: '1px solid var(--rule)', padding: '18px 18px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="eyebrow">Wi-Fi Placard</div>
              <h3 className="font-serif" style={{ fontSize: 18, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
                4 × 6 placard with QR code
              </h3>
              <p style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55 }}>
                Auto-generated QR auto-joins the network when scanned. Slip into the glass case at the property.
                {!p.wifi_name || !p.wifi_password ? (
                  <span style={{ display: 'block', marginTop: 6, color: 'var(--negative)' }}>
                    Add Wi-Fi name + password to this property to generate the QR.
                  </span>
                ) : null}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
                <Link href={`/properties/${p.id}/wifi-placard`} target="_blank" style={primaryActionStyle}>
                  Open ↗
                </Link>
                <DownloadPropertyPdfButton propertyId={p.id} type="wifi-placard" label="Download PDF" />
              </div>
            </div>
            {/* Information Note tile — Gloucester-only. The note cites the
                Gloucester STR ordinance and renders a Gloucester-issued
                permit ID in the footer, so it's not a fit for Rockport,
                Beverly, or out-of-state properties. */}
            {isGloucester && (
              <div style={{ border: '1px solid var(--rule)', padding: '18px 18px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="eyebrow">Information Note</div>
                <h3 className="font-serif" style={{ fontSize: 18, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
                  Posted house &amp; civic info
                </h3>
                <p style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55 }}>
                  Required for the Gloucester STR permit inspection. Local contacts, trash schedule, parking,
                  noise ordinance, gas/water shutoffs, smoke alarms, fire exits, extinguishers.
                  {missingInfoNoteFields(p).length > 0 ? (
                    <span style={{ display: 'block', marginTop: 6, color: 'var(--negative)' }}>
                      Missing: {missingInfoNoteFields(p).join(', ')}.
                    </span>
                  ) : null}
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
                  <Link href={`/properties/${p.id}/info-note`} target="_blank" style={primaryActionStyle}>
                    Open ↗
                  </Link>
                  <DownloadPropertyPdfButton propertyId={p.id} type="info-note" label="Download PDF" />
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* PINNED PROPERTY NOTES (from inspections) */}
      {pinnedNotes.length > 0 && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 36, width: '100%' }}>
          <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
            <h2
              className="font-serif"
              style={{
                fontSize: 22,
                fontWeight: 400,
                letterSpacing: '-0.01em',
                color: 'var(--ink)',
                margin: 0,
              }}
            >
              Property Notes
            </h2>
            <span className="eyebrow">{pinnedNotes.length} pinned</span>
          </div>
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {pinnedNotes.map((n) => (
              <div
                key={n.id}
                style={{
                  padding: '16px 0',
                  borderBottom: '1px solid var(--rule)',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto',
                  gap: 16,
                  alignItems: 'baseline',
                }}
              >
                <div>
                  <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.5 }}>
                    {n.note_text}
                  </div>
                  {n.photo_urls && n.photo_urls.length > 0 && (
                    <PhotoThumbs urls={n.photo_urls} size={64} />
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {n.author_email.split('@')[0]}
                  <br />
                  <span style={{ fontSize: 10 }}>{formatDate(n.created_at)}</span>
                </div>
                <ResolveNoteButton noteId={n.id} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* INSPECTION HISTORY (Helm-native) */}
      {recentInspections.length > 0 && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 36, width: '100%' }}>
          <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
            <h2
              className="font-serif"
              style={{
                fontSize: 22,
                fontWeight: 400,
                letterSpacing: '-0.01em',
                color: 'var(--ink)',
                margin: 0,
              }}
            >
              Recent Inspections
            </h2>
            <span className="eyebrow">last {recentInspections.length}</span>
          </div>
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {recentInspections.map((insp) => {
              const isComplete = !!insp.completed_at;
              const href = isComplete
                ? `/inspections/${insp.id}/summary`
                : `/inspections/${insp.id}`;
              const summary = isComplete
                ? `${insp.pass_count} pass · ${insp.issue_count} issue · ${insp.na_count} N/A`
                : 'In progress';
              return (
                <Link
                  key={insp.id}
                  href={href}
                  style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '160px 1fr auto auto',
                      gap: 24,
                      alignItems: 'baseline',
                      padding: '16px 0',
                      borderBottom: '1px solid var(--rule)',
                    }}
                  >
                    <span className="font-serif" style={{ fontSize: 16, fontWeight: 400, color: 'var(--ink)' }}>
                      {formatDate(insp.completed_at ?? insp.started_at)}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{insp.inspector_name}</span>
                    <span
                      style={{
                        fontSize: 11,
                        letterSpacing: '.08em',
                        textTransform: 'uppercase',
                        color: isComplete
                          ? insp.issue_count > 0
                            ? 'var(--signal)'
                            : 'var(--positive)'
                          : 'var(--ink-4)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {summary}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                      {isComplete ? 'Summary →' : 'Resume →'}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* RECENT STATEMENTS (Helm-native) */}
      <Section
        title="Recent Statements"
        eyebrow="Helm"
        empty={statements.length === 0}
        emptyMessage="No statements for this property yet."
      >
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {statements.map((s) => (
            <Link
              key={s.id}
              href={`/statements?month=${s.month}`}
              style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '160px 1fr auto auto',
                  gap: 24,
                  alignItems: 'baseline',
                  padding: '18px 0',
                  borderBottom: '1px solid var(--rule)',
                }}
              >
                <span className="font-serif" style={{ fontSize: 18, fontWeight: 400, color: 'var(--ink)' }}>
                  {formatMonth(s.month)}
                </span>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {s.num_stays} stay{s.num_stays === 1 ? '' : 's'} · {s.nights_booked} nights
                </span>
                <span className="font-mono tabular-nums" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                  {formatCurrency(s.rental_revenue)} rev
                </span>
                <span className="font-mono tabular-nums" style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
                  {formatCurrency(s.owner_payout)} payout →
                </span>
              </div>
            </Link>
          ))}
        </div>
      </Section>

      {/* OWNER + COMMS */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 48, width: '100%' }}>
        <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
          <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
            Owner
          </h2>
          <span className="eyebrow">Helm</span>
        </div>
        <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 18 }}>
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 64px', fontSize: 13 }}>
            <Detail term="Owner" definition={p.owner_full} />
            <Detail term="Greeting" definition={p.owner_greeting} />
            <Detail
              term="Emails"
              definition={p.owner_emails.length > 0 ? p.owner_emails.join(', ') : '—'}
              mono
            />
            <Detail term="Phone" definition={p.owner_phone || '—'} mono />
            <Detail term="Mailing address" definition={p.owner_mailing_address || '—'} />
            <Detail term="Preferred contact" definition={p.owner_preferred_contact || '—'} />
            <Detail term="Tax Cert ID" definition={p.tax_cert_id || '—'} mono />
          </dl>
        </div>
      </section>

      {/* OPERATIONAL DATA — only renders when there's something to show */}
      <OperationalSections p={p} />

      {/* INSPECTIONS / WORK (still in Lovable) */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 48, width: '100%' }}>
        <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
          <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
            Inspections &amp; Work
          </h2>
          <span className="eyebrow">External</span>
        </div>
        <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 18, paddingBottom: 18 }}>
          <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 14 }}>
            Inspections, work slips, and turnover state still live in the Perfection app. Helm-native
            schemas for these are in flight; until then, click through to view them in context.
          </p>
          <a
            href="https://inspect.risingtidestr.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              border: '1px solid var(--rule)',
              padding: '8px 14px',
              fontSize: 11,
              letterSpacing: '.16em',
              textTransform: 'uppercase',
              fontWeight: 500,
              color: 'var(--ink)',
              textDecoration: 'none',
            }}
          >
            Open Perfection ↗
          </a>
        </div>
      </section>

      {/* DETAILS */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 56, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 18 }}>Details</div>
        <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 64px', fontSize: 13 }}>
          <Detail term="Helm ID" definition={p.id} mono />
          <Detail term="Code" definition={p.code || '—'} />
          <Detail term="Title" definition={p.title || '—'} />
          <Detail term="Type" definition={p.type_of_unit || '—'} />
          <Detail term="Tags" definition={p.tags || '—'} />
          <Detail term="Timezone" definition={p.timezone || '—'} />
          <Detail
            term="Coordinates"
            definition={
              p.latitude != null && p.longitude != null
                ? `${Number(p.latitude).toFixed(4)}°, ${Number(p.longitude).toFixed(4)}°`
                : '—'
            }
          />
          <Detail term="Guesty Listing ID" definition={p.guesty_listing_id || '—'} mono />
        </dl>
      </section>

      {/* ACTIVITY */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 56, flex: 1, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 18 }}>Activity</div>
        <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 64px', fontSize: 13 }}>
          <Detail term="Activated" definition={formatDate(p.activated_at)} />
          <Detail term="Created" definition={formatDate(p.created_at)} />
          <Detail term="Last Synced" definition={formatRelative(p.last_synced_at)} />
          <Detail term="Perfection ID" definition={p.perfection_id || '—'} mono />
        </dl>
      </section>

      {/* FOOTER */}
      <footer style={{ borderTop: '1px solid var(--ink)' }}>
        <div
          className="max-w-[1100px] mx-auto px-10 flex items-center justify-between"
          style={{
            padding: '14px 40px',
            fontSize: 10,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-4)',
          }}
        >
          <span>Rising Tide &middot; Properties</span>
          <span style={{ fontStyle: 'italic', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-3)', fontSize: 11 }}>
            Source: Helm
          </span>
        </div>
      </footer>
    </div>
  );
}

/**
 * Surfaces which Information Note fields are still empty so Dotti knows
 * what to backfill. Returns short labels in the order the fields appear on
 * the printed document.
 */
function missingInfoNoteFields(p: HelmPropertyRow): string[] {
  const checks: Array<[unknown, string]> = [
    [p.trash_day, 'trash day'],
    [p.parking_regulations, 'parking regs'],
    [p.gas_shutoff_location, 'gas shutoff'],
    [p.fire_extinguisher_locations, 'extinguishers'],
    [p.smoke_detector_locations, 'smoke alarms'],
    [p.fire_exit_locations, 'fire exits'],
  ];
  return checks.filter(([v]) => !v).map(([, label]) => label);
}

/** Renders any operational sections that have at least one populated field. */
type OpRow = { label: string; value: string | number | null; mono?: boolean };
const primaryActionStyle: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '13px 18px',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

function OperationalSections({ p }: { p: HelmPropertyRow }) {
  const specs: OpRow[] = [
    { label: 'Bedrooms', value: p.bedrooms },
    { label: 'Bathrooms', value: p.bathrooms },
    { label: 'Square feet', value: p.square_feet },
    { label: 'Livable floors', value: p.livable_floors },
    { label: 'Basement', value: p.basement },
    { label: 'Parking', value: p.parking },
    { label: 'HOA', value: p.hoa },
  ];
  const utilities: OpRow[] = [
    { label: 'Electricity', value: p.electricity_provider },
    { label: 'Heating', value: p.heating },
    { label: 'Cooling', value: p.cooling },
    { label: 'Internet', value: p.internet_provider },
    { label: 'Cable / TV', value: p.cable_provider },
    { label: 'WiFi name', value: p.wifi_name },
    { label: 'WiFi password', value: p.wifi_password, mono: true },
    { label: 'TVs', value: p.num_tvs },
    { label: 'Smart TV', value: p.smart_tv },
  ];
  const str: OpRow[] = [
    { label: 'Currently listed', value: p.currently_listed },
    { label: 'Listing URLs', value: p.existing_listing_urls, mono: true },
    { label: 'STR registration', value: p.str_registration_id, mono: true },
    { label: 'STR insurance', value: p.str_insurance_carrier },
    { label: 'Guest access', value: p.guest_access_method },
    { label: 'Smart lock', value: [p.smart_lock_brand, p.smart_lock_code].filter(Boolean).join(' · ') || null },
    { label: 'Cameras', value: p.security_cameras },
  ];
  const access: OpRow[] = [
    { label: 'Key / code location', value: p.key_code_location },
    { label: 'Alarm system', value: p.alarm_system },
    { label: 'Known issues', value: p.known_issues },
    { label: 'Upcoming maintenance', value: p.upcoming_maintenance },
    { label: 'Notes', value: p.property_notes },
  ];
  const emergency: OpRow[] = [
    { label: 'Name', value: p.emergency_contact_name },
    { label: 'Relationship', value: p.emergency_contact_relationship },
    { label: 'Phone', value: p.emergency_contact_phone, mono: true },
    { label: 'Email', value: p.emergency_contact_email, mono: true },
  ];
  const inspection: OpRow[] = [
    { label: 'Trash day', value: p.trash_day },
    { label: 'Recycling day', value: p.recycling_day },
    { label: 'Trash notes', value: p.trash_notes },
    { label: 'Parking regulations', value: p.parking_regulations },
    { label: 'Gas shutoff', value: p.gas_shutoff_location },
    { label: 'Water shutoff', value: p.water_shutoff_location },
    { label: 'Electrical panel', value: p.electrical_panel_location },
    { label: 'Fire extinguishers', value: p.fire_extinguisher_locations },
    { label: 'Smoke / CO detectors', value: p.smoke_detector_locations },
    { label: 'Fire exits', value: p.fire_exit_locations },
    { label: 'STR permit expires', value: p.str_permit_expires },
  ];

  const groups = [
    { title: 'Property specs', rows: specs },
    { title: 'Utilities', rows: utilities },
    { title: 'STR setup', rows: str },
    { title: 'Property access & notes', rows: access },
    { title: 'Emergency contact', rows: emergency },
    { title: 'Inspection & safety', rows: inspection },
  ];

  // Hide entirely if nothing has been onboarded yet — keeps the page clean
  // for the existing 9 hand-seeded properties that don't have intake data.
  const anything = groups.some((g) => g.rows.some((r) => r.value != null && r.value !== ''));
  if (!anything) return null;

  return (
    <>
      {groups.map((g) => {
        const populated = g.rows.filter((r) => r.value != null && r.value !== '');
        if (populated.length === 0) return null;
        return (
          <section key={g.title} className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 48, width: '100%' }}>
            <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
              <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
                {g.title}
              </h2>
              <span className="eyebrow">From onboarding</span>
            </div>
            <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 18 }}>
              <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 64px', fontSize: 13 }}>
                {populated.map((r) => (
                  <Detail key={r.label} term={r.label} definition={String(r.value)} mono={r.mono === true} />
                ))}
              </dl>
            </div>
          </section>
        );
      })}
    </>
  );
}

function Section({
  title,
  eyebrow,
  empty,
  emptyMessage,
  children,
}: {
  title: string;
  eyebrow: string;
  empty: boolean;
  emptyMessage: string;
  children: React.ReactNode;
}) {
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 48, width: '100%' }}>
      <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
        <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
          {title}
        </h2>
        <span className="eyebrow">{eyebrow}</span>
      </div>
      {empty ? (
        <div style={{ borderTop: '1px solid var(--ink)', padding: '20px 0', fontSize: 12, color: 'var(--ink-4)' }}>
          {emptyMessage}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

function Stat({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div
      style={{
        padding: '20px 20px',
        borderRight: last ? 'none' : '1px solid var(--rule)',
      }}
    >
      <div className="eyebrow" style={{ marginBottom: 6 }}>{label}</div>
      <div className="font-serif tabular-nums" style={{ fontSize: 22, fontWeight: 400, color: 'var(--ink)' }}>
        {value}
      </div>
    </div>
  );
}

function Detail({ term, definition, mono = false }: { term: string; definition: string; mono?: boolean }) {
  return (
    <div>
      <dt className="eyebrow" style={{ marginBottom: 4 }}>{term}</dt>
      <dd
        className={mono ? 'font-mono' : ''}
        style={{ color: 'var(--ink)', fontSize: mono ? 12 : 14, margin: 0 }}
      >
        {definition}
      </dd>
    </div>
  );
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  try {
    const d = new Date(value);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return value;
  }
}

function formatMonth(month: string): string {
  try {
    const [year, m] = month.split('-');
    const d = new Date(Number(year), Number(m) - 1, 1);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  } catch {
    return month;
  }
}

function formatCurrency(value: number): string {
  if (value == null) return '—';
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

function formatRelative(value: string | null): string {
  if (!value) return '—';
  try {
    const then = new Date(value).getTime();
    const now = Date.now();
    const diff = now - then;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return formatDate(value);
  } catch {
    return value;
  }
}
