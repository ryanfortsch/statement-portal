import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { Stat } from '@/components/Stat';
import { DownloadPropertyPdfButton } from '@/components/properties/DownloadPropertyPdfButton';
import { trashNoticeFor } from '@/lib/trash-notice';
import { trashDayFact } from '@/lib/civic';
import { HomeGuideCustomizeForm } from '@/components/properties/HomeGuideCustomizeForm';
import { PhotoThumbs } from '@/components/PhotoUploader';
import { auth } from '@/auth';
import { supabaseAdmin as supabase, isServiceConfigured as isHelmConfigured } from '@/lib/supabase-admin';
import { formatUsPhone, telHref } from '@/lib/phone';
import { getOwnerPortfolio } from '@/lib/owner-portfolio';
import { getPropertyAccess } from '@/lib/property-access';
import type { HelmPropertyRow } from '@/lib/properties';
import type { WorkSlipRow } from '@/lib/work-types';
import { ACTIVE_WORK_SLIP_STATUSES } from '@/lib/work-types';
import { loadWorkBrief, type WorkBriefRow } from '@/lib/work-briefs';
import { OpenWorkSection } from './OpenWorkSection';
import { displayNameForEmail } from '@/lib/team';
import { PropertyDraftOwnerEmailButton } from './PropertyDraftOwnerEmailButton';
import { PropertyAddSlipButton } from './PropertyAddSlipButton';
import { MarkContactedButton } from './MarkContactedButton';
import { TaxCertEditor } from './TaxCertEditor';
import { MultiMonthBookingsSection } from './MultiMonthBookingsSection';
import { Fragment, Suspense } from 'react';
import { PropertyActivityList, loadPropertyActivity } from './PropertyActivity';
import { PropertyOnboardingLink } from './PropertyOnboardingLink';
import { PropertyTabs, TabSection } from './PropertyTabs';
import { DocumentsPanel } from './DocumentsPanel';
import { GuestCodesPanel } from './GuestCodesPanel';
import { QuickCapture } from './QuickCapture';
import { getPropertyDocuments } from '@/lib/property-documents';
import { startContractRenewal } from '@/app/projections/actions';
import {
  getPropertyContracts,
  contractAttention,
  currentTermEnd,
  noticeDeadline,
  daysUntil,
  renewalSummary,
} from '@/lib/property-contracts';
import { getClimateProfile } from '@/lib/climate';
import { getRentalPeriods } from '@/lib/property-rental-periods';
import { describePeriods } from '@/lib/rental-periods';
import { describeOperatingWindow } from '@/lib/forecast-operating-windows';
import { getGuestCodeView } from '@/lib/guest-locks';
import { getPropertyCleaners } from '@/lib/property-crew';
import type { PaymentVerifySignal } from '@/lib/sca-launch';
import { scaLiveEntry, type ScaLiveCheck } from '@/lib/sca-live';
import { scaStatusLine } from '@/lib/sca-status-line';
import { CollapsibleSection } from '@/components/properties/CollapsibleSection';
import { CostToTurnSection } from './CostToTurnSection';
import { HashOpenScript } from '@/components/properties/HashOpenScript';
import { getPropertyNotices } from '@/lib/property-notices';
import { getPropertyNotes } from '@/lib/property-notes';
import { getPropertyFlags } from '@/lib/property-flags';
import { loadLaunchForProperty } from '@/lib/launch-context';
import { launchBoardGroup, launchChecklistVisible } from '@/lib/launch-checklist';
import type { ContactRow, ContactTouchRow } from '@/lib/crm';
import { PropertyCrmSection } from './PropertyCrmSection';
import { ClimatePanelLoader } from './ClimatePanelLoader';
import { ResolveFlagButton } from './ResolveFlagButton';
import { InlineField } from './InlineField';
import { PropertyMasthead, type PropertyAlert } from './PropertyMasthead';
import { OwnersEditor } from './OwnersEditor';
import { RoomsEditor } from './RoomsEditor';
import { RentalSeasonPanel } from './RentalSeasonPanel';
import { getPropertyRooms } from '@/lib/property-rooms';
import { RatesPanel } from './RatesPanel';
import { ListingPanel } from './ListingPanel';
import { AutomationsPanel } from './AutomationsPanel';
import { loadHowWeSellIt } from '@/lib/how-we-sell-it';
import { loadPricingBundle } from '@/lib/property-rates';
import { getListingRecord, bedSummary, AMENITY_CATALOG } from '@/lib/listing-content';
import { getAutomationsPanelView } from '@/lib/automations';
import { isHelmRun, isCapeAnnOps } from '@/lib/property-scope';
import { shiftIsoDay, todayInEastern } from '@/lib/sca-quotes-types';
import type { OwnerCard } from '@/app/properties/actions';
import { isOwnerSession } from '@/lib/helm-access-server';
import { sessionMailbox } from '@/lib/gmail-draft';

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
  if (!data) return null;
  // Sensitive access codes (lock/gate/garage/wifi/alarm/thermostat) live on
  // the RLS-locked property_access table now, not properties. Merge them back
  // via the service-role client so the access rows below render unchanged.
  const access = await getPropertyAccess(id);
  return { ...(data as HelmPropertyRow), ...access } as HelmPropertyRow;
}

type ScaLaunchStatus = {
  status: string;
  live_url: string | null;
  guesty_listing_id: string | null;
  payment_verify_signal: PaymentVerifySignal | null;
  snapshot_refresh_error: string | null;
};

/**
 * The SCA launch row behind the Stay Cape Ann tile.
 *
 * `payment_verify_signal` is read because a launch that never got its
 * per-property Stripe key stays in demo mode and takes bookings that
 * collect nothing. Reading only `status` renders that identically to a
 * wired listing, which is how 84 Thatcher took four bookings worth
 * $41,917 without a payment path.
 */
async function getScaLaunchStatus(id: string): Promise<ScaLaunchStatus | null> {
  try {
    const { data, error } = await supabase
      .from('sca_launches')
      .select('status, live_url, guesty_listing_id, payment_verify_signal, snapshot_refresh_error')
      .eq('property_id', id)
      .maybeSingle();
    if (error) return null; // table may not exist yet on older preview envs
    return (data as ScaLaunchStatus) ?? null;
  } catch {
    return null;
  }
}

/**
 * Management-contract facts from the linked projection, for the onboarding
 * catalog's derives and the Records tab's Agreement block. Executed means
 * the owner signed AND Rising Tide countersigned, or the operator marked
 * the contract stage done (paper deals). termStart/termEnd are the ISO
 * dates that fill the contract's Term clause. All-empty when the property
 * predates the Projections pipeline (no projection_id) or the read fails.
 */
type ContractFacts = { executed: boolean; termStart: string | null; termEnd: string | null };

async function getContractFacts(projectionId: string | null): Promise<ContractFacts> {
  const none: ContractFacts = { executed: false, termStart: null, termEnd: null };
  if (!projectionId || !isHelmConfigured) return none;
  try {
    const { data, error } = await supabase
      .from('projections')
      .select('contract_signed_at, contract_countersigned_at, contract_marked_done_at, term_start, term_end')
      .eq('id', projectionId)
      .maybeSingle();
    if (error || !data) return none;
    const c = data as {
      contract_signed_at: string | null;
      contract_countersigned_at: string | null;
      contract_marked_done_at: string | null;
      term_start: string | null;
      term_end: string | null;
    };
    return {
      executed: !!(c.contract_marked_done_at || (c.contract_signed_at && c.contract_countersigned_at)),
      termStart: c.term_start,
      termEnd: c.term_end,
    };
  } catch {
    return none;
  }
}

/** "2026-07-01" -> "Jul 1, 2026" (noon UTC guard against TZ day-shift). */
function fmtTermDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
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
      // Lane order, priority and clustering are applied in memory by
      // groupSlipsByLane; the read just needs a stable base order. The old
      // cap of 20 silently hid a third of 73 Rocky Neck's list.
      .order('created_at', { ascending: true })
      .limit(80);
    if (error) throw error;
    return (data ?? []) as WorkSlipRow[];
  } catch {
    return [];
  }
}

async function getWorkBrief(propertyId: string): Promise<WorkBriefRow | null> {
  if (!isHelmConfigured) return null;
  try {
    return await loadWorkBrief(supabase, propertyId);
  } catch {
    return null;
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

export default async function PropertyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams?: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const rawTab = (await searchParams)?.tab ?? 'today';
  // Old deep links (?tab=now/history/documents/deliverables) still land
  // somewhere sensible after the 6 to 5 tab restructure.
  // Every tab name this route has ever answered to, mapped onto the four
  // that remain. 27 in-repo links, nine server-action hash redirects and any
  // bookmark an operator kept all still land where they mean to.
  const TAB_ALIASES: Record<string, string> = {
    // the six this replaces
    today: 'now',
    // Setup and its catalog retired 2026-10-18; Launch is the one list and
    // its chip is on Now.
    onboarding: 'now',
    setup: 'now',
    operations: 'facts',
    people: 'owner',
    growth: 'guest',
    records: 'owner',
    // the four already aliased before this change
    overview: 'now',
    history: 'now',
    documents: 'owner',
    deliverables: 'guest',
    // the PMS branch's three, folded into Guest & listing as sections
    rates: 'guest',
    listing: 'guest',
    automations: 'guest',
  };
  const initialTab = TAB_ALIASES[rawTab] ?? rawTab;
  const p = await getProperty(id);
  if (!p) notFound();

  const [statements, propertyFlags, recentInspections, openSlips, latestOwnerContact, crmContactsFull, crmTouchesByContact, propertyNotices, propertyNotes, documents, session, scaLaunch, launchLoad, ownerPortfolio, climateProfile, guestCodeView, propertyCleaners, propertyRooms, contractFacts, propertyContracts, rentalPeriods, workBrief] = await Promise.all([
    getRecentStatements(p.id),
    getPropertyFlags(p.id),
    getRecentInspections(p.id),
    getOpenWorkSlips(p.id),
    getLatestOwnerContact(p.id, p),
    getCrmContactsFullForProperty(p.id),
    getCrmTouchesForProperty(p.id),
    getPropertyNotices(p.id),
    getPropertyNotes(p.id),
    getPropertyDocuments(p.id),
    auth(),
    getScaLaunchStatus(p.id),
    // Launch checklist state through the shared loader (src/lib/launch-context.ts),
    // the same one the launch page and the onboarding board use, so the
    // Today-tab chip can never disagree with the page it links to.
    loadLaunchForProperty(p),
    // Other properties + open prospects owned by this same person (matched
    // by shared owner email). Surfaces "Also owns…" so a multi-property
    // owner (e.g. Simon Prudenzi's 53 Rocky Neck bottom floor) reads as one
    // owner, not two unrelated records.
    getOwnerPortfolio({
      emails: [
        ...(p.owner_emails ?? []),
        ...(((p.owners as Array<{ email?: string | null }> | null) ?? []).map((o) => o?.email ?? null)),
      ],
      excludePropertyId: p.id,
    }),
    getClimateProfile(p.id),
    getGuestCodeView(p.id),
    getPropertyCleaners(p.id, { region: (p as unknown as { region?: string | null }).region ?? null }),
    getPropertyRooms(p.id),
    getContractFacts(p.projection_id ?? null),
    getPropertyContracts(p.id),
    getRentalPeriods(p.id),
    getWorkBrief(p.id),
  ]);
  const myEmail = session?.user?.email ?? '';
  // What we know on Facts: the facts. Issues are the Now tab's flags.
  const knownFacts = propertyNotes.filter((n) => n.kind !== 'issue');
  // Owner money on this page (the fee, bank digits, owner emails, payouts,
  // the contract) renders for owners only. Staff keep the operations.
  const owner = await isOwnerSession();
  // The executed management agreement files itself into Documents with its
  // fee terms. Owner money, so a staff login's Documents list omits it.
  const visibleDocuments = owner ? documents : documents.filter((d) => d.source !== 'contract-auto');

  // PMS plumbing: who runs this home's calendar (properties.calendar_authority,
  // read off the select('*') row), plus the three Helm-native records the
  // Pricing, Listing and Automations sections render. Each loader is
  // null-safe so a missing migration on a preview env degrades to an empty
  // panel instead of a 500.
  const helmRun = isHelmRun(p as unknown as { calendar_authority?: string | null });
  // The House policy columns, which the rate plan and the listing record read
  // (src/lib/house-policy.ts). Both panels show them and link back to Facts.
  const housePolicyValues = {
    checkout: p.default_checkout_time,
    maxOccupancy: p.max_occupancy,
    pets: p.pet_policy,
    quietHours: p.quiet_hours,
    cancellation: p.cancellation_policy,
    houseRules: p.house_rules,
  };
  const pmsRegion = ((p as unknown as { region?: string | null }).region ?? null) as string | null;
  const pmsToday = todayInEastern();
  // The site's own registry says whether the home is on staycapeann.com,
  // the same check the launcher makes; a launch record alone does not
  // (homes listed before Helm tracked launches have none).
  const scaListingId = String(scaLaunch?.guesty_listing_id || p.guesty_listing_id || '').trim();
  const [pricing, listingRecord, automationsView, howWeSellIt, myMailbox, scaLive] = await Promise.all([
    loadPricingBundle(p.id, pmsToday, shiftIsoDay(pmsToday, 365)).catch(() => null),
    getListingRecord(p.id).catch(() => null),
    getAutomationsPanelView(p.id).catch(() => null),
    loadHowWeSellIt(p.id),
    // Whose Gmail an owner email drafts in (Open Work): the session's own,
    // or none, and the button copies instead.
    sessionMailbox(myEmail).then((m) => m?.address ?? null).catch(() => null),
    scaLiveEntry(scaListingId, { maxAgeMs: 120_000 }),
  ]);

  // Management-contract registry facts (property_contracts). The active row
  // is the canonical agreement; contractFacts (projection columns) remains
  // the fallback for a promoted prospect whose contract isn't registered yet.
  const contractTodayIso = new Date().toISOString().slice(0, 10);
  const startRenewal = startContractRenewal.bind(null, p.id);
  const activeContract = propertyContracts.find((c) => c.status === 'active') ?? null;
  const pastContracts = propertyContracts.filter((c) => c.status !== 'active');
  const activeContractAttention = activeContract
    ? contractAttention(activeContract, contractTodayIso)
    : null;

  /**
   * The header band's alert lane. Each of these was already detectable on
   * this page and each was rendered inside a fold, so the expensive ones
   * were the easiest to miss. Cap at five is enforced by the component.
   *
   * 3 Locust has no owner and never will (is_rising_tide_owned), so the
   * missing-contract chip would be permanently wrong there.
   */
  const mastheadAlerts: PropertyAlert[] = [];
  if (scaLaunch?.status === 'live' && scaLaunch.payment_verify_signal === 'demo_mode') {
    mastheadAlerts.push({
      key: 'sca-demo',
      tone: 'negative',
      text: 'Stay Cape Ann is live in demo mode: bookings collect nothing',
      href: `/properties/${p.id}/stay-cape-ann`,
    });
  }
  if (
    owner &&
    activeContract?.fee_pct != null &&
    p.management_fee_pct != null &&
    Number(p.management_fee_pct) !== Number(activeContract.fee_pct)
  ) {
    mastheadAlerts.push({
      key: 'fee-mismatch',
      tone: 'negative',
      text: `Contract says ${activeContract.fee_pct}%, Helm bills ${p.management_fee_pct}%`,
      href: `/properties/${p.id}?tab=owner`,
    });
  }
  // The two contract alerts point at the Owner & money tab's agreement
  // section, which staff do not get.
  if (owner && !activeContract && !p.is_rising_tide_owned && p.is_active) {
    mastheadAlerts.push({
      key: 'no-contract',
      tone: 'negative',
      text: 'Operating with no live contract',
      href: `/properties/${p.id}?tab=owner`,
    });
  }
  if (owner && activeContractAttention?.kind === 'notice_window') {
    mastheadAlerts.push({
      key: 'notice-window',
      tone: 'signal',
      text: `Non-renewal notice closes ${fmtTermDate(activeContractAttention.deadline)}`,
      href: `/properties/${p.id}?tab=owner`,
    });
  }
  if (p.str_permit_expires) {
    const daysLeft = daysUntil(p.str_permit_expires, contractTodayIso);
    if (daysLeft != null && daysLeft <= 60) {
      mastheadAlerts.push({
        key: 'permit',
        tone: daysLeft <= 0 ? 'negative' : 'signal',
        text:
          daysLeft <= 0
            ? `STR permit expired ${fmtTermDate(p.str_permit_expires)}`
            : `STR permit expires in ${daysLeft}d`,
        href: `/properties/${p.id}/edit#permit`,
      });
    }
  }
  if (scaLaunch?.snapshot_refresh_error) {
    mastheadAlerts.push({
      key: 'sca-stale',
      tone: 'signal',
      text: 'Stay Cape Ann snapshot refresh is failing',
      href: `/properties/${p.id}/stay-cape-ann`,
    });
  }

  // Launch progress for the Today tab launch chip: the shared resolver's
  // summary, so the chip and the launch page never disagree (the
  // 1/18-vs-5/18 mismatch came from two copies of this calc).
  const launchProgress = launchLoad.summary;

  /**
   * An established home (a first guest has arrived, or the go-live date is
   * stamped) keeps its Launch chip on Now only while Coming online still
   * lists a required step open (src/lib/launch-checklist.ts). The keying is
   * the predicate launch-checklist already uses, NOT activated_at alone:
   * that column is null on purpose across the legacy fleet.
   *
   * There is no Setup tab any more. Its 108-item catalog was a second list
   * under a third name; Launch is the one list (migration
   * 20261018180000 moved its hand ticks into Launch step notes).
   */
  const established = !!(p.activated_at || launchLoad.ctx.firstStayStarted);
  const showLaunchChecklist = launchChecklistVisible(
    established,
    launchBoardGroup(launchLoad.rows.length > 0, launchProgress),
  );

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
      : owner
        ? `${formatMonth(statements[0].month)} · ${formatCurrency(statements[0].owner_payout)} payout`
        : `${formatMonth(statements[0].month)} closed`;
  const inspectionsSummary = (() => {
    if (recentInspections.length === 0) return 'no inspections yet';
    const last = recentInspections[0];
    const date = formatDate(last.completed_at ?? last.started_at);
    if (!last.completed_at) return `${date} · in progress`;
    const issues = last.issue_count;
    return `${date} · ${issues} ${issues === 1 ? 'issue' : 'issues'}`;
  })();

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
  // Gloucester adds two: the Information Note and the trash-day fridge
  // card, which is ready once a collection day resolves.
  const totalDeliverables = 3 + (isGloucester ? 2 : 0);
  const wifiReady = Boolean(p.wifi_name && p.wifi_password);
  const infoNoteReady = isGloucester && missingInfoNoteFields(p).length === 0;
  const trashNotice = isGloucester ? trashNoticeFor(p) : null;
  const trashNoticeReady = Boolean(trashNotice?.ok);
  const readyDeliverables = 2 + (wifiReady ? 1 : 0) + (infoNoteReady ? 1 : 0) + (trashNoticeReady ? 1 : 0);
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
      <style>{`
        .rt-action-link { transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease; }
        a.rt-action-link:hover { color: var(--ink); }
        a.rt-action-link[style*="background"]:hover { opacity: 0.88; }
      `}</style>
      <HelmMasthead />

      {/* BACK — the per-tab action rows below carry the contextual
          actions (Edit, Channels, Draft listing, etc.) that used to
          crowd this bar. */}
      <div
        className="max-w-[1100px] mx-auto px-10"
        style={{ paddingTop: 24, width: '100%' }}
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
      </div>

      {/* HERO — one tight breath: name, then a single line carrying the
          listing title + street address. The rt-helm-hero classes pick up
          the phone downscale in globals.css (the old hand-rolled 48px
          version never shrank on mobile). */}
      <section className="max-w-[1100px] mx-auto px-10 rt-helm-hero" style={{ paddingTop: 18, paddingBottom: 22, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Property</div>
        <h1
          className="font-serif rt-helm-hero-h1"
          style={{
            fontSize: 44,
            lineHeight: 1.05,
            fontWeight: 300,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            maxWidth: 720,
          }}
        >
          {display}
        </h1>
        <p style={{ marginTop: 10, fontSize: 14, color: 'var(--ink-3)' }}>
          {subtitle ? <>{subtitle}<span style={{ color: 'var(--ink-4)' }}> · </span></> : null}
          {p.address}, {p.city}
        </p>

        {!p.is_active && (
          <div
            style={{
              marginTop: 14,
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

      {/* HEADER BAND — replaces the four stat tiles (Mgmt Fee / Cleaning Est
          / Bank / Owner), which were config rather than state and rendered
          two hand-written dashes on a live property. Those four now live in
          the Owner block on the People tab, beside the rest of the deal.

          What takes their place is what an operator actually arrives for:
          who is in the house, and one fact to read out loud. See the
          component docblock for why this sits above the tabs. */}
      <PropertyMasthead
        propertyId={p.id}
        isActive={!!p.is_active}
        todayIso={contractTodayIso}
        bookings={guestCodeView.bookingRows}
        lockCodes={guestCodeView.lockCodes}
        cleaners={propertyCleaners}
        wifiName={p.wifi_name}
        wifiPassword={p.wifi_password}
        keyCodeLocation={p.key_code_location}
        gateCode={p.gate_code}
        garageCode={p.garage_code}
        parking={p.parking}
        trashDay={trashDayFact(p)}
        ownerName={p.owner_full || p.owner_last}
        ownerPhone={p.owner_phone}
        ownerEmail={owner ? (p.owner_emails?.[0] ?? null) : null}
        ownerPreferredContact={p.owner_preferred_contact}
        openSlipCount={openSlips.length}
        lastInspectionAt={recentInspections[0]?.completed_at ?? recentInspections[0]?.started_at ?? null}
        seasonNote={describeOperatingWindow(p.id) ?? describePeriods(rentalPeriods)}
        alerts={mastheadAlerts}
      />

      {/* Cross-month bookings -- inline action to split a long stay across
          the months it spans. Hidden when this property has no qualifying
          upcoming bookings, so it costs zero vertical space on the
          ~9 properties that don't have one right now. */}
      {/* Each row prints the stay's net and offers the installment split,
          which saves through an owner-only route: owners only. */}
      {owner && <MultiMonthBookingsSection propertyId={p.id} />}

      <PropertyTabs
        initialTab={initialTab}
        tabs={[
          { id: 'now', label: 'Now', badge: openSlips.length || undefined },
          { id: 'facts', label: 'Facts' },
          { id: 'owner', label: 'Owner & money', badge: crmContactsFull.length || undefined },
          // Listing, Pricing and Automations (the Helm-native PMS
          // records) are sections of this tab; the badge is sends waiting
          // on an approval there.
          { id: 'guest', label: 'Guest & listing', badge: automationsView?.counts.awaiting || undefined },
        ]}
      >
        {/* ════════════ NOW ════════════ */}
        <TabSection tab="now">
          {/* Dictate/type a note; Helm routes it to the right field or
              note after operator review. Top of the tab — capture comes
              before scanning open work. */}
          <QuickCapture propertyId={p.id} propertyName={p.name} />
          {showLaunchChecklist && (
            <TabActions>
              <Link
                href={`/properties/${p.id}/launch`}
                title={
                  launchProgress.allDone
                    ? 'Launch complete'
                    : `Launch: ${launchProgress.done} of ${launchProgress.total} resolved`
                }
                className="rt-action-link"
                style={{
                  ...actionLinkStyle,
                  padding: '8px 14px',
                  border: `1px solid ${launchProgress.allDone ? 'var(--positive)' : 'var(--rule)'}`,
                  color: launchProgress.allDone ? 'var(--positive)' : 'var(--ink)',
                }}
              >
                Launch
                <span style={{ fontFamily: 'var(--font-mono-dash), ui-monospace, monospace', fontSize: 10 }}>
                  {launchProgress.done}/{launchProgress.total}
                </span>
                <span aria-hidden>{launchProgress.allDone ? '✓' : '→'}</span>
              </Link>
            </TabActions>
          )}

      {/* FLAGGED AT THE HOUSE — one list over BOTH note tables.
          inspection_notes (someone flagged it on a walk) and property_notes
          (someone wrote it down) used to render as two lists on two tabs,
          under headings that did not distinguish them. Worse, the old
          heading here read "Pinned from walkthroughs" while rendering
          inspection_notes: both capture boxes write to property_notes, so
          nothing a walkthrough dictated ever appeared under it. Source pill,
          one resolve verb, honest count.

          Issues only: a property note that is a FACT lives in What we know on
          Facts and is never resolved, so tidying this list can no longer
          take guest knowledge out of the Guest KB. */}
      {(propertyFlags.flags.length > 0 || propertyFlags.total === null) && (
        <section id="flags" className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 36, width: '100%', scrollMarginTop: 120 }}>
          <div className="flex items-baseline justify-between" style={{ marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
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
              Flagged at the house
            </h2>
            <span style={{ display: 'inline-flex', gap: 16, alignItems: 'baseline' }}>
              <span className="eyebrow">
                {propertyFlags.total === null ? 'Count unavailable' : `${propertyFlags.total} open`}
                {propertyFlags.total !== null && propertyFlags.total > propertyFlags.flags.length
                  ? ` · showing ${propertyFlags.flags.length}`
                  : ''}
              </span>
              <Link
                href={`/properties/${p.id}/notes/new?kind=issue`}
                style={{ fontSize: 11, color: 'var(--tide-deep)', textDecoration: 'none', letterSpacing: '.04em' }}
              >
                + Flag an issue
              </Link>
            </span>
          </div>
          {propertyFlags.total === null && (
            <p role="status" style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5 }}>
              We couldn&rsquo;t load all flags for this house.{' '}
              {propertyFlags.flags.length > 0 && 'The flags we could load are shown below. '}
              <a
                href={`/properties/${p.id}?tab=today`}
                style={{ color: 'var(--tide-deep)', textDecoration: 'underline', textUnderlineOffset: 3 }}
              >
                Refresh to try again
              </a>
            </p>
          )}
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {propertyFlags.flags.map((f) => (
              <div
                key={`${f.source}-${f.id}`}
                style={{
                  padding: '16px 0',
                  borderBottom: '1px solid var(--rule)',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto',
                  gap: 16,
                  alignItems: 'baseline',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={pillStyle(f.source === 'walk' ? 'var(--tide-deep)' : 'var(--ink-4)', true)}>
                      {f.source === 'walk' ? 'Walk' : 'Note'}
                    </span>
                    {f.guestFacing && (
                      <span
                        title="In the Guest KB: the guest AI tells guests this while it is open"
                        style={pillStyle('var(--tide-deep)', true)}
                      >
                        Guest KB
                      </span>
                    )}
                    <span style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.5 }}>
                      {f.href ? (
                        <Link href={f.href} style={{ color: 'inherit', textDecoration: 'none' }}>
                          {f.text}
                        </Link>
                      ) : (
                        f.text
                      )}
                    </span>
                  </div>
                  {f.detail && f.detail !== f.text && (
                    <div style={{ marginTop: 4, fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                      {f.detail.length > 180 ? `${f.detail.slice(0, 180)}…` : f.detail}
                    </div>
                  )}
                  {f.photoUrls.length > 0 && <PhotoThumbs urls={f.photoUrls} size={64} />}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-4)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {(f.authorEmail ?? '').split('@')[0] || 'Helm'}
                  <br />
                  <span style={{ fontSize: 10 }}>{formatDate(f.createdAt)}</span>
                </div>
                <ResolveFlagButton propertyId={p.id} flagId={f.id} source={f.source} guestFacing={f.guestFacing} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* OPEN WORK SLIPS: the brief, then the ledger by lane */}
      <OpenWorkSection property={{ id: p.id, name: p.name }} slips={openSlips} brief={workBrief} myEmail={myEmail} myMailbox={myMailbox} />

      {/* ACTIVITY FEED */}
      <CollapsibleSection title="Activity" summary="recent · full log on its own page">
        <Suspense
          fallback={
            <div style={{ padding: '4px 0 16px', color: 'var(--ink-3)', fontSize: 13 }}>
              Loading recent activity…
            </div>
          }
        >
          <ActivityPeek property={p} />
        </Suspense>
      </CollapsibleSection>

      {/* INSPECTION HISTORY (Helm-native) */}
      <CollapsibleSection title="Recent Inspections" summary={inspectionsSummary}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <Link
            href={`/turnovers?property=${p.id}`}
            title="Open Operations filtered to this property to schedule a walk before an upcoming check-in"
            style={primaryActionStyle}
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

        </TabSection>

        {/* ════════════ FACTS ════════════ */}
        <TabSection tab="facts">
      {/* THE FACT SHEET, open: seven groups shaped by the question they
          answer, as plain headed lists. Facts used to be fifteen closed folds
          with this one three taps deep; a phone in the driveway reads it now
          without opening anything. Every row edits in place, blank or not. */}
      <FactSheet p={p} summary={operationalSummary} />

      {/* HOUSE POLICY — the decisions a guest, a listing or the concierge
          quotes. Each of these was a tick in the Setup catalog recording
          that somebody decided, with the answer itself stored nowhere, so
          "what time is checkout" and "do they take dogs" were unanswerable
          on the record. A blank renders as the question with a link to the
          field that answers it, never as a dash. */}
      <CollapsibleSection
        id="policy"
        defaultOpen
        title="House policy"
        summary={(() => {
          const set = [
            p.default_checkin_time, p.default_checkout_time, p.quiet_hours,
            p.max_occupancy, p.pet_policy, p.smoking_policy,
            p.cancellation_policy, p.house_rules, p.discount_stance,
          ].filter((v) => v != null && String(v).trim() !== '').length;
          return set === 9 ? 'all set' : `${set} of 9 decided`;
        })()}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '10px 24px', fontSize: 13, alignItems: 'baseline', maxWidth: 760 }}>
          {/* Check-in is two values with two names: the guest's (the rate
              plan's, what a guest is told) and the cleaner deadline (when the
              home must be ready). The rate plan and the listing record read
              every other row here (src/lib/house-policy.ts). */}
          <div className="eyebrow">Guest check-in</div>
          {pricing?.plan ? (
            <div style={{ color: 'var(--ink)', lineHeight: 1.55 }}>{pricing.plan.checkin_time}</div>
          ) : helmRun ? (
            <Link
              href={`/properties/${p.id}?tab=guest#rates`}
              style={{ color: 'var(--signal)', textDecoration: 'none', fontSize: 12 }}
            >
              Set under Pricing &rarr;
            </Link>
          ) : (
            <div style={{ color: 'var(--ink-3)', lineHeight: 1.55 }}>Guesty tells the guest</div>
          )}
          {([
            ['Cleaner deadline', p.default_checkin_time, 'times'],
            ['Guest checkout', p.default_checkout_time, 'times'],
            ['Quiet hours', p.quiet_hours, 'policy'],
            ['Max occupancy', p.max_occupancy != null ? `${p.max_occupancy} guests` : null, 'policy'],
            ['Pets', p.pet_policy, 'policy'],
            ['Smoking', p.smoking_policy, 'policy'],
            ['Cancellation', p.cancellation_policy, 'policy'],
            ['House rules', p.house_rules, 'policy'],
            ['Discounts', p.discount_stance, 'policy'],
          ] as Array<[string, string | number | null, string]>).map(([label, value, anchorId]) => (
            <Fragment key={label}>
              <div className="eyebrow">{label}</div>
              {value != null && String(value).trim() !== '' ? (
                <div style={{ color: 'var(--ink)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{value}</div>
              ) : (
                <Link
                  href={`/properties/${p.id}/edit#${anchorId}`}
                  style={{ color: 'var(--signal)', textDecoration: 'none', fontSize: 12 }}
                >
                  Not decided yet &rarr;
                </Link>
              )}
            </Fragment>
          ))}
        </div>
      </CollapsibleSection>

      {/* ROOMS AND BEDS: property_rooms, the one store the listing, the
          sleeping arrangements and the walkthrough read. It lived inside the
          retired Setup catalog and inside Listing; it is a fact about the
          house, so it is edited here and Listing shows it. */}
      <CollapsibleSection
        id="rooms"
        title="Rooms and beds"
        summary={bedSummary(propertyRooms).text || 'no rooms on file'}
      >
        <RoomsEditor propertyId={p.id} rooms={propertyRooms} />
      </CollapsibleSection>

      <CollapsibleSection
        id="guest-codes"
        title="Guest door codes"
        summary={guestCodeView.locks.length > 1 ? `${guestCodeView.locks.length} locks mapped` : guestCodeView.locks.length === 1 ? 'lock mapped' : 'no lock mapped'}
      >
        <GuestCodesPanel propertyId={p.id} view={guestCodeView} />
      </CollapsibleSection>

      {/* WHO SERVES THIS HOUSE — the people who physically go there.
          "Which cleaner covers this property and what is their number" had
          no door anywhere on the record before the header band; this is the
          full answer behind the band's single line. property_ids = '{}' on
          cleaner_phones means serves-all, which is why a fleet-wide mapping
          is listed and labelled rather than hidden. */}
      <CollapsibleSection
        id="crew"
        title="Who serves this house"
        summary={
          propertyCleaners.length === 0
            ? 'no cleaner mapped'
            : propertyCleaners.length === 1
              ? propertyCleaners[0].display_name
              : `${propertyCleaners.length} mapped`
        }
      >
        {propertyCleaners.length === 0 ? (
          <div style={{ padding: '14px 0', color: 'var(--ink-3)', fontSize: 13, lineHeight: 1.6, maxWidth: 720 }}>
            No cleaner is mapped to {p.name}. Inbound texts from this house fall back to matching on
            the message body, and the cleaner line on the header band stays empty.{' '}
            <Link
              href="/turnovers/settings#schedule-recipients"
              style={{ color: 'var(--tide-deep)', textDecoration: 'underline', textUnderlineOffset: 3 }}
            >
              Open Cleaner settings
            </Link>
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {propertyCleaners.map((c) => (
              <div
                key={c.phone}
                style={{
                  padding: '14px 0',
                  borderBottom: '1px solid var(--rule)',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 16,
                  alignItems: 'baseline',
                }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, color: 'var(--ink)' }}>{c.display_name}</span>
                  {c.vendor && <span style={pillStyle('var(--ink-4)', true)}>{c.vendor}</span>}
                  {c.fleetWide && (
                    <span title="Mapped to every property, not just this one" style={pillStyle('var(--ink-4)', true)}>
                      Fleet-wide
                    </span>
                  )}
                </div>
                <span
                  style={{
                    fontFamily: 'var(--font-mono-dash), ui-monospace, monospace',
                    fontSize: 13,
                    color: 'var(--ink-3)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatUsPhone(c.phone)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {/* WHAT WE KNOW: the property's facts (property_notes, kind = 'fact').
          A quirk, a workaround, a vendor, a local tip: things that stay true.
          Guest KB rows are what the guest AI knows about this home
          (/api/kb-facts). A fact is edited or deleted, never resolved: that
          verb belongs to issues, on Now, and a resolved fact used to drop
          out of the Guest KB without a word. The old "Operations notebook"
          anchor is kept so deep links still land. */}
      <CollapsibleSection
        id="ops-notebook"
        title="What we know"
        summary={(() => {
          const total = knownFacts.length;
          if (total === 0) return 'nothing written down yet';
          const kb = knownFacts.filter((n) => n.guest_facing).length;
          return `${total} ${total === 1 ? 'fact' : 'facts'}${kb ? ` · ${kb} in the Guest KB` : ''}`;
        })()}
        headerAction={
          <Link href={`/properties/${p.id}/notes/new?kind=fact`} style={primaryActionStyle}>
            + Add a fact
          </Link>
        }
      >
        {knownFacts.length === 0 ? (
          <div style={{ padding: '14px 0', color: 'var(--ink-3)', fontSize: 13 }}>
            Nothing written down for {p.name} yet: a thermostat quirk, a sticky door, a neighbor, a vendor.{' '}
            <Link
              href={`/properties/${p.id}/notes/new?kind=fact`}
              style={{ color: 'var(--tide-deep)', textDecoration: 'underline', textUnderlineOffset: 3 }}
            >
              Add the first fact
            </Link>
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {knownFacts.map((n) => (
              <div
                key={n.id}
                style={{
                  padding: '14px 0',
                  borderBottom: '1px solid var(--rule)',
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  gap: 16,
                  alignItems: 'baseline',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    <h3
                      className="font-serif"
                      style={{ fontSize: 16, fontWeight: 500, letterSpacing: '-0.005em', color: 'var(--ink)', margin: 0 }}
                    >
                      {n.title}
                    </h3>
                    {n.guest_facing && (
                      <span title="In the Guest KB: the guest AI knows this about the home" style={pillStyle('var(--tide-deep)', true)}>
                        Guest KB
                      </span>
                    )}
                    {n.tag && <span style={pillStyle('var(--ink-3)')}>{n.tag}</span>}
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
                </div>
                <Link
                  href={`/properties/${p.id}/notes/${n.id}/edit`}
                  style={{ fontSize: 11, color: 'var(--tide-deep)', textDecoration: 'none', letterSpacing: '.04em' }}
                >
                  Edit
                </Link>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Climate automation"
        summary={climateProfile?.enabled ? 'on' : 'not set up'}
      >
        {/* The Seam thermostat list is a fleet-wide external call. It used
            to run in this page's Promise.all, so every arrival at every
            property waited on Seam to fill a device picker inside a section
            that renders collapsed. Streamed instead. */}
        <Suspense
          fallback={
            <div style={{ padding: '4px 0 16px', color: 'var(--ink-3)', fontSize: 13 }}>
              Loading thermostats…
            </div>
          }
        >
          <ClimatePanelLoader propertyId={p.id} profile={climateProfile} />
        </Suspense>
      </CollapsibleSection>

      <CollapsibleSection
        title="Rental season"
        summary={describeOperatingWindow(p.id) ?? describePeriods(rentalPeriods)}
      >
        <RentalSeasonPanel
          propertyId={p.id}
          periods={rentalPeriods}
          codeWindow={describeOperatingWindow(p.id)}
        />
      </CollapsibleSection>

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


      {/* TOOLS: the launchers, as one quiet line at the foot of the tab.
          They are navigation, not content, and as tiles they pushed the
          first fact below the fold. */}
      <ToolsLine>
        <ToolLink href={`/properties/${p.id}/edit`}>Edit all facts</ToolLink>
        <ToolLink href={`/channels/${p.id}`}>Channels ({helmRun ? 'Helm runs the calendar' : 'Guesty runs the calendar'})</ToolLink>
        <ToolLink href={`/properties/${p.id}/layout`}>Inspection layout</ToolLink>
        {/* Reachable on every home, before and after it goes live. It used to
            hang off two Setup catalog items and vanished with the tab. */}
        <ToolLink href={`/properties/${p.id}/order-checklist`}>Outfitting order</ToolLink>
        <ToolLink href={`/properties/${p.id}/launch`}>Launch</ToolLink>
        {/* A helm-run home has no live Guesty listing to compare with. */}
        {!helmRun && <ToolLink href={`/properties/${p.id}/sync-guesty`}>Guesty fields</ToolLink>}
      </ToolsLine>

        </TabSection>

        {/* ════════════ OWNER & MONEY ════════════ */}
        <TabSection tab="owner">
      {/* OWNER */}
      <CollapsibleSection title="Owner" summary={ownerSummary} defaultOpen>
        {/* The deal terms that used to lead every visit as four stat tiles.
            They are owner facts, not live state, so they belong beside the
            owner rather than above the tab strip. Cleaning Est is a manual
            fallback that revenue snapshots override with a real rolling
            figure once the property has closed statements, so it is labelled
            as the estimate it is rather than presented as a measured cost. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            borderTop: '1px solid var(--rule)',
            borderBottom: '1px solid var(--rule)',
            marginBottom: 18,
          }}
        >
          {owner && <Stat label="Mgmt Fee" value={p.is_rising_tide_owned ? 'RT owned' : `${p.management_fee_pct}%`} />}
          <Stat
            label="Cleaning Est"
            value={p.cleaning_cost_estimate != null ? `$${p.cleaning_cost_estimate}` : 'Not set'}
            sub={p.cleaning_cost_estimate != null ? 'manual fallback' : undefined}
            href={`/properties/${p.id}/edit#cleaning`}
          />
          {owner && (
            <Stat
              label="Bank"
              value={p.bank_last4 ? `**${p.bank_last4}` : 'Not set'}
              href={`/properties/${p.id}/edit#bank`}
            />
          )}
          <Stat label="Owner" value={p.owner_last || 'Not set'} last />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <Link
            href={`/properties/${p.id}/edit`}
            style={{
              fontSize: 11,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              color: 'var(--ink)',
              textDecoration: 'none',
              border: '1px solid var(--rule)',
              padding: '7px 13px',
              fontWeight: 500,
            }}
          >
            Edit owner info
          </Link>
        </div>
        <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 64px', fontSize: 13 }}>
          <Detail term="Owner" definition={p.owner_full} />
          <Detail term="Greeting" definition={p.owner_greeting} />

          {owner && (
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
          )}

          <div>
            <dt className="eyebrow" style={{ marginBottom: 4 }}>Phone</dt>
            <dd className="font-mono" style={{ color: 'var(--ink)', fontSize: 12, margin: 0 }}>
              {p.owner_phone ? (
                <a
                  href={telHref(p.owner_phone)}
                  style={{ color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: 3 }}
                >
                  {formatUsPhone(p.owner_phone)}
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
          {owner && (
          <div>
            <dt className="eyebrow" style={{ marginBottom: 4 }}>Tax Cert ID</dt>
            <dd style={{ margin: 0 }}>
              <TaxCertEditor propertyId={p.id} initial={p.tax_cert_id} />
            </dd>
          </div>
          )}
        </dl>

        {/* Also owns — other properties / open prospects under the same
            owner (matched by shared email). Lets a multi-property owner
            read as one person across their portfolio. */}
        {(ownerPortfolio.properties.length > 0 || (owner && ownerPortfolio.prospects.length > 0)) && (
          <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--rule)' }}>
            <div className="eyebrow" style={{ color: 'var(--ink-3)', marginBottom: 12 }}>
              {p.owner_full ? `${p.owner_full} also has` : 'Same owner also has'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {ownerPortfolio.properties.map((op) => (
                <Link
                  key={op.id}
                  href={`/properties/${op.id}`}
                  style={{
                    fontSize: 12,
                    color: 'var(--ink)',
                    textDecoration: 'none',
                    border: '1px solid var(--rule)',
                    padding: '6px 12px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span>{op.name}</span>
                  <span style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: op.is_active === false ? 'var(--ink-4)' : 'var(--positive)' }}>
                    {op.is_active === false ? 'Inactive' : 'Managed'}
                  </span>
                </Link>
              ))}
              {/* Prospects are owner pages; the chips would bounce staff. */}
              {owner && ownerPortfolio.prospects.map((op) => (
                <Link
                  key={op.id}
                  href={`/prospects/${op.id}`}
                  style={{
                    fontSize: 12,
                    color: 'var(--ink)',
                    textDecoration: 'none',
                    border: '1px dashed var(--rule)',
                    padding: '6px 12px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <span>{op.property_address}</span>
                  <span style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                    Prospect
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Additional owner contacts beyond the primary. The primary
            card is auto-derived from the Owner block above (name,
            phone, first email) on every save, so this editor is here
            for the multi-owner cases: a spouse with their own cell, an
            accountant who also needs replies, a secondary phone. */}
        <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--rule)' }}>
          <div className="eyebrow" style={{ color: 'var(--ink-3)', marginBottom: 12 }}>
            Additional owner contacts
          </div>
          <OwnersEditor
            propertyId={p.id}
            initialOwners={(p.owners as OwnerCard[] | null) ?? []}
          />
        </div>

        {/* The "In CRM" chip block that used to live here was lifted out
            into a dedicated Contacts section below, which shows the full
            contact rows + recent touches inline. The chip strip would
            have been a duplicate cross-link to the same data. */}

        {/* Public onboarding-form link. Lazily generated; once minted,
            the same URL backfills this property's operational columns
            from the owner's answers (utilities, access, emergency, etc.). */}
        {owner && (
        <PropertyOnboardingLink
          propertyId={p.id}
          initialToken={p.onboarding_token}
          submittedAt={p.onboarding_submitted_at}
          ownerEmails={p.owner_emails ?? []}
          ownerGreeting={p.owner_greeting ?? null}
          propertyName={p.name}
        />
        )}
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
      {/* MANAGEMENT AGREEMENT — the deal facts the Setup checklist's
          "Open records" links land on. The property_contracts registry row
          (seeded from the Drive Contracts corpus) is the canonical source:
          fee, term, renewal mechanics, and negotiated clauses as signed.
          Falls back to the linked projection's contract columns for a
          promoted prospect whose contract isn't registered yet. */}
      {/* Both branches carry id="management-agreement" on purpose: they are
          the two arms of one ternary, so only ever one is in the DOM, and the
          deep links from /properties/contracts and the alert lane must land
          on whichever arm rendered. */}
      {owner && (activeContract ? (
        <CollapsibleSection
          id="management-agreement"
          title="Management Agreement"
          summary={
            activeContractAttention
              ? activeContractAttention.kind === 'notice_window'
                ? `notice deadline ${fmtTermDate(activeContractAttention.deadline)}`
                : 'needs attention'
              : `through ${fmtTermDate(currentTermEnd(activeContract, contractTodayIso))} · ${activeContract.fee_pct != null ? `${activeContract.fee_pct}%` : 'fee n/a'}`
          }
          defaultOpen={!!activeContractAttention}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '10px 24px', fontSize: 13, alignItems: 'baseline', maxWidth: 760 }}>
            <div className="eyebrow">Parties</div>
            <div style={{ color: 'var(--ink)' }}>
              {activeContract.owner_party} · signed via{' '}
              {activeContract.signed_via === 'helm' ? 'Helm e-sign' : activeContract.signed_via === 'docusign' ? 'Docusign' : 'external paperwork'}
              {activeContract.executed_on ? ` on ${fmtTermDate(activeContract.executed_on)}` : ' (copy on file is undated)'}
            </div>
            <div className="eyebrow">Term</div>
            <div style={{ color: 'var(--ink)' }}>
              {activeContract.term_start ? fmtTermDate(activeContract.term_start) : 'start not recorded'}
              {' to '}
              {fmtTermDate(currentTermEnd(activeContract, contractTodayIso))}
              {currentTermEnd(activeContract, contractTodayIso) > activeContract.term_end && (
                <span style={{ color: 'var(--ink-3)' }}>
                  {' '}(auto-renewed; written term ended {fmtTermDate(activeContract.term_end)})
                </span>
              )}
            </div>
            <div className="eyebrow">Renewal</div>
            <div style={{ color: 'var(--ink-2)', lineHeight: 1.55 }}>
              {renewalSummary(activeContract)}
              {(() => {
                const deadline = noticeDeadline(activeContract, contractTodayIso);
                if (!deadline) return null;
                const days = daysUntil(deadline, contractTodayIso);
                return (
                  <span
                    className="tabular-nums"
                    style={{
                      color: days <= 14 ? 'var(--negative)' : days <= 75 ? 'var(--signal)' : 'var(--ink-3)',
                      fontWeight: days <= 75 ? 600 : 400,
                    }}
                  >
                    {' '}· notice deadline {fmtTermDate(deadline)}{days >= 0 ? ` (${days}d)` : ''}
                  </span>
                );
              })()}
            </div>
            <div className="eyebrow">Fee</div>
            <div style={{ color: 'var(--ink)', lineHeight: 1.55 }}>
              {activeContract.fee_pct != null ? `${activeContract.fee_pct}% of gross rental income` : 'not recorded'}
              {activeContract.fee_pct != null &&
                p.management_fee_pct != null &&
                Number(p.management_fee_pct) !== Number(activeContract.fee_pct) && (
                  <span style={{ color: 'var(--negative)' }}>
                    {' '}(contract disagrees with the {p.management_fee_pct}% Helm bills; reconcile before the next statement)
                  </span>
                )}
              {activeContract.fee_notes && (
                <span style={{ color: 'var(--ink-3)' }}> · {activeContract.fee_notes}</span>
              )}
            </div>
            {activeContract.min_availability && (
              <>
                <div className="eyebrow">Availability</div>
                <div style={{ color: 'var(--ink-2)', lineHeight: 1.55 }}>{activeContract.min_availability}</div>
              </>
            )}
            {activeContract.special_terms.length > 0 && (
              <>
                <div className="eyebrow">Negotiated</div>
                <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--ink-2)', lineHeight: 1.6 }}>
                  {activeContract.special_terms.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
          {activeContractAttention && (
            <p style={{ margin: '14px 0 0', fontSize: 12.5, color: 'var(--signal)', lineHeight: 1.55, maxWidth: 760 }}>
              {activeContractAttention.detail}
            </p>
          )}
          {activeContract.notes && (
            <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 760 }}>
              {activeContract.notes}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16, alignItems: 'center' }}>
            {activeContract.drive_url && (
              <a href={activeContract.drive_url} target="_blank" rel="noreferrer" style={primaryActionStyle}>
                Signed PDF ↗
              </a>
            )}
            {p.projection_id && (
              <Link
                href={`/projections/${p.projection_id}/contract`}
                target="_blank"
                style={{ fontSize: 11, fontWeight: 500, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)', textDecoration: 'none', padding: '9px 12px' }}
              >
                Contract page
              </Link>
            )}
            <Link
              href="/properties/contracts"
              style={{ fontSize: 11, fontWeight: 500, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)', textDecoration: 'none', padding: '9px 12px' }}
            >
              All contracts
            </Link>
            {/* Renewal draft: rides the prospect contract pipeline (edit
                terms, owner sign link, countersign) with the row pre-linked
                to this property so it never touches the funnel. */}
            <form action={startRenewal} style={{ margin: 0 }}>
              <button
                type="submit"
                style={{ fontSize: 11, fontWeight: 500, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--tide-deep)', background: 'none', border: 'none', cursor: 'pointer', padding: '9px 12px' }}
              >
                Draft renewal
              </button>
            </form>
          </div>
          {pastContracts.length > 0 && (
            <div style={{ marginTop: 14, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6 }}>
              {pastContracts.map((c) => (
                <div key={c.id}>
                  {c.status === 'superseded' ? 'Superseded' : 'Expired'}:{' '}
                  {c.term_start ? fmtTermDate(c.term_start) : '—'} to {fmtTermDate(c.term_end)}
                  {c.fee_pct != null ? ` at ${c.fee_pct}%` : ''}
                  {c.drive_url && (
                    <>
                      {' · '}
                      <a href={c.drive_url} target="_blank" rel="noreferrer" style={{ color: 'var(--tide-deep)' }}>
                        PDF ↗
                      </a>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>
      ) : (
        <CollapsibleSection
          id="management-agreement"
          title="Management Agreement"
          summary={
            pastContracts.length > 0
              ? 'expired, no live contract'
              : p.projection_id
                ? contractFacts.executed
                  ? 'signed, not yet registered'
                  : 'not fully executed'
                : 'none on file'
          }
          defaultOpen={pastContracts.length > 0}
        >
          {pastContracts.length > 0 && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--negative)', lineHeight: 1.6, maxWidth: 760 }}>
              The last agreement ({pastContracts[0].term_start ? fmtTermDate(pastContracts[0].term_start) : '—'} to{' '}
              {fmtTermDate(pastContracts[0].term_end)}
              {pastContracts[0].fee_pct != null ? ` at ${pastContracts[0].fee_pct}%` : ''}) has ended and nothing
              renews it. This property is operating without a live contract.
              {pastContracts[0].drive_url && (
                <>
                  {' '}
                  <a href={pastContracts[0].drive_url} target="_blank" rel="noreferrer" style={{ color: 'var(--tide-deep)' }}>
                    Last signed PDF ↗
                  </a>
                </>
              )}
            </p>
          )}
          {pastContracts.length === 0 && p.projection_id && (
            <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '10px 24px', fontSize: 13, alignItems: 'baseline', maxWidth: 720 }}>
              <div className="eyebrow">Status</div>
              <div style={{ color: 'var(--ink)' }}>
                {contractFacts.executed ? 'Executed (signed and countersigned)' : 'Not fully executed'}
              </div>
              <div className="eyebrow">Term</div>
              <div style={{ color: contractFacts.termStart && contractFacts.termEnd ? 'var(--ink)' : 'var(--signal)' }}>
                {contractFacts.termStart ? fmtTermDate(contractFacts.termStart) : 'start not recorded'}
                {' to '}
                {contractFacts.termEnd ? fmtTermDate(contractFacts.termEnd) : 'end not recorded'}
              </div>
            </div>
          )}
          {pastContracts.length === 0 && !p.projection_id && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6, maxWidth: 760 }}>
              No management agreement is registered for this property. If a signed copy exists, it belongs in the
              Drive Contracts folder and in the register.
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16, alignItems: 'center' }}>
            {/* No live agreement: drafting a renewal is the primary move.
                Idempotent - re-clicking lands on the open draft. */}
            <form action={startRenewal} style={{ margin: 0 }}>
              <button type="submit" style={{ ...primaryActionStyle, border: 'none', cursor: 'pointer' }}>
                Draft renewal contract
              </button>
            </form>
            {p.projection_id && (
              <Link
                href={`/prospects/${p.projection_id}`}
                style={{ fontSize: 11, fontWeight: 500, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)', textDecoration: 'none', padding: '9px 12px' }}
              >
                Contract workroom
              </Link>
            )}
            {p.projection_id && (
              <Link
                href={`/projections/${p.projection_id}/contract`}
                target="_blank"
                style={{ fontSize: 11, fontWeight: 500, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)', textDecoration: 'none', padding: '9px 12px' }}
              >
                View contract ↗
              </Link>
            )}
            <Link
              href="/properties/contracts"
              style={{ fontSize: 11, fontWeight: 500, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)', textDecoration: 'none', padding: '9px 12px' }}
            >
              All contracts
            </Link>
          </div>
        </CollapsibleSection>
      ))}
      {/* DOCUMENTS — folded into the same collapsible grammar as its
          neighbors; the upload form used to render permanently expanded
          even when nothing was filed. */}
      <CollapsibleSection
        id="documents"
        title="Documents"
        summary={visibleDocuments.length === 0 ? 'none yet' : `${visibleDocuments.length} on file`}
      >
        <DocumentsPanel propertyId={p.id} documents={visibleDocuments} />
      </CollapsibleSection>
      {/* RECENT STATEMENTS (Helm-native) */}
      {owner && (
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
                href={`/statements/render?id=${s.id}&month=${s.month}`}
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
      )}
      {/* COST TO TURN: one line per recent statement month, from the
          statements' cleaning and repairs. Owner money, streamed so the
          page never waits on it. */}
      {owner && (
        <Suspense fallback={null}>
          <CostToTurnSection propertyId={p.id} />
        </Suspense>
      )}

        </TabSection>

        {/* ════════════ GUEST & LISTING ════════════ */}
        {/* One job per section, top to bottom: what a guest sees (the
            listing, the printed documents), then what they pay (Rates &
            taxes), then what Helm sends them (Automations). */}
        <TabSection tab="guest">
          <ScaStatusLine propertyId={p.id} launch={scaLaunch} live={scaLive} listingId={scaListingId} />
          {/* The listing as a guest reads it: each block opens its own
              editor. Deep link ?tab=guest#listing (the old ?tab=listing
              aliases here). */}
          <GuestSection
            id="listing"
            title="Listing"
            note={helmRun ? 'staycapeann.com reads this once it reads Helm' : 'Draft · Guesty holds the live listing'}
          >
            <ListingPanel
              propertyId={p.id}
              content={listingRecord?.content ?? null}
              photos={listingRecord?.photos ?? []}
              beds={bedSummary(propertyRooms)}
              catalog={AMENITY_CATALOG}
              helmRun={helmRun}
              registry={{ title: p.title ?? null, bedrooms: p.bedrooms ?? null, bathrooms: p.bathrooms ?? null }}
              housePolicy={housePolicyValues}
              // How we sell it: the selling points the campaign AI reads on
              // every draft (property_marketing). Cape Ann homes only: the
              // campaigns sell nothing else.
              sellIt={isCapeAnnOps({ region: pmsRegion }) ? howWeSellIt : null}
            />
          </GuestSection>
          <ToolsLine>
            <ToolLink href={`/properties/${p.id}/caption-photos`}>Photo captions</ToolLink>
            {/* A helm-run home has no live Guesty listing to compare with. */}
            {!helmRun && <ToolLink href={`/properties/${p.id}/sync-guesty`}>Guesty fields</ToolLink>}
          </ToolsLine>
      {/* GUEST DOCUMENTS: the printed pieces for the house. Each opens with
          one screen-only bar (Back, Print, Download PDF) that never prints;
          its Back lands here. */}
      <GuestSection
        id="guest-documents"
        title="Guest documents"
        note={deliverablesSummary}
        right={
          <Link href={`/properties/${p.id}/notices/new`} style={primaryActionStyle}>
            + New notice
          </Link>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {/* Home guide tile */}
          <div style={{ border: '1px solid var(--rule)', padding: '18px 18px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="eyebrow">Letter page</div>
            <h3 className="font-serif" style={{ fontSize: 18, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
              Home guide
            </h3>
            <p style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55 }}>
              One-page editorial guide. Wi-Fi, climate, parking, trash, plus two operator-picked cells.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
              <Link href={`/properties/${p.id}/home-guide`} target="_blank" style={primaryActionStyle}>
                Open ↗
              </Link>
              <DownloadPropertyPdfButton propertyId={p.id} type="home-guide" label="Download PDF" />
              {/* Customize link anchors to the home-guide-customize <details>
                  block that renders directly under the grid. The inline
                  script in HomeGuideCustomizeForm auto-opens it when the
                  URL hash matches. */}
              <a
                href="#home-guide-customize"
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: '.18em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-3)',
                  textDecoration: 'none',
                  padding: '9px 12px',
                }}
              >
                Customize home guide
              </a>
            </div>
          </div>
          {/* Welcome Card tile — 4 × 6 on-arrival card combining the warm
              welcome with a subscribe pitch. QR points to
              staycapeann.com/contact. Universal copy (no per-property data),
              so it's always ready to print. */}
          <div style={{ border: '1px solid var(--rule)', padding: '18px 18px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="eyebrow">4 × 6 card</div>
            <h3 className="font-serif" style={{ fontSize: 18, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
              Welcome card
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
            <div className="eyebrow">4 × 6 card with QR code</div>
            <h3 className="font-serif" style={{ fontSize: 18, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
              Wi-Fi placard
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
              <div className="eyebrow">Letter page, posted</div>
              <h3 className="font-serif" style={{ fontSize: 18, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
                Information note
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
          {/* Trash Day Notice tile, Gloucester-only. The 4 x 6 fridge card
              that names the collection day and nudges the guest to bring the
              trash down and roll the carts out the night before. Every sentence
              is civic.ts or the row; it is ready once a day resolves. */}
          {isGloucester && trashNotice && (
            <div style={{ border: '1px solid var(--rule)', padding: '18px 18px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="eyebrow">4 × 6 fridge card</div>
              <h3 className="font-serif" style={{ fontSize: 18, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
                Trash day notice
              </h3>
              <p style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55 }}>
                The collection day in big type, carts out the night before and back in once emptied, and where
                the carts live.
                {trashNotice.ok ? (
                  <span style={{ display: 'block', marginTop: 6 }}>
                    {trashNotice.notice.day}
                    {trashNotice.notice.daySource === 'row' ? ', set on the property' : ', from the DPW street list'}.
                    {trashNotice.notice.cartsHandledByUs ? ' We move the carts here, and the card says so.' : ''}
                    {trashNotice.notice.location ? '' : ' Add where the carts live under Edit property and it prints on the card.'}
                  </span>
                ) : (
                  <span style={{ display: 'block', marginTop: 6, color: 'var(--negative)' }}>
                    {trashNotice.skip.reason}
                  </span>
                )}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto' }}>
                <Link href={`/properties/${p.id}/trash-notice`} target="_blank" style={primaryActionStyle}>
                  Open ↗
                </Link>
                {trashNotice.ok ? (
                  <DownloadPropertyPdfButton propertyId={p.id} type="trash-notice" label="Download PDF" />
                ) : null}
                <Link
                  href="/properties/trash-notices"
                  target="_blank"
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    letterSpacing: '.18em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-3)',
                    textDecoration: 'none',
                    padding: '9px 12px',
                  }}
                >
                  Whole fleet
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Per-cell customization for the Welcome Guide tile above.
            Anchored right after the grid (not at the very bottom) so the
            relationship to the Welcome Guide tile is visually obvious;
            the tile's "Customize" link auto-opens it on click. */}
        <HomeGuideCustomizeForm propertyId={p.id} overrides={p.home_guide_overrides} />

        {/* BESPOKE NOTICES — 4 × 6 SCA placards for property-specific quirks
            (e.g. "please run the bathroom fan during showers"). Same brand
            language as the WiFi placard so a stack of these in a glass
            case reads as one consistent set. */}
        <div id="guest-placards" style={{ marginTop: 32, paddingTop: 22, borderTop: '1px solid var(--rule)' }}>
          {/* + New notice is the section's own header verb. */}
          <h3 className="font-serif" style={{ fontSize: 18, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: '0 0 12px' }}>
            Guest placards
          </h3>

          {propertyNotices.length === 0 ? (
            <div style={{ padding: '4px 0', fontSize: 13, color: 'var(--ink-4)' }}>
              No placards yet.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
              {propertyNotices.map((n) => (
                <div
                  key={n.id}
                  id={`notice-${n.id}`}
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
                        padding: '9px 12px',
                      }}
                    >
                      Edit
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </GuestSection>
          {/* WHAT THEY PAY: Helm's rate plan, taxes and day overrides, as
              three questions, a calendar and a Price a stay line. On a
              Guesty-run home (every home today) the head says once that this
              is Helm's plan and Guesty's prices are what guests pay. */}
          <GuestSection
            id="rates"
            title="Pricing"
            note={
              helmRun
                ? pricing?.plan
                  ? 'What staycapeann.com, quotes and payment links charge'
                  : 'No plan yet: Helm cannot price a night'
                : !pricing?.plan
                  ? "Helm's plan, not set yet · guests pay Guesty's prices today"
                  : "Helm's plan · guests pay Guesty's prices today"
            }
          >
            <RatesPanel
              propertyId={p.id}
              plan={pricing?.plan ?? null}
              tax={pricing?.tax ?? null}
              days={pricing ? [...pricing.days.values()] : []}
              helmRun={helmRun}
              region={pmsRegion}
              today={pmsToday}
              housePolicy={housePolicyValues}
            />
          </GuestSection>
          {/* WHAT HELM SENDS THEM: opens on the next sends and to whom; the
              rules sit behind Edit rules, in a drawer. */}
          <GuestSection
            id="automations"
            title="Automations"
            note={
              automationsView
                ? [
                    automationsView.counts.awaiting ? `${automationsView.counts.awaiting} waiting for approval` : null,
                    automationsView.counts.scheduled ? `${automationsView.counts.scheduled} scheduled` : null,
                  ].filter(Boolean).join(' · ') || undefined
                : undefined
            }
          >
            <AutomationsPanel propertyId={p.id} view={automationsView} />
          </GuestSection>
        </TabSection>

      </PropertyTabs>

      <HelmFooter module="Properties" right="Source: Helm" />

      {/* Opens collapsed <details> ancestors of the URL-hash target and
          scrolls to it (deep links like #ops-notebook / #notice-<id>). */}
      <HashOpenScript />
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
type OpRow = {
  label: string;
  value: string | number | null;
  mono?: boolean;
  /**
   * The column this row reads, when it maps to exactly one. Present means a
   * blank can be filled inline; absent means the row is composed from
   * several columns (the smart lock, guest gear) or is not in the capture
   * catalog, and keeps its link to the form.
   */
  col?: string;
  /** A short source note printed beside the label ("DPW list"). */
  note?: string;
  /**
   * The row is answered elsewhere and is not edited here: the text says why
   * (a trash day outside Gloucester is the city's, not a column to type).
   */
  fixed?: string;
};

/** ONE primary treatment for the whole page (the thing you came to do:
 *  Edit operational data, Open a deliverable, + Add note). The page used
 *  to carry three ink-solid variants with drifting paddings. */
const primaryActionStyle: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  padding: '9px 16px',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

/** Quiet "ghost" action link base for per-tab header actions (today only
 *  the Today tab's launch-checklist chip, which spreads this and adds its
 *  own border). Hover/active darken handled by the .rt-action-link class. */
const actionLinkStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  textDecoration: 'none',
  padding: '8px 4px',
  fontWeight: 500,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

/**
 * The last few things that happened here, streamed.
 *
 * Deliberately narrow: 21 days and a fifth of the usual row allowance, which
 * is enough to answer "has anyone touched this house lately" and nothing
 * more. Anything else is a question for the full log, which this links to.
 *
 * It is its own async component so the page's own await never waits on it.
 * Rendered inside a Suspense boundary below the notFound() check, so a miss
 * still 404s properly rather than streaming a 200 with an error in the body.
 */
async function ActivityPeek({ property }: { property: HelmPropertyRow }) {
  const events = await loadPropertyActivity(property, { windowDays: 21, scale: 0.2 });
  return (
    <PropertyActivityList
      events={events}
      max={5}
      more={`/properties/${property.id}/activity`}
    />
  );
}

/** Micro-pill factory — the house 9px uppercase chip, outline form.
 *  Pass `solid` for the inverted (colored bg) emphasis form. */
function pillStyle(color: string, solid = false): React.CSSProperties {
  return {
    fontSize: 9,
    fontWeight: solid ? 700 : 600,
    letterSpacing: '.16em',
    textTransform: 'uppercase',
    color: solid ? 'var(--paper)' : color,
    background: solid ? color : 'transparent',
    border: solid ? 'none' : `1px solid ${color}`,
    padding: '2px 7px',
    whiteSpace: 'nowrap',
  };
}

/**
 * Stay Cape Ann on one line at the top of Guest & listing: where the direct
 * listing stands, the live listing, and the launcher link. What it says is
 * scaStatusLine (src/lib/sca-status-line.ts), from the site's own registry.
 */
function ScaStatusLine({
  propertyId,
  launch,
  live,
  listingId,
}: {
  propertyId: string;
  launch: ScaLaunchStatus | null;
  live: ScaLiveCheck;
  listingId: string;
}) {
  const line = scaStatusLine(launch, live, listingId);
  const tone = { positive: 'var(--positive)', negative: 'var(--negative)', signal: 'var(--signal)', muted: 'var(--ink-3)' }[line.tone];
  const link = { fontSize: 12, color: 'var(--tide-deep)', textDecoration: 'none' } as const;
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 22, paddingBottom: 4, width: '100%' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '6px 14px', fontSize: 13 }}>
        <span className="eyebrow">Stay Cape Ann</span>
        <span style={{ color: tone }}>{line.text}</span>
        {line.listingUrl && (
          <a href={line.listingUrl} target="_blank" rel="noreferrer" style={link}>
            See the listing &#8599;
          </a>
        )}
        <Link href={`/properties/${propertyId}/stay-cape-ann`} style={link}>
          {line.verb} &rarr;
        </Link>
      </div>
    </section>
  );
}

/**
 * An always-open Guest & listing section: the same hairline and serif head
 * as CollapsibleSection, with no fold, so what a guest sees is on the page
 * when the tab opens. The anchor clears the masthead and the tab strip.
 */
function GuestSection({
  id,
  title,
  note,
  right,
  children,
}: {
  id: string;
  title: string;
  note?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 18, paddingBottom: 18, width: '100%', scrollMarginTop: 120 }}>
      <div style={{ borderTop: '1px solid var(--ink)', padding: '12px 0 10px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', minWidth: 0 }}>
          <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
            {title}
          </h2>
          {note && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{note}</span>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** A right-aligned action row that sits at the top of a tab panel.
 *  Tucked close under the sticky tab bar; vertically centers a primary
 *  button against the quiet ghost links beside it. */
function TabActions({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="max-w-[1100px] mx-auto px-10"
      style={{
        paddingTop: 20,
        paddingBottom: 4,
        width: '100%',
        display: 'flex',
        justifyContent: 'flex-end',
        gap: 16,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      {children}
    </div>
  );
}

/** Builds the six operational-data row groups in display order. Shared by
 *  the renderer (which shows only populated rows per group) and the field
 *  counter (which folds populated/total counts up into the parent header). */
/**
 * The house's stored facts, grouped by the question they answer.
 *
 * These were six groups shaped by the database: Property specs, Utilities,
 * STR setup, Property access & notes, Emergency contact, Inspection &
 * safety. The cost was that no single group could answer a whole question.
 * How a guest gets in was split four ways (guest_access_method and the
 * smart lock under "STR setup", the key location, gate and garage codes
 * under "Property access"), the thermostat sat in Utilities while its
 * automation sat in its own panel, and trash day and parking regulations
 * were filed under "Inspection & safety", which is neither.
 *
 * `editAnchor` is the edit-form group that owns most of a group's fields,
 * so reading a wrong value and fixing it is one gesture. Where a group
 * draws from two edit sections the link points at the larger half; that
 * mismatch is real and is noted per group rather than papered over.
 */
function operationalGroups(p: HelmPropertyRow) {
  const entry: OpRow[] = [
    { label: 'Guest access', value: p.guest_access_method, col: 'guest_access_method' },
    { label: 'Smart lock', value: [p.smart_lock_brand, p.smart_lock_code].filter(Boolean).join(' · ') || null },
    { label: 'Key / code location', value: p.key_code_location, col: 'key_code_location' },
    { label: 'Gate code', value: p.gate_code, mono: true, col: 'gate_code' },
    { label: 'Garage code', value: p.garage_code, mono: true, col: 'garage_code' },
    { label: 'Alarm system', value: p.alarm_system, col: 'alarm_system' },
    { label: 'Cameras', value: p.security_cameras, col: 'security_cameras' },
    { label: 'Arrival brief (crew)', value: p.arrival_brief },
    { label: 'Supply closet', value: p.supply_closet_location, col: 'supply_closet_location' },
  ];
  const connectivity: OpRow[] = [
    { label: p.wifi_label ? `Wi-Fi name (${p.wifi_label})` : 'Wi-Fi name', value: p.wifi_name, col: 'wifi_name' },
    { label: p.wifi_label ? `Wi-Fi password (${p.wifi_label})` : 'Wi-Fi password', value: p.wifi_password, mono: true, col: 'wifi_password' },
    { label: p.wifi_label_2 ? `Wi-Fi name (${p.wifi_label_2})` : 'Wi-Fi name 2', value: p.wifi_name_2, col: 'wifi_name_2' },
    { label: p.wifi_label_2 ? `Wi-Fi password (${p.wifi_label_2})` : 'Wi-Fi password 2', value: p.wifi_password_2, mono: true, col: 'wifi_password_2' },
    { label: 'Internet', value: p.internet_provider, col: 'internet_provider' },
    { label: 'Cable / TV', value: p.cable_provider, col: 'cable_provider' },
    { label: 'TVs', value: p.num_tvs, col: 'num_tvs' },
    { label: 'Smart TV', value: p.smart_tv, col: 'smart_tv' },
  ];
  const systems: OpRow[] = [
    { label: 'Bedrooms', value: p.bedrooms, col: 'bedrooms' },
    { label: 'Bathrooms', value: p.bathrooms, col: 'bathrooms' },
    { label: 'Square feet', value: p.square_feet, col: 'square_feet' },
    { label: 'Livable floors', value: p.livable_floors },
    { label: 'Basement', value: p.basement, col: 'basement' },
    { label: 'HOA', value: p.hoa, col: 'hoa' },
    { label: 'Heating', value: p.heating, col: 'heating' },
    { label: 'Cooling', value: p.cooling, col: 'cooling' },
    { label: 'Electricity', value: p.electricity_provider, col: 'electricity_provider' },
    // Beside the systems it controls rather than filed under Utilities,
    // so one appliance reads as one thing. Its automation is the Climate
    // section directly above.
    { label: 'Smart thermostat', value: [p.thermostat_brand, p.thermostat_code].filter(Boolean).join(' · ') || null },
    {
      label: 'Guest gear on-site',
      value:
        [
          p.has_pack_n_play ? 'Pack-n-play' : null,
          p.has_high_chair ? 'High chair' : null,
          p.has_pullout_bed ? 'Pullout bed' : null,
        ]
          .filter(Boolean)
          .join(', ') || null,
    },
    { label: 'Pullout linens', value: p.has_pullout_bed ? p.pullout_linens_location : null },
    { label: 'Known issues', value: p.known_issues },
    { label: 'Upcoming maintenance', value: p.upcoming_maintenance },
  ];
  // The trash day the band, the fridge card and the guest AI all print:
  // resolved through civic.ts, with its source. Only Gloucester's column is
  // ours to type (an operator who phoned DPW); elsewhere the city answers.
  const trash = trashDayFact(p);
  const civic: OpRow[] = [
    trash.kind === 'day'
      ? {
          label: 'Trash day',
          value: trash.day,
          note: trash.source === 'row' ? 'DPW confirmed' : 'DPW list',
          col: (p.city || '').split(',')[0].trim() === 'Gloucester' ? 'trash_day' : undefined,
        }
      : trash.kind === 'ask_dpw'
        ? { label: 'Trash day', value: null, col: 'trash_day' }
        : { label: 'Trash day', value: null, fixed: trash.kind === 'no_curbside' ? 'No curbside pickup' : 'See the city schedule' },
    { label: 'Recycling day', value: p.recycling_day, col: 'recycling_day' },
    { label: 'Where the carts live', value: p.trash_notes, col: 'trash_notes' },
    { label: 'Parking', value: p.parking, col: 'parking' },
    { label: 'Parking regulations', value: p.parking_regulations, col: 'parking_regulations' },
  ];
  const safety: OpRow[] = [
    { label: 'Gas shutoff', value: p.gas_shutoff_location, col: 'gas_shutoff_location' },
    { label: 'Water shutoff', value: p.water_shutoff_location, col: 'water_shutoff_location' },
    { label: 'Electrical panel', value: p.electrical_panel_location, col: 'electrical_panel_location' },
    { label: 'Fire extinguishers', value: p.fire_extinguisher_locations, col: 'fire_extinguisher_locations' },
    { label: 'Smoke / CO detectors', value: p.smoke_detector_locations, col: 'smoke_detector_locations' },
    { label: 'Fire exits', value: p.fire_exit_locations, col: 'fire_exit_locations' },
    { label: 'STR permit expires', value: p.str_permit_expires, col: 'str_permit_expires' },
    { label: 'STR registration', value: p.str_registration_id, mono: true, col: 'str_registration_id' },
    { label: 'STR insurance', value: p.str_insurance_carrier, col: 'str_insurance_carrier' },
  ];
  const emergency: OpRow[] = [
    { label: 'Name', value: p.emergency_contact_name, col: 'emergency_contact_name' },
    { label: 'Relationship', value: p.emergency_contact_relationship, col: 'emergency_contact_relationship' },
    { label: 'Phone', value: formatUsPhone(p.emergency_contact_phone), mono: true, col: 'emergency_contact_phone' },
    { label: 'Email', value: p.emergency_contact_email, mono: true },
  ];
  const listing: OpRow[] = [
    { label: 'Currently listed', value: p.currently_listed, col: 'currently_listed' },
    { label: 'Listing URLs', value: p.existing_listing_urls, mono: true },
  ];
  return [
    // One vocabulary: the edit form's groups carry these same names and
    // these ids, so a row's Edit lands on the group of the same name.
    { title: 'Entry and credentials', rows: entry, editAnchor: 'entry' },
    { title: 'Connectivity', rows: connectivity, editAnchor: 'connectivity' },
    { title: 'House and systems', rows: systems, editAnchor: 'house' },
    { title: 'Trash, parking and civic', rows: civic, editAnchor: 'civic' },
    { title: 'Safety and permits', rows: safety, editAnchor: 'safety' },
    { title: 'Emergency contact', rows: emergency, editAnchor: 'emergency' },
    { title: 'Listing', rows: listing, editAnchor: 'listing' },
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
      if ((r.value != null && r.value !== '') || r.fixed) populated++;
    }
  }
  return { populated, total };
}

/**
 * The fact sheet, open.
 *
 * Seven groups as plain headed lists, no folds. Every group renders, populated
 * or not, and every row edits in place: a populated row shows its value with
 * a quiet Edit (prefilled), a blank shows Add. A row composed from several
 * columns (the smart lock, guest gear) or outside the capture catalog keeps
 * its link to the edit form group of the same name.
 */
function FactSheet({ p, summary }: { p: HelmPropertyRow; summary: string }) {
  const groups = operationalGroups(p);
  return (
    <section id="facts" className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 26, paddingBottom: 30, width: '100%', scrollMarginTop: 120 }}>
      <div className="flex items-baseline justify-between" style={{ gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
          The fact sheet
        </h2>
        <span className="eyebrow">{summary}</span>
      </div>
      {groups.map((g) => {
        const populated = g.rows.filter((r) => (r.value != null && r.value !== '') || r.fixed).length;
        return (
          <div key={g.title} id={`facts-${g.editAnchor}`} style={{ borderTop: '1px solid var(--ink)', marginTop: 18, paddingTop: 14 }}>
            <div className="flex items-baseline justify-between" style={{ gap: 12, marginBottom: 12 }}>
              <h3 className="font-serif" style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.005em', color: 'var(--ink)', margin: 0 }}>
                {g.title}
              </h3>
              <span style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em' }}>
                {populated === g.rows.length ? 'complete' : `${populated} of ${g.rows.length}`}
              </span>
            </div>
            <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px 40px', fontSize: 13, margin: 0 }}>
              {g.rows.map((r) => {
                const has = r.value != null && r.value !== '';
                return (
                  <div key={r.label} style={{ minWidth: 0 }}>
                    <dt className="eyebrow" style={{ marginBottom: 4 }}>
                      {r.label}
                      {r.note && has ? (
                        <span style={{ marginLeft: 6, color: 'var(--ink-4)', letterSpacing: 0, textTransform: 'none', fontSize: 10 }}>{r.note}</span>
                      ) : null}
                    </dt>
                    <dd style={{ margin: 0 }}>
                      {r.col ? (
                        <InlineField
                          propertyId={p.id}
                          column={r.col}
                          label={r.label}
                          current={has ? String(r.value) : null}
                          mono={r.mono === true}
                        />
                      ) : has ? (
                        <span style={{ display: 'inline-flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', minWidth: 0 }}>
                          <span
                            className={r.mono ? 'font-mono' : ''}
                            style={{ color: 'var(--ink)', fontSize: r.mono ? 12 : 14, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}
                          >
                            {String(r.value)}
                          </span>
                          {r.fixed ? null : (
                            <Link
                              href={`/properties/${p.id}/edit#${g.editAnchor}`}
                              style={{ fontSize: 11, color: 'var(--ink-4)', textDecoration: 'none', letterSpacing: '.04em' }}
                            >
                              Edit
                            </Link>
                          )}
                        </span>
                      ) : r.fixed ? (
                        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{r.fixed}</span>
                      ) : (
                        <Link
                          href={`/properties/${p.id}/edit#${g.editAnchor}`}
                          style={{ fontSize: 12, color: 'var(--signal)', textDecoration: 'none' }}
                        >
                          Add &rarr;
                        </Link>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        );
      })}
    </section>
  );
}

/** One quiet line of tool links at the foot of a tab. */
function ToolsLine({ children }: { children: React.ReactNode }) {
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 18, paddingBottom: 30, width: '100%' }}>
      <div
        style={{
          borderTop: '1px solid var(--rule)',
          paddingTop: 12,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: '8px 20px',
          fontSize: 11,
          color: 'var(--ink-3)',
        }}
      >
        <span className="eyebrow">Tools</span>
        {children}
      </div>
    </section>
  );
}

function ToolLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} style={{ fontSize: 11, color: 'var(--tide-deep)', textDecoration: 'none', letterSpacing: '.04em' }}>
      {children}
    </Link>
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
