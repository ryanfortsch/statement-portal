import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { DownloadPropertyPdfButton } from '@/components/properties/DownloadPropertyPdfButton';
import { HomeGuideCustomizeForm } from '@/components/properties/HomeGuideCustomizeForm';
import { PhotoThumbs } from '@/components/PhotoUploader';
import { auth } from '@/auth';
import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import type { HelmPropertyRow } from '@/lib/properties';
import type { WorkSlipRow } from '@/lib/work-types';
import { ACTIVE_WORK_SLIP_STATUSES } from '@/lib/work-types';
import { displayNameForEmail } from '@/lib/team';
import { ResolveNoteButton } from './ResolveNoteButton';
import { PropertyDraftOwnerEmailButton } from './PropertyDraftOwnerEmailButton';
import { PropertyAddSlipButton } from './PropertyAddSlipButton';
import { MarkContactedButton } from './MarkContactedButton';
import { TaxCertEditor } from './TaxCertEditor';
import { PropertyActivityList, loadPropertyActivity } from './PropertyActivity';
import { PropertyOnboardingLink } from './PropertyOnboardingLink';
import { PropertyBackfillButton } from './PropertyBackfillButton';
import { CollapsibleSection, CollapsibleSubSection } from '@/components/properties/CollapsibleSection';
import { getPropertyNotices } from '@/lib/property-notices';
import { getPropertyNotes } from '@/lib/property-notes';
import { LAUNCH_STEPS, isStepResolved } from '@/lib/launch-checklist';
import type { ContactRow, ContactTouchRow } from '@/lib/crm';
import { PropertyCrmSection } from './PropertyCrmSection';

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

async function getScaLaunchStatus(
  id: string,
): Promise<{ status: string; live_url: string | null } | null> {
  try {
    const { data, error } = await supabase
      .from('sca_launches')
      .select('status, live_url')
      .eq('property_id', id)
      .maybeSingle();
    if (error) return null; // table may not exist yet on older preview envs
    return (data as { status: string; live_url: string | null }) ?? null;
  } catch {
    return null;
  }
}

/**
 * Counts of resolved (done | skipped | n_a) vs total launch-checklist
 * steps for this property, so the action-row link can render a quick
 * "Launch checklist N / M" progress chip. Falls back to a `null` row
 * (treated as 0 / total) on any error, including the table missing on
 * older preview envs.
 */
async function getLaunchProgress(
  id: string,
): Promise<{ done: number; total: number; allDone: boolean }> {
  const total = LAUNCH_STEPS.length;
  if (!isHelmConfigured) return { done: 0, total, allDone: false };
  try {
    const { data, error } = await supabase
      .from('property_launch_steps')
      .select('step_key, status')
      .eq('property_id', id);
    if (error) return { done: 0, total, allDone: false };
    const rows = (data ?? []) as { step_key: string; status: import('@/lib/launch-checklist').LaunchStepStatus }[];
    const byKey = new Map(rows.map((r) => [r.step_key, r.status]));
    let done = 0;
    for (const step of LAUNCH_STEPS) {
      if (isStepResolved(byKey.get(step.key))) done += 1;
    }
    return { done, total, allDone: done >= total };
  } catch {
    return { done: 0, total, allDone: false };
  }
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

type ContactVia = 'email' | 'phone' | 'sms' | 'in_person' | 'other' | 'work-slip-email';
type LatestOwnerContact = {
  at: string;
  via: ContactVia;
  by_email: string | null;
} | null;

/**
 * Returns the most-recent owner contact for this property, considering both
 * sources:
 *   1. properties.owner_last_contacted_at (free-form touches via the
 *      MarkContactedButton)
 *   2. MAX(work_slips.owner_last_contacted_at) on this property (Draft
 *      Owner Email path from #136)
 *
 * Whichever is more recent wins. Returns null if no contact has ever been
 * recorded.
 */
/**
 * Full contact rows for the property's CRM section. Drives the inline
 * "Contacts" dropdown so the operator sees emails, phone, organization,
 * and recent touches without bouncing out to /crm. Co-loaded with
 * getCrmTouchesForProperty so touches can be grouped under their owning
 * contact in the same render.
 */
async function getCrmContactsFullForProperty(propertyId: string): Promise<ContactRow[]> {
  if (!isHelmConfigured) return [];
  try {
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .contains('linked_property_ids', [propertyId])
      .order('type', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw error;
    return (data ?? []) as ContactRow[];
  } catch {
    return [];
  }
}

/**
 * Pulls the last ~20 touches across every contact linked to this
 * property and returns them grouped by contact_id. Per-contact ordering
 * is most-recent first (the input order is preserved by the reducer).
 */
async function getCrmTouchesForProperty(propertyId: string): Promise<Record<string, ContactTouchRow[]>> {
  if (!isHelmConfigured) return {};
  try {
    // Resolve contact ids first, then pull their touches in one query.
    // Avoids a join via the contacts table and keeps the query simple
    // (Supabase JS doesn't compose contains() across joined relations
    // cleanly).
    const { data: contactIds } = await supabase
      .from('contacts')
      .select('id')
      .contains('linked_property_ids', [propertyId]);
    const ids = ((contactIds ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (ids.length === 0) return {};

    const { data, error } = await supabase
      .from('contact_touches')
      .select('*')
      .in('contact_id', ids)
      .order('touched_at', { ascending: false })
      .limit(60);
    if (error) throw error;

    const grouped: Record<string, ContactTouchRow[]> = {};
    for (const t of ((data ?? []) as ContactTouchRow[])) {
      const arr = grouped[t.contact_id] ?? [];
      arr.push(t);
      grouped[t.contact_id] = arr;
    }
    return grouped;
  } catch {
    return {};
  }
}

async function getLatestOwnerContact(propertyId: string, p: HelmPropertyRow): Promise<LatestOwnerContact> {
  if (!isHelmConfigured) return null;
  try {
    const { data } = await supabase
      .from('work_slips')
      .select('owner_last_contacted_at')
      .eq('property_id', propertyId)
      .not('owner_last_contacted_at', 'is', null)
      .order('owner_last_contacted_at', { ascending: false })
      .limit(1);
    const slipAt = ((data ?? [])[0] as { owner_last_contacted_at: string | null } | undefined)?.owner_last_contacted_at ?? null;
    const propAt = p.owner_last_contacted_at;
    const propVia = (p.owner_last_contacted_via as ContactVia | null) ?? 'other';

    if (!slipAt && !propAt) return null;
    if (!propAt) return { at: slipAt!, via: 'work-slip-email', by_email: null };
    if (!slipAt) return { at: propAt, via: propVia, by_email: p.owner_last_contacted_by_email };
    return propAt > slipAt
      ? { at: propAt, via: propVia, by_email: p.owner_last_contacted_by_email }
      : { at: slipAt, via: 'work-slip-email', by_email: null };
  } catch {
    return null;
  }
}

async function getOpenWorkSlips(propertyId: string): Promise<WorkSlipRow[]> {
  if (!isHelmConfigured) return [];
  try {
    const todayIso = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('work_slips')
      .select('*')
      .eq('property_id', propertyId)
      .in('status', ACTIVE_WORK_SLIP_STATUSES)
      .or(`snoozed_until.is.null,snoozed_until.lte.${todayIso}`)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    return (data ?? []) as WorkSlipRow[];
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

  const [statements, pinnedNotes, recentInspections, openSlips, latestOwnerContact, crmContactsFull, crmTouchesByContact, activityEvents, propertyNotices, propertyNotes, session, scaLaunch, launchProgress] = await Promise.all([
    getRecentStatements(p.id),
    getPinnedPropertyNotes(p.id),
    getRecentInspections(p.id),
    getOpenWorkSlips(p.id),
    getLatestOwnerContact(p.id, p),
    getCrmContactsFullForProperty(p.id),
    getCrmTouchesForProperty(p.id),
    loadPropertyActivity(p),
    getPropertyNotices(p.id),
    getPropertyNotes(p.id),
    auth(),
    getScaLaunchStatus(p.id),
    getLaunchProgress(p.id),
  ]);
  const myEmail = session?.user?.email ?? '';

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

  // Summary chips for the closed state of each collapsible. Glanceable so
  // the page stays scannable without expanding every section.
  const ownerSummaryParts: string[] = [];
  ownerSummaryParts.push(
    latestOwnerContact
      ? `last contacted ${formatRelativeOrAbsolute(latestOwnerContact.at)} · ${contactChannelLabel(latestOwnerContact.via)}`
      : 'no contact logged yet',
  );
  if (p.onboarding_submitted_at) {
    ownerSummaryParts.push(`intake submitted ${formatRelativeOrAbsolute(p.onboarding_submitted_at)}`);
  } else if (p.onboarding_token) {
    ownerSummaryParts.push('intake link generated');
  }
  const ownerSummary = ownerSummaryParts.join(' · ');
  const statementsSummary =
    statements.length === 0
      ? 'no statements yet'
      : `${formatMonth(statements[0].month)} · ${formatCurrency(statements[0].owner_payout)} payout`;
  const inspectionsSummary = (() => {
    if (recentInspections.length === 0) return 'no inspections yet';
    const last = recentInspections[0];
    const date = formatDate(last.completed_at ?? last.started_at);
    if (!last.completed_at) return `${date} · in progress`;
    const issues = last.issue_count;
    return `${date} · ${issues} ${issues === 1 ? 'issue' : 'issues'}`;
  })();
  const activitySummary =
    activityEvents.length === 0
      ? 'quiet'
      : `${activityEvents.length} ${activityEvents.length === 1 ? 'event' : 'events'} · last ${formatRelative(activityEvents[0].at)}`;

  // CRM section summary: contact count + most-recent touch across the
  // whole set, so the closed-state chip reads like "3 contacts · last
  // touch 4d ago" rather than just a count. Each touches array is
  // already sorted desc, so the head of each is the candidate.
  const touchHeads: ContactTouchRow[] = (Object.values(crmTouchesByContact) as ContactTouchRow[][])
    .map((arr) => arr[0])
    .filter((t): t is ContactTouchRow => t != null);
  const mostRecentTouch: ContactTouchRow | null =
    touchHeads.length === 0
      ? null
      : touchHeads.reduce((acc, t) => (t.touched_at > acc.touched_at ? t : acc));
  const contactsSummary =
    crmContactsFull.length === 0
      ? 'no contacts linked'
      : `${crmContactsFull.length} ${crmContactsFull.length === 1 ? 'contact' : 'contacts'}${mostRecentTouch ? ` · last touch ${formatRelative(mostRecentTouch.touched_at)}` : ''}`;
  const operationalCounts = countOperationalFields(p);
  const operationalSummary =
    operationalCounts.populated === 0
      ? 'not yet onboarded'
      : `${operationalCounts.populated} of ${operationalCounts.total} fields populated`;

  // Guest-deliverable readiness: welcome guide + welcome card are always
  // ready (no per-property data needed); WiFi placard gates on wifi_name +
  // wifi_password; info note (Gloucester-only) gates on the six fields the
  // doc renders. Bespoke notices are by definition optional, so they ride
  // alongside in the summary as a separate count.
  const totalDeliverables = 3 + (isGloucester ? 1 : 0);
  const wifiReady = Boolean(p.wifi_name && p.wifi_password);
  const infoNoteReady = isGloucester && missingInfoNoteFields(p).length === 0;
  const readyDeliverables = 2 + (wifiReady ? 1 : 0) + (infoNoteReady ? 1 : 0);
  const noticeCountLabel = propertyNotices.length === 1 ? '1 bespoke notice' : `${propertyNotices.length} bespoke notices`;
  const standardSummary =
    readyDeliverables === totalDeliverables
      ? `${totalDeliverables} ready to print`
      : `${readyDeliverables} of ${totalDeliverables} ready · needs data`;
  const deliverablesSummary =
    propertyNotices.length === 0
      ? standardSummary
      : `${standardSummary} · ${noticeCountLabel}`;

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Launch checklist entry-point. The page existed but was
              unlinked from anywhere, so it was effectively hidden. Lives
              at /properties/<id>/launch — 18 steps across Identity /
              Financial / Listing / Integrations / Owner-facing / Launch.
              Chip color flips positive once every step is resolved
              (done / skipped / n/a). */}
          <Link
            href={`/properties/${p.id}/launch`}
            title={
              launchProgress.allDone
                ? 'Launch checklist complete'
                : `Launch checklist: ${launchProgress.done} of ${launchProgress.total} resolved`
            }
            style={{
              fontSize: 11,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              color: launchProgress.allDone ? 'var(--positive)' : 'var(--ink)',
              textDecoration: 'none',
              border: `1px solid ${launchProgress.allDone ? 'var(--positive)' : 'var(--rule)'}`,
              padding: '8px 14px',
              fontWeight: 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span>Launch checklist</span>
            <span
              style={{
                fontFamily: 'var(--font-mono-dash), ui-monospace, monospace',
                fontSize: 10,
                letterSpacing: '0.04em',
                color: launchProgress.allDone ? 'var(--positive)' : 'var(--ink-3)',
              }}
            >
              {launchProgress.done}/{launchProgress.total}
            </span>
            <span aria-hidden>{launchProgress.allDone ? '✓' : '→'}</span>
          </Link>
          <Link
            href={`/properties/${p.id}/stay-cape-ann`}
            title={scaLaunch?.status === 'live' ? 'Live on staycapeann.com' : 'Launch this property on staycapeann.com'}
            style={{
              fontSize: 11,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              color: scaLaunch?.status === 'live' ? 'var(--positive)' : 'var(--ink)',
              textDecoration: 'none',
              border: `1px solid ${scaLaunch?.status === 'live' ? 'var(--positive)' : 'var(--rule)'}`,
              padding: '8px 14px',
              fontWeight: 500,
            }}
          >
            Stay Cape Ann {scaLaunch?.status === 'live' ? '✓' : scaLaunch?.status === 'pr_open' ? '•' : '→'}
          </Link>
          <Link
            href={`/channels/${p.id}`}
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
            Channels →
          </Link>
          <Link
            href={`/properties/${p.id}/layout`}
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
            Inspection layout →
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
      </div>

      {/* BACKFILL — pulls beds/baths/type/lat-lng from Guesty's listing
          metadata and applies smart defaults from data already on file.
          Fill-blanks-only, never overwrites curated values. */}
      <div
        className="max-w-[1100px] mx-auto px-10"
        style={{ paddingTop: 14, width: '100%', display: 'flex', justifyContent: 'flex-end' }}
      >
        <PropertyBackfillButton propertyId={p.id} />
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
          <div className="rt-helm-stat-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
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

      {/* OPEN WORK SLIPS */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 36, width: '100%' }}>
        <div className="flex items-baseline justify-between flex-wrap" style={{ marginBottom: 14, gap: 12 }}>
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
            Open Work
          </h2>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
            <span className="eyebrow">
              {openSlips.length} {openSlips.length === 1 ? 'slip' : 'slips'}
              {(() => {
                const ownerCount = openSlips.filter((s) => s.owner_action_required).length;
                return ownerCount > 0 ? ` · ${ownerCount} owner action` : '';
              })()}
            </span>
            <PropertyAddSlipButton propertyId={p.id} propertyName={p.name} myEmail={myEmail} />
            <PropertyDraftOwnerEmailButton
              propertyId={p.id}
              disabled={openSlips.filter((s) => s.owner_action_required).length === 0}
            />
            {openSlips.length > 0 && (
              <Link
                href={`/properties/${p.id}/work-slips/print`}
                style={{
                  fontSize: 11,
                  letterSpacing: '.18em',
                  textTransform: 'uppercase',
                  color: 'var(--ink)',
                  textDecoration: 'none',
                  border: '1px solid var(--ink)',
                  padding: '8px 14px',
                  fontWeight: 600,
                }}
              >
                Print →
              </Link>
            )}
          </div>
        </div>

        {openSlips.length === 0 ? (
          <div
            style={{
              borderTop: '1px solid var(--ink)',
              padding: '28px 0',
              textAlign: 'center',
              color: 'var(--ink-3)',
              fontSize: 13,
            }}
          >
            No open work for this property.
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {openSlips.map((s) => (
              <Link
                key={s.id}
                href={`/work/${s.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '14px 0',
                  borderBottom: '1px solid var(--rule)',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    flexShrink: 0,
                    background:
                      s.priority === 'high' ? 'var(--negative)' :
                      s.priority === 'normal' ? 'var(--ink-3)' :
                      'var(--ink-4)',
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: 'var(--ink)' }}>{s.title}</div>
                  <div style={{ marginTop: 3, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.06em' }}>
                    {s.assigned_to_label || (s.assigned_to_email ? displayNameForEmail(s.assigned_to_email) : 'Unclaimed')}
                    {s.location ? ` · ${s.location}` : ''}
                    {s.scheduled_date ? ` · scheduled ${s.scheduled_date}` : ''}
                  </div>
                </div>
                {s.owner_action_required && (
                  <span
                    style={{
                      fontSize: 9,
                      letterSpacing: '.16em',
                      textTransform: 'uppercase',
                      color: 'var(--signal)',
                      border: '1px solid var(--signal)',
                      padding: '2px 8px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Owner
                  </span>
                )}
                <span
                  style={{
                    fontSize: 9,
                    letterSpacing: '.16em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-3)',
                    border: '1px solid var(--ink-3)',
                    padding: '2px 8px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.status.replace('_', ' ')}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* OWNER — first collapsible because it's the most-used reference
          when triaging open work above. */}
      <CollapsibleSection title="Owner" summary={ownerSummary}>
        <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 64px', fontSize: 13 }}>
          <Detail term="Owner" definition={p.owner_full} />
          <Detail term="Greeting" definition={p.owner_greeting} />

          <div>
            <dt className="eyebrow" style={{ marginBottom: 4 }}>Emails</dt>
            <dd className="font-mono" style={{ color: 'var(--ink)', fontSize: 12, margin: 0, lineHeight: 1.7 }}>
              {p.owner_emails.length === 0 ? '—' : p.owner_emails.map((e, i) => (
                <span key={e}>
                  {i > 0 && <span style={{ color: 'var(--ink-4)' }}>, </span>}
                  <a
                    href={`mailto:${e}`}
                    style={{ color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: 3 }}
                  >
                    {e}
                  </a>
                </span>
              ))}
            </dd>
          </div>

          <div>
            <dt className="eyebrow" style={{ marginBottom: 4 }}>Phone</dt>
            <dd className="font-mono" style={{ color: 'var(--ink)', fontSize: 12, margin: 0 }}>
              {p.owner_phone ? (
                <a
                  href={`tel:${p.owner_phone.replace(/[^+\d]/g, '')}`}
                  style={{ color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: 3 }}
                >
                  {p.owner_phone}
                </a>
              ) : '—'}
            </dd>
          </div>

          <Detail term="Mailing address" definition={p.owner_mailing_address || '—'} />
          <Detail term="Preferred contact" definition={p.owner_preferred_contact || '—'} />
          <div>
            <dt className="eyebrow" style={{ marginBottom: 4 }}>Last contacted</dt>
            <dd style={{ color: 'var(--ink)', fontSize: 14, margin: 0, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span>
                {latestOwnerContact ? formatRelativeOrAbsolute(latestOwnerContact.at) : '—'}
                {latestOwnerContact?.via && (
                  <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em' }}>
                    ({contactChannelLabel(latestOwnerContact.via)})
                  </span>
                )}
              </span>
              <MarkContactedButton propertyId={p.id} />
            </dd>
          </div>
          <div>
            <dt className="eyebrow" style={{ marginBottom: 4 }}>Tax Cert ID</dt>
            <dd style={{ margin: 0 }}>
              <TaxCertEditor propertyId={p.id} initial={p.tax_cert_id} />
            </dd>
          </div>
        </dl>

        {/* The "In CRM" chip block that used to live here was lifted out
            into a dedicated Contacts section below, which shows the full
            contact rows + recent touches inline. The chip strip would
            have been a duplicate cross-link to the same data. */}

        {/* Public onboarding-form link. Lazily generated; once minted,
            the same URL backfills this property's operational columns
            from the owner's answers (utilities, access, emergency, etc.). */}
        <PropertyOnboardingLink
          propertyId={p.id}
          initialToken={p.onboarding_token}
          submittedAt={p.onboarding_submitted_at}
        />
      </CollapsibleSection>

      {/* CONTACTS — folds the CRM into the property page. Every contact
          linked to this property surfaces here with email, phone, and
          recent touches inline, so the operator doesn't have to bounce
          to /crm/[id] to see what's been said. */}
      <CollapsibleSection title="Contacts" summary={contactsSummary}>
        <PropertyCrmSection
          contacts={crmContactsFull}
          touchesByContact={crmTouchesByContact}
        />
      </CollapsibleSection>

      {/* PROPERTY NOTES — internal per-property knowledge base. Each
          row is a discrete note (quirk / workaround / vendor / warning).
          Closed-state chip surfaces the open count so a single glance
          tells you whether there's tribal knowledge attached. */}
      <CollapsibleSection
        title="Property Notes"
        summary={(() => {
          const open = propertyNotes.filter((n) => !n.resolved_at).length;
          const total = propertyNotes.length;
          if (total === 0) return 'no notes yet';
          if (open === total) return `${total} note${total === 1 ? '' : 's'}`;
          return `${open} open · ${total - open} resolved`;
        })()}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <Link
            href={`/properties/${p.id}/notes/new`}
            style={{
              fontSize: 11,
              letterSpacing: '.16em',
              textTransform: 'uppercase',
              fontWeight: 500,
              color: 'var(--paper)',
              background: 'var(--ink)',
              border: '1px solid var(--ink)',
              padding: '6px 12px',
              textDecoration: 'none',
            }}
          >
            + Add note
          </Link>
        </div>
        {propertyNotes.length === 0 ? (
          <div style={{ padding: '14px 0', color: 'var(--ink-3)', fontSize: 13 }}>
            Nothing captured yet. The first note for {p.name} could be the smart-thermostat
            quirk, a stuck door, a neighbor who reaches out, or a vendor contact.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {propertyNotes.map((n) => (
              <Link
                key={n.id}
                href={`/properties/${p.id}/notes/${n.id}/edit`}
                style={{
                  display: 'block',
                  padding: '14px 16px',
                  border: '1px solid var(--rule)',
                  background: n.resolved_at ? 'var(--paper-2)' : 'var(--paper)',
                  textDecoration: 'none',
                  color: 'inherit',
                  opacity: n.resolved_at ? 0.7 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <h3
                    className="font-serif"
                    style={{
                      fontSize: 16,
                      fontWeight: 500,
                      letterSpacing: '-0.005em',
                      color: 'var(--ink)',
                      margin: 0,
                      flex: 1,
                      textDecoration: n.resolved_at ? 'line-through' : 'none',
                    }}
                  >
                    {n.title}
                  </h3>
                  {n.tag && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        letterSpacing: '.16em',
                        textTransform: 'uppercase',
                        color: 'var(--ink-3)',
                        border: '1px solid var(--rule)',
                        padding: '2px 7px',
                      }}
                    >
                      {n.tag}
                    </span>
                  )}
                  {n.resolved_at && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        letterSpacing: '.16em',
                        textTransform: 'uppercase',
                        color: 'var(--positive)',
                      }}
                    >
                      Resolved
                    </span>
                  )}
                </div>
                {n.body && (
                  <p style={{ marginTop: 6, marginBottom: 0, fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                    {n.body}
                  </p>
                )}
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em' }}>
                  {n.author_email ? `${n.author_email.split('@')[0]} · ` : ''}
                  {formatDate(n.created_at)}
                </div>
              </Link>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {/* ACTIVITY FEED */}
      <CollapsibleSection title="Activity" summary={activitySummary}>
        <PropertyActivityList events={activityEvents} />
      </CollapsibleSection>

      {/* INSPECTION HISTORY (Helm-native) */}
      <CollapsibleSection title="Recent Inspections" summary={inspectionsSummary}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <Link
            href={`/operations?property=${p.id}`}
            title="Open Operations filtered to this property to schedule a walk before an upcoming check-in"
            style={{
              fontSize: 11,
              letterSpacing: '.16em',
              textTransform: 'uppercase',
              fontWeight: 500,
              color: 'var(--paper)',
              background: 'var(--ink)',
              border: '1px solid var(--ink)',
              padding: '6px 12px',
              textDecoration: 'none',
            }}
          >
            Plan a walk
          </Link>
        </div>
        {recentInspections.length === 0 && (
          <div style={{ padding: '14px 0', color: 'var(--ink-3)', fontSize: 13 }}>
            No inspections recorded for this property yet.
          </div>
        )}
        {recentInspections.length > 0 && (
          <div>
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
        )}
      </CollapsibleSection>

      {/* RECENT STATEMENTS (Helm-native) */}
      <CollapsibleSection title="Recent Statements" summary={statementsSummary}>
        {statements.length === 0 ? (
          <div style={{ padding: '14px 0', color: 'var(--ink-3)', fontSize: 13 }}>
            No statements for this property yet.
          </div>
        ) : (
          <div>
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
        )}
      </CollapsibleSection>

      {/* OPERATIONAL DATA — collapsed by default; expand for the six subgroups */}
      {operationalCounts.populated > 0 && (
        <CollapsibleSection title="Operational data" summary={operationalSummary}>
          <OperationalSections p={p} />
        </CollapsibleSection>
      )}

      {/* REFERENCE — Helm IDs, sync state, and the Perfection link, all in one
          quiet block at the bottom. Used rarely; collapsed by default. */}
      <CollapsibleSection title="Reference" summary="IDs · timestamps · external links">
        <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 64px', fontSize: 13, marginBottom: 24 }}>
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
          <Detail term="Activated" definition={formatDate(p.activated_at)} />
          <Detail term="Created" definition={formatDate(p.created_at)} />
          <Detail term="Last Synced" definition={formatRelative(p.last_synced_at)} />
          <Detail term="Perfection ID" definition={p.perfection_id || '—'} mono />
        </dl>
        <div style={{ paddingTop: 14, borderTop: '1px dotted var(--rule)' }}>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>
            Inspections, work slips, and turnover state still live in the Perfection app for some
            workflows. Helm-native versions cover most cases above; click through if you need
            the legacy view.
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
      </CollapsibleSection>

      {/* GUEST DELIVERABLES — Stay Cape Ann home guide + WiFi placard +
          Information Note. Collapsed by default and parked at the bottom
          since these are produced once at onboarding then occasionally
          reprinted, not consulted day-to-day. */}
      <CollapsibleSection title="Guest Deliverables" summary={deliverablesSummary}>
        <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 720 }}>
          Print-ready guest artifacts pre-populated from this property&rsquo;s onboarding answers
          (WiFi, parking, climate, safety equipment, etc). Edit operational data above to refresh.
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
          {/* Welcome Card tile — 4 × 6 on-arrival card combining the warm
              welcome with a subscribe pitch. QR points to
              staycapeann.com/contact. Universal copy (no per-property data),
              so it's always ready to print. */}
          <div style={{ border: '1px solid var(--rule)', padding: '18px 18px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="eyebrow">Welcome Card</div>
            <h3 className="font-serif" style={{ fontSize: 18, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
              4 × 6 welcome + subscribe card
            </h3>
            <p style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55 }}>
              On-arrival counter card. &ldquo;Welcome.&rdquo; on top, a soft subscribe pitch on the bottom with a QR
              to staycapeann.com/contact.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
              <Link href={`/properties/${p.id}/welcome-card`} target="_blank" style={primaryActionStyle}>
                Open ↗
              </Link>
              <DownloadPropertyPdfButton propertyId={p.id} type="welcome-card" label="Download PDF" />
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

        {/* BESPOKE NOTICES — 4 × 6 SCA placards for property-specific quirks
            (e.g. "please run the bathroom fan during showers"). Same brand
            language as the WiFi placard so a stack of these in a glass
            case reads as one consistent set. */}
        <div style={{ marginTop: 32, paddingTop: 22, borderTop: '1px solid var(--rule)' }}>
          <div className="flex items-baseline justify-between" style={{ marginBottom: 6 }}>
            <h3 className="font-serif" style={{ fontSize: 18, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
              Bespoke notices
            </h3>
            <Link
              href={`/properties/${p.id}/notices/new`}
              style={{
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                color: 'var(--ink)',
                textDecoration: 'none',
                padding: '8px 14px',
                border: '1px solid var(--ink)',
              }}
            >
              + New notice
            </Link>
          </div>
          <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 720 }}>
            Property-specific 4 × 6 placards for things the standardized deliverables don&rsquo;t cover.
            Same Stay Cape Ann brand language; sized for the same glass case slot as the WiFi placard.
          </p>

          {propertyNotices.length === 0 ? (
            <div style={{ padding: '14px 0', fontSize: 13, color: 'var(--ink-4)', fontStyle: 'italic' }}>
              No notices yet.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
              {propertyNotices.map((n) => (
                <div
                  key={n.id}
                  style={{ border: '1px solid var(--rule)', padding: '18px 18px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}
                >
                  {n.eyebrow ? <div className="eyebrow">{n.eyebrow}</div> : <div className="eyebrow" style={{ opacity: 0.4 }}>Notice</div>}
                  <h4 className="font-serif" style={{ fontSize: 17, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0, lineHeight: 1.2 }}>
                    {n.title}
                  </h4>
                  <p style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {n.body}
                  </p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
                    <Link href={`/properties/${p.id}/notice/${n.id}`} target="_blank" style={primaryActionStyle}>
                      Open ↗
                    </Link>
                    <DownloadPropertyPdfButton
                      propertyId={p.id}
                      type="notice"
                      noticeId={n.id}
                      label="Download PDF"
                    />
                    <Link
                      href={`/properties/${p.id}/notices/${n.id}/edit`}
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        letterSpacing: '.18em',
                        textTransform: 'uppercase',
                        color: 'var(--ink-3)',
                        textDecoration: 'none',
                        padding: '13px 14px',
                      }}
                    >
                      Edit
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Per-cell free-form overrides for the home guide. Collapsed
              by default; expanded state lets staff replace any cell's
              auto-populated body with custom prose for properties that
              need variability the structured fields can't express. */}
          <HomeGuideCustomizeForm propertyId={p.id} overrides={p.home_guide_overrides} />
        </div>
      </CollapsibleSection>

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

/** Builds the six operational-data row groups in display order. Shared by
 *  the renderer (which shows only populated rows per group) and the field
 *  counter (which folds populated/total counts up into the parent header). */
function operationalGroups(p: HelmPropertyRow) {
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
    { label: 'Smart thermostat', value: [p.thermostat_brand, p.thermostat_code].filter(Boolean).join(' · ') || null },
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
    { label: 'Garage code', value: p.garage_code, mono: true },
    { label: 'Gate code', value: p.gate_code, mono: true },
    { label: 'Known issues', value: p.known_issues },
    { label: 'Upcoming maintenance', value: p.upcoming_maintenance },
    // Freeform notes have been moved to the structured Property Notes
    // accordion (renders above this section). See public.property_notes
    // and src/lib/property-notes.ts.
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
  return [
    { title: 'Property specs', rows: specs },
    { title: 'Utilities', rows: utilities },
    { title: 'STR setup', rows: str },
    { title: 'Property access & notes', rows: access },
    { title: 'Emergency contact', rows: emergency },
    { title: 'Inspection & safety', rows: inspection },
  ];
}

/** Total / populated count across all operational groups. Drives the
 *  parent CollapsibleSection's summary chip ("23 of 43 fields populated"). */
function countOperationalFields(p: HelmPropertyRow): { populated: number; total: number } {
  const groups = operationalGroups(p);
  let total = 0;
  let populated = 0;
  for (const g of groups) {
    for (const r of g.rows) {
      total++;
      if (r.value != null && r.value !== '') populated++;
    }
  }
  return { populated, total };
}

function OperationalSections({ p }: { p: HelmPropertyRow }) {
  const groups = operationalGroups(p);

  // Caller (page.tsx) already gates on populated > 0 before rendering this
  // inside a CollapsibleSection — but keep the safety net so the function
  // is still self-contained.
  const anything = groups.some((g) => g.rows.some((r) => r.value != null && r.value !== ''));
  if (!anything) return null;

  return (
    <div>
      {groups.map((g) => {
        const populated = g.rows.filter((r) => r.value != null && r.value !== '');
        if (populated.length === 0) return null;
        const summary = `${populated.length} of ${g.rows.length}`;
        return (
          <CollapsibleSubSection key={g.title} title={g.title} summary={summary}>
            <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 48px', fontSize: 13 }}>
              {populated.map((r) => (
                <Detail key={r.label} term={r.label} definition={String(r.value)} mono={r.mono === true} />
              ))}
            </dl>
          </CollapsibleSubSection>
        );
      })}
    </div>
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

function contactChannelLabel(via: ContactVia): string {
  switch (via) {
    case 'email': return 'email';
    case 'phone': return 'phone';
    case 'sms': return 'text';
    case 'in_person': return 'in person';
    case 'work-slip-email': return 'owner-action email';
    case 'other': return 'other';
    default: return via;
  }
}

/**
 * "today / yesterday / N days ago / Mar 12" — favors a glanceable relative
 * label inside the recent window, falls back to absolute past that.
 */
function formatRelativeOrAbsolute(iso: string): string {
  try {
    const then = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - then.getTime();
    const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    if (diffDays < 0) return formatDate(iso);
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 14) return `${diffDays} days ago`;
    return formatDate(iso);
  } catch {
    return iso;
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
