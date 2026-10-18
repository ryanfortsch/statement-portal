import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { supabaseAdmin as supabase, isServiceConfigured as isHelmConfigured } from '@/lib/supabase-admin';
import {
  getAllPropertyContracts,
  contractAttention,
  currentTermEnd,
  daysUntil,
  upcomingNoticeDeadline,
  type PropertyContractRow,
} from '@/lib/property-contracts';
import { PROPERTIES } from '@/lib/properties';
import { lastKnownName, RENEWAL_TYPE_WORD, RENEWAL_WORDS, type RenewalWord } from '@/lib/contract-register';
import { startContractRenewal } from '@/app/projections/actions';
import { PropertiesTabBar } from '../PropertiesTabBar';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

/**
 * Fleet-wide management-contract register: one row per managed home, the
 * decisions coming up (non-renewal deadlines are hard dates; miss one and
 * the agreement locks in for another year), and the homes running with no
 * live agreement at all.
 *
 * Layout: "Action needed" first, grouped by DATE (eight contracts sharing
 * a Nov 1 deadline are one decision, not eight lines), then the register as
 * one scannable row per home. The paper's detail (executed date,
 * availability, sale clause, negotiated terms, notes, prior agreements)
 * folds under a native <details> so the fleet stays readable at a glance
 * and no client JS is needed. Each row carries the writes: Register this
 * agreement (./register), Correct this entry, Draft renewal.
 *
 * The renewal words (non-renewal notice, notice window, auto-renews, fixed
 * term, lapsed, superseded) get one plain line where each first appears:
 * under the first Action needed group that uses it, else in the key above
 * the register.
 */

type PropertyLite = {
  id: string;
  name: string;
  owner_last: string | null;
  management_fee_pct: number | null;
  is_active: boolean;
  kind: string | null;
  projection_id: string | null;
  is_rising_tide_owned: boolean | null;
};

async function getManagedProperties(): Promise<PropertyLite[]> {
  if (!isHelmConfigured) return [];
  try {
    const { data, error } = await supabase
      .from('properties')
      .select('id, name, owner_last, management_fee_pct, is_active, kind, projection_id, is_rising_tide_owned')
      .eq('is_active', true)
      .eq('kind', 'managed')
      .order('name');
    if (error) throw error;
    // Rising Tide's own homes (3 Locust) never carry an owner agreement,
    // so they are not part of the register and never read as uncovered.
    return ((data ?? []) as PropertyLite[]).filter((p) => !p.is_rising_tide_owned);
  } catch {
    return [];
  }
}

type ProjectionContract = {
  propertyId: string;
  projectionId: string;
  ownerEmailedAt: string | null;
  signedAt: string | null;
  signedName: string | null;
  countersignedAt: string | null;
  /**
   * awaiting_owner: sent for signature, unsigned.
   * awaiting_countersign: the owner signed; not in force until Rising Tide
   *   countersigns on the prospect page.
   * countersigned: executed in Helm. Normal once the register row exists;
   *   a gap when it does not.
   */
  stage: 'awaiting_owner' | 'awaiting_countersign' | 'countersigned';
};

/**
 * Where each managed home's linked projection contract stands. Helm's
 * e-sign pipeline (a prospect's first agreement, or a renewal drafted by
 * startContractRenewal) lives on projections, not in the register: the
 * register row is written when Rising Tide countersigns. Until then the
 * only record that an owner has signed, or that a draft is out for
 * signature, is the projection, so the page reads it. 20 Enon sat for two
 * weeks as "no live contract" with Kathleen Snyder's signature on file
 * before this did. Contracts marked done outside Helm (Docusign, paper)
 * are not in flight.
 */
async function getProjectionContracts(properties: PropertyLite[]): Promise<ProjectionContract[]> {
  if (!isHelmConfigured) return [];
  const linked = properties.filter((p) => p.projection_id);
  if (linked.length === 0) return [];
  try {
    const { data, error } = await supabase
      .from('projections')
      .select('id, contract_owner_email_sent_at, contract_signed_at, contract_signed_name, contract_countersigned_at, contract_marked_done_at')
      .in('id', linked.map((p) => p.projection_id as string));
    if (error) throw error;
    type Row = {
      id: string;
      contract_owner_email_sent_at: string | null;
      contract_signed_at: string | null;
      contract_signed_name: string | null;
      contract_countersigned_at: string | null;
      contract_marked_done_at: string | null;
    };
    const byId = new Map(((data ?? []) as Row[]).map((r) => [r.id, r]));
    const out: ProjectionContract[] = [];
    for (const p of linked) {
      const r = byId.get(p.projection_id as string);
      if (!r) continue;
      const stage: ProjectionContract['stage'] | null = r.contract_countersigned_at
        ? 'countersigned'
        : r.contract_marked_done_at
          ? null
          : r.contract_signed_at
            ? 'awaiting_countersign'
            : r.contract_owner_email_sent_at
              ? 'awaiting_owner'
              : null;
      if (!stage) continue;
      out.push({
        propertyId: p.id,
        projectionId: r.id,
        ownerEmailedAt: r.contract_owner_email_sent_at,
        signedAt: r.contract_signed_at,
        signedName: r.contract_signed_name,
        countersignedAt: r.contract_countersigned_at,
        stage,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Names for homes that have left the managed roster but still hold a live
 * agreement: the properties row's own name when it survives, else the code
 * roster's, never the raw id.
 */
async function getLastKnownNames(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  let db = new Map<string, string>();
  if (isHelmConfigured) {
    try {
      const { data } = await supabase.from('properties').select('id, name').in('id', ids);
      db = new Map(((data ?? []) as { id: string; name: string | null }[]).filter((r) => r.name).map((r) => [r.id, r.name as string]));
    } catch {
      // fall through to the code roster
    }
  }
  for (const id of ids) {
    out.set(id, lastKnownName(id, { dbName: db.get(id), rosterName: PROPERTIES[id]?.name }));
  }
  return out;
}

type DriveOrphan = { drive_file_id: string; title: string; folder_year: string; drive_url: string };

/**
 * Signed PDFs the weekly contracts-sweep cron found in the Drive Contracts
 * folder with no matching register row. A contract someone dug up and
 * dropped in Drive announces itself here until it is registered.
 */
async function getDriveOrphans(): Promise<DriveOrphan[]> {
  if (!isHelmConfigured) return [];
  try {
    const { data, error } = await supabase
      .from('contract_drive_orphans')
      .select('drive_file_id, title, folder_year, drive_url')
      .order('folder_year', { ascending: false });
    if (error) throw error;
    return (data ?? []) as DriveOrphan[];
  } catch {
    return [];
  }
}

/* ---------- formatting ---------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function fmtMonth(iso: string | null): string {
  if (!iso) return '—';
  const [y, m] = iso.slice(0, 10).split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

/** Calendar date of a timestamp as the office sees it (Eastern), as ISO. */
function dayOf(ts: string): string {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function fmtStamp(ts: string): string {
  return fmtDate(dayOf(ts));
}

/** "Sep 2": for a narrow cell where the year is said elsewhere. */
function fmtStampShort(ts: string): string {
  const [, m, d] = dayOf(ts).split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

function relDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 1) return `in ${days} days`;
  return `${-days} ${plural(-days, 'day')} ago`;
}

const SIGNED_VIA: Record<PropertyContractRow['signed_via'], string> = {
  helm: 'Helm e-sign',
  docusign: 'Docusign',
  external: 'External paperwork',
};

function recordsHref(propertyId: string): string {
  return `/properties/${propertyId}?tab=owner`;
}

/* ---------- page ---------- */

type Chip = { key: string; label: string; href: string; external?: boolean; sub?: string };

function registerHref(q: Record<string, string>): string {
  return `/properties/contracts/register?${new URLSearchParams(q).toString()}`;
}

type Decision = {
  key: string;
  /** ISO date for dated groups; null for the undated ones (uncovered, unregistered). */
  date: string | null;
  heading: string;
  sub: string;
  tone: 'signal' | 'negative';
  sentence: string;
  chips: Chip[];
  /** Renewal words the sentence uses; each is defined where it first appears. */
  words?: RenewalWord[];
};

type RegisterRow = {
  property: PropertyLite;
  live: PropertyContractRow | null;
  /** Expired / superseded rows for the home, newest first. */
  history: PropertyContractRow[];
  /**
   * The home's Helm e-sign contract when it is mid-flight (out for
   * signature, or owner-signed and waiting on Rising Tide), or executed
   * but missing from the register. Null when the register already tells
   * the whole story.
   */
  flight: ProjectionContract | null;
};

const css = `
  .rt-contracts-head, details.rt-contract > summary {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) 64px minmax(0, 1fr) minmax(0, 1.15fr) minmax(0, 1fr) 84px;
    gap: 0 20px;
    align-items: baseline;
  }
  .rt-contracts-head { padding: 12px 0 10px; border-top: 1px solid var(--ink); border-bottom: 1px solid var(--rule); }
  details.rt-contract { border-bottom: 1px solid var(--rule); }
  details.rt-contract > summary { list-style: none; cursor: pointer; padding: 15px 0 14px; outline-offset: 4px; }
  details.rt-contract > summary::-webkit-details-marker { display: none; }
  details.rt-contract > summary:hover .rt-contract-name { color: var(--tide-deep); }
  details.rt-contract .rt-chev { display: inline-block; transition: transform .18s ease; transform-origin: 50% 55%; color: var(--ink-4); font-size: 12px; }
  details.rt-contract[open] .rt-chev { transform: rotate(90deg); }
  details.rt-contract > .rt-contract-body { padding: 2px 0 24px; }
  .rt-decision { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 0 28px; align-items: start; padding: 18px 0; border-top: 1px solid var(--rule-soft); }
  .rt-decision:first-of-type { border-top: none; padding-top: 4px; }
  .rt-chip { display: inline-block; font-size: 12px; padding: 4px 10px; border: 1px solid var(--rule); color: var(--ink); text-decoration: none; line-height: 1.3; }
  .rt-chip:hover { border-color: var(--ink); }
  .rt-chip-sub { color: var(--ink-4); }
  @media (max-width: 760px) {
    .rt-contracts-head { display: none; }
    details.rt-contract { border-top: 1px solid var(--rule); }
    details.rt-contract > summary { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px 16px; }
    .rt-decision { grid-template-columns: 1fr; gap: 8px 0; }
  }
`;

export default async function PropertyContractsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { saved } = await searchParams;
  const todayIso = new Date().toISOString().slice(0, 10);
  const [properties, contracts, driveOrphans] = await Promise.all([
    getManagedProperties(),
    getAllPropertyContracts(),
    getDriveOrphans(),
  ]);
  const projectionContracts = await getProjectionContracts(properties);

  const byProperty = new Map(properties.map((p) => [p.id, p]));
  const live = contracts.filter((c) => c.status === 'active');
  const liveByProperty = new Map(live.map((c) => [c.property_id, c]));
  const historyByProperty = new Map<string, PropertyContractRow[]>();
  for (const c of contracts) {
    if (c.status === 'active') continue;
    historyByProperty.set(c.property_id, [...(historyByProperty.get(c.property_id) ?? []), c]);
  }
  // A projection contract matters here while it is mid-flight, or once
  // executed with no register row to show for it.
  const flightByProperty = new Map<string, ProjectionContract>();
  for (const f of projectionContracts) {
    if (f.stage !== 'countersigned' || !liveByProperty.has(f.propertyId)) flightByProperty.set(f.propertyId, f);
  }
  const unregistered = projectionContracts.filter((f) => f.stage === 'countersigned' && !liveByProperty.has(f.propertyId));
  const awaitingCountersign = projectionContracts.filter((f) => f.stage === 'awaiting_countersign');
  const awaitingOwner = projectionContracts.filter((f) => f.stage === 'awaiting_owner');

  // One register row per managed home, in roster order. A live contract
  // whose home has left the managed roster still gets a row at the end so
  // nothing on file goes invisible.
  const rows: RegisterRow[] = properties.map((p) => ({
    property: p,
    live: liveByProperty.get(p.id) ?? null,
    history: historyByProperty.get(p.id) ?? [],
    flight: flightByProperty.get(p.id) ?? null,
  }));
  const offRosterNames = await getLastKnownNames(live.filter((c) => !byProperty.has(c.property_id)).map((c) => c.property_id));
  for (const c of live) {
    if (byProperty.has(c.property_id)) continue;
    rows.push({
      property: {
        id: c.property_id,
        name: offRosterNames.get(c.property_id) ?? lastKnownName(c.property_id, {}),
        owner_last: null,
        management_fee_pct: null,
        is_active: false,
        kind: null,
        projection_id: null,
        is_rising_tide_owned: null,
      },
      live: c,
      history: historyByProperty.get(c.property_id) ?? [],
      flight: null,
    });
  }

  const uncovered = rows.filter((r) => !r.live && r.flight?.stage !== 'countersigned' && byProperty.has(r.property.id));

  /* ----- action needed, grouped by date ----- */
  const nameOf = (propertyId: string) =>
    byProperty.get(propertyId)?.name ?? offRosterNames.get(propertyId) ?? lastKnownName(propertyId, {});
  const propertyChip = (c: PropertyContractRow): Chip => ({
    key: c.id,
    label: nameOf(c.property_id),
    href: recordsHref(c.property_id),
  });
  const byLabel = (a: Chip, b: Chip) => a.label.localeCompare(b.label);

  const noticeGroups = new Map<string, { contracts: PropertyContractRow[]; locksYear: number }>();
  const renewGroups = new Map<string, PropertyContractRow[]>();
  const lapsedGroups = new Map<string, PropertyContractRow[]>();
  for (const c of live) {
    const a = contractAttention(c, todayIso);
    if (!a) continue;
    if (a.kind === 'notice_window') {
      const g = noticeGroups.get(a.deadline) ?? { contracts: [], locksYear: yearOf(currentTermEnd(c, todayIso)) + 1 };
      g.contracts.push(c);
      noticeGroups.set(a.deadline, g);
    } else if (a.kind === 'needs_renewal') {
      const m = a.days < 0 ? lapsedGroups : renewGroups;
      m.set(c.term_end, [...(m.get(c.term_end) ?? []), c]);
    }
  }

  const dated: Decision[] = [];
  for (const [date, g] of noticeGroups) {
    const n = g.contracts.length;
    const days = daysUntil(date, todayIso);
    dated.push({
      key: `notice:${date}`,
      date,
      heading: fmtDate(date),
      sub: relDays(days),
      tone: days <= 14 ? 'negative' : 'signal',
      sentence: `Last day to give non-renewal notice on ${n} ${plural(n, 'agreement')}. After it, ${n === 1 ? 'it renews' : 'each renews'} for ${g.locksYear}.`,
      chips: g.contracts.map(propertyChip).sort(byLabel),
      words: ['non_renewal'],
    });
  }
  for (const [date, cs] of renewGroups) {
    const n = cs.length;
    const days = daysUntil(date, todayIso);
    const only = n === 1 ? cs[0] : null;
    dated.push({
      key: `term:${date}`,
      date,
      heading: fmtDate(date),
      sub: relDays(days),
      tone: days <= 14 ? 'negative' : 'signal',
      sentence: only
        ? `Term ends. ${only.renewal_type === 'mutual_agreement' ? 'It renews only by mutual written agreement' : 'It is a fixed term and does not renew'}, so a new signature is needed to keep managing.`
        : `Terms end on ${n} agreements and none renews on its own; each needs a new signature to keep managing.`,
      chips: cs.map(propertyChip).sort(byLabel),
      words: [...new Set(cs.map((c) => RENEWAL_TYPE_WORD[c.renewal_type]))],
    });
  }
  for (const [date, cs] of lapsedGroups) {
    dated.push({
      key: `lapsed:${date}`,
      date,
      heading: fmtDate(date),
      sub: 'lapsed',
      tone: 'negative',
      sentence: 'Still managing without a live agreement.',
      chips: cs.map(propertyChip).sort(byLabel),
      words: ['lapsed'],
    });
  }
  dated.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));

  // Rising Tide's own move comes first: an owner has signed and the
  // agreement is not in force until someone here countersigns.
  const head: Decision[] = [];
  if (awaitingCountersign.length > 0) {
    const n = awaitingCountersign.length;
    const only = n === 1 ? awaitingCountersign[0] : null;
    const signedDays = only?.signedAt ? daysUntil(dayOf(only.signedAt), todayIso) : null;
    head.push({
      key: 'countersign',
      date: null,
      heading: 'Countersign',
      sub: only ? (signedDays != null ? `owner signed ${relDays(signedDays)}` : 'owner signed') : `${n} waiting on Rising Tide`,
      tone: 'signal',
      sentence: only
        ? `${only.signedName ?? 'The owner'} signed ${nameOf(only.propertyId)}'s new agreement${only.signedAt ? ` on ${fmtStamp(only.signedAt)}` : ''}. It is not in force until Rising Tide countersigns.`
        : `Owners have signed ${n} new agreements. None is in force until Rising Tide countersigns.`,
      chips: awaitingCountersign
        .map((f) => ({
          key: f.propertyId,
          label: nameOf(f.propertyId),
          href: `/prospects/${f.projectionId}`,
          sub: f.signedAt ? `signed ${fmtStamp(f.signedAt)}` : undefined,
        }))
        .sort(byLabel),
    });
  }

  const tail: Decision[] = [];
  if (awaitingOwner.length > 0) {
    const n = awaitingOwner.length;
    tail.push({
      key: 'awaiting_owner',
      date: null,
      heading: 'Awaiting owner',
      sub: `${n} out for signature`,
      tone: 'signal',
      sentence: 'Sent for signature and not signed yet.',
      chips: awaitingOwner
        .map((f) => ({
          key: f.propertyId,
          label: nameOf(f.propertyId),
          href: `/prospects/${f.projectionId}`,
          sub: f.ownerEmailedAt ? `sent ${fmtStamp(f.ownerEmailedAt)}` : undefined,
        }))
        .sort(byLabel),
    });
  }
  if (uncovered.length > 0) {
    tail.push({
      key: 'uncovered',
      date: null,
      heading: 'No live contract',
      sub: `${uncovered.length} ${plural(uncovered.length, 'home')}`,
      tone: 'negative',
      sentence: 'Managing with no live agreement on file.',
      chips: uncovered.map((r) => {
        const last = r.history[0] ?? null;
        return {
          key: r.property.id,
          label: r.property.name,
          href: recordsHref(r.property.id),
          sub:
            r.flight?.stage === 'awaiting_countersign'
              ? `owner signed${r.flight.signedAt ? ` ${fmtStamp(r.flight.signedAt)}` : ''}, awaiting countersign`
              : r.flight?.stage === 'awaiting_owner'
                ? 'renewal out for signature'
                : last
                  ? `ended ${fmtDate(last.term_end)}`
                  : 'nothing on file',
        };
      }),
    });
  }
  if (unregistered.length > 0) {
    tail.push({
      key: 'register',
      date: null,
      heading: 'Not registered',
      sub: 'signed in Helm',
      tone: 'signal',
      sentence: 'Countersigned in Helm but not in this register yet. Open one to register it; its terms come from the signed contract.',
      chips: unregistered
        .map((u) => ({
          key: u.propertyId,
          label: nameOf(u.propertyId),
          href: registerHref({ property: u.propertyId, projection: u.projectionId }),
          sub: u.countersignedAt ? `signed ${fmtStamp(u.countersignedAt)}` : undefined,
        }))
        .sort(byLabel),
    });
  }
  if (driveOrphans.length > 0) {
    tail.push({
      key: 'drive',
      date: null,
      heading: 'In Drive',
      sub: 'not registered',
      tone: 'signal',
      sentence: 'Signed PDFs in the Drive Contracts folder that are not in this register yet. Open one to register it.',
      chips: driveOrphans.map((o) => ({
        key: o.drive_file_id,
        label: o.title,
        href: registerHref({ drive: o.drive_file_id }),
        sub: o.folder_year,
      })),
    });
  }
  const decisions: Decision[] = [...head, ...dated, ...tail];

  // Each renewal word gets its plain line once, where it first appears:
  // the first Action needed group that uses it, else the register's key.
  const defined = new Set<RenewalWord>();
  const firstUse = (words: RenewalWord[]): RenewalWord[] =>
    words.filter((w) => {
      if (defined.has(w)) return false;
      defined.add(w);
      return true;
    });
  const decisionWords = new Map(decisions.map((d) => [d.key, firstUse(d.words ?? [])]));
  const registerUses: RenewalWord[] = [];
  for (const c of live) {
    registerUses.push(RENEWAL_TYPE_WORD[c.renewal_type]);
    if (c.renewal_type === 'auto_renew' && (c.notice_days_initial || c.notice_days_renewal)) registerUses.push('notice_window');
    if (c.renewal_type !== 'auto_renew' && daysUntil(c.term_end, todayIso) < 0) registerUses.push('lapsed');
  }
  for (const c of contracts) if (c.status !== 'active') registerUses.push(c.status);
  const keyOrder: RenewalWord[] = ['auto_renew', 'notice_window', 'non_renewal', 'fixed', 'mutual_agreement', 'lapsed', 'superseded', 'expired'];
  const registerKey = firstUse(keyOrder.filter((w) => registerUses.includes(w)));

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <style>{css}</style>
      <HelmMasthead />
      <HelmHero
        eyebrow="Helm · Properties"
        title="Management"
        emphasis="contracts."
        description={`${live.length} live ${plural(live.length, 'agreement')} across ${properties.length} managed homes.`}
      />
      <PropertiesTabBar active="contracts" />

      {/* ACTION NEEDED: one group per date, not one line per contract. */}
      {decisions.length > 0 && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 44 }}>
          <div className="eyebrow" style={{ color: 'var(--signal)', marginBottom: 14 }}>
            Action needed
          </div>
          {decisions.map((d) => (
            <div key={d.key} className="rt-decision">
              <div>
                <div
                  className="font-serif"
                  style={{ fontSize: 21, lineHeight: 1.15, color: d.tone === 'negative' ? 'var(--negative)' : 'var(--ink)' }}
                >
                  {d.heading}
                </div>
                <div
                  className="font-mono tabular-nums"
                  style={{ marginTop: 5, fontSize: 11, color: d.tone === 'negative' ? 'var(--negative)' : 'var(--signal)' }}
                >
                  {d.sub}
                </div>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--ink-2)', maxWidth: 640 }}>{d.sentence}</div>
                {(decisionWords.get(d.key) ?? []).map((w) => (
                  <WordLine key={w} word={w} />
                ))}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {d.chips.map((chip) =>
                    chip.external ? (
                      <a key={chip.key} href={chip.href} target="_blank" rel="noreferrer" className="rt-chip">
                        {chip.label}
                        {chip.sub && <span className="rt-chip-sub"> · {chip.sub}</span>}
                      </a>
                    ) : (
                      <Link key={chip.key} href={chip.href} className="rt-chip">
                        {chip.label}
                        {chip.sub && <span className="rt-chip-sub"> · {chip.sub}</span>}
                      </Link>
                    ),
                  )}
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* REGISTER: one row per home, detail folded under each. */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 56 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Register</div>
        {registerKey.length > 0 && (
          <div style={{ display: 'grid', gap: 3, marginBottom: 16, maxWidth: 760 }}>
            {registerKey.map((w) => (
              <WordLine key={w} word={w} />
            ))}
          </div>
        )}
        <div className="rt-contracts-head">
          <div className="eyebrow">Property</div>
          <div className="eyebrow">Fee</div>
          <div className="eyebrow">Term</div>
          <div className="eyebrow">Renewal</div>
          <div className="eyebrow">Next deadline</div>
          <div />
        </div>
        {rows.map((r) => (
          <ContractRow
            key={r.property.id}
            row={r}
            todayIso={todayIso}
            onRoster={byProperty.has(r.property.id)}
            saved={saved === r.property.id}
          />
        ))}
      </section>

      <HelmFooter />
    </div>
  );
}

/* ---------- register row ---------- */

function Cell({
  main,
  sub,
  color,
  bold = false,
}: {
  main: ReactNode;
  sub?: ReactNode;
  color?: string;
  bold?: boolean;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="tabular-nums" style={{ fontSize: 13, color: color ?? 'var(--ink)', fontWeight: bold ? 600 : 400, lineHeight: 1.35 }}>
        {main}
      </div>
      {sub && (
        <div style={{ marginTop: 3, fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.4 }}>{sub}</div>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div className="eyebrow" style={{ paddingTop: 3 }}>{label}</div>
      <div style={{ color: 'var(--ink-2)', lineHeight: 1.55, minWidth: 0 }}>{children}</div>
    </>
  );
}

const flightLinkStyle: CSSProperties = { color: 'var(--tide-deep)', textDecoration: 'none', fontSize: 11.5, whiteSpace: 'nowrap' };

/** One renewal word and its plain meaning, printed where the word first appears. */
function WordLine({ word }: { word: RenewalWord }) {
  const w = RENEWAL_WORDS[word];
  return (
    <div style={{ marginTop: 4, fontSize: 11.5, lineHeight: 1.45, color: 'var(--ink-3)' }}>
      <span style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{w.word}</span>: {w.meaning}
    </div>
  );
}

const actionLinkStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  color: 'var(--tide-deep)',
  textDecoration: 'none',
  padding: '9px 0',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
};

/**
 * The register's writes for one home: register the agreement (or a newer
 * one), correct the live entry, draft a renewal in Helm. Draft renewal is
 * idempotent (it lands on an open draft) and is offered only while no
 * Helm contract is mid-flight, which already has its own link.
 */
function RowActions({ row, onRoster }: { row: RegisterRow; onRoster: boolean }) {
  const { property: p, live, flight } = row;
  const registerQuery: Record<string, string> = { property: p.id };
  if (!live && flight?.stage === 'countersigned') registerQuery.projection = flight.projectionId;
  const startRenewal = startContractRenewal.bind(null, p.id);
  return (
    <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'center', marginTop: 16 }}>
      <Link href={registerHref(registerQuery)} style={actionLinkStyle}>
        {live ? 'Register a new agreement' : 'Register this agreement'}
      </Link>
      {live && (
        <Link href={registerHref({ property: p.id, edit: live.id })} style={{ ...actionLinkStyle, color: 'var(--ink-3)' }}>
          Correct this entry
        </Link>
      )}
      {onRoster && (!flight || flight.stage === 'countersigned') && (
        <form action={startRenewal} style={{ margin: 0 }}>
          <button type="submit" style={{ ...actionLinkStyle, color: 'var(--ink-3)' }}>
            Draft renewal
          </button>
        </form>
      )}
    </div>
  );
}

function SavedNote() {
  return (
    <div role="status" style={{ marginBottom: 12, fontSize: 12.5, color: 'var(--tide-deep)' }}>
      Saved to the register.
    </div>
  );
}

/** The expanded-row line for a Helm e-sign contract that the register does not yet carry. */
function FlightFact({ flight }: { flight: ProjectionContract }) {
  const link = (href: string, label: string) => (
    <Link href={href} style={{ color: 'var(--tide-deep)' }}>
      {label}
    </Link>
  );
  if (flight.stage === 'countersigned') {
    return (
      <Fact label="Signed">
        Countersigned in Helm{flight.countersignedAt ? ` on ${fmtStamp(flight.countersignedAt)}` : ''}, not in this register yet.{' '}
        {link(`/projections/${flight.projectionId}/contract`, 'Open the signed contract')} or{' '}
        {link(registerHref({ property: flight.propertyId, projection: flight.projectionId }), 'register it')}.
      </Fact>
    );
  }
  if (flight.stage === 'awaiting_countersign') {
    return (
      <Fact label="In flight">
        {flight.signedName ?? 'The owner'} signed{flight.signedAt ? ` on ${fmtStamp(flight.signedAt)}` : ''}. Not in force until Rising Tide countersigns.{' '}
        {link(`/prospects/${flight.projectionId}`, 'Countersign on the prospect page')}; the register row is written on execution.
      </Fact>
    );
  }
  return (
    <Fact label="In flight">
      Sent for signature{flight.ownerEmailedAt ? ` on ${fmtStamp(flight.ownerEmailedAt)}` : ''}, not signed yet.{' '}
      {link(`/prospects/${flight.projectionId}`, 'Open the draft')}.
    </Fact>
  );
}

function PdfLink({ href, label = 'PDF ↗' }: { href: string; label?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--tide-deep)', textDecoration: 'none', fontSize: 11.5, whiteSpace: 'nowrap' }}>
      {label}
    </a>
  );
}

function historyLine(h: PropertyContractRow): ReactNode {
  return (
    <>
      {fmtMonth(h.term_start)} to {fmtMonth(h.term_end)}
      {h.fee_pct != null ? ` · ${Number(h.fee_pct)}%` : ''}
      {` · ${h.status}`}
      {h.drive_url && (
        <>
          {' · '}
          <PdfLink href={h.drive_url} label="Signed PDF ↗" />
        </>
      )}
    </>
  );
}

function ContractRow({
  row,
  todayIso,
  onRoster,
  saved,
}: {
  row: RegisterRow;
  todayIso: string;
  onRoster: boolean;
  saved: boolean;
}) {
  const { property: p, live: c, history, flight } = row;
  const nameCell = (owner: string | null, note?: ReactNode) => (
    <div style={{ minWidth: 0 }}>
      <Link
        href={recordsHref(p.id)}
        className="font-serif rt-contract-name"
        style={{ fontSize: 17, color: 'var(--ink)', textDecoration: 'none', lineHeight: 1.2 }}
      >
        {p.name}
      </Link>
      <div style={{ marginTop: 3, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.4 }}>
        {owner}
        {note && <span style={{ color: 'var(--ink-4)', whiteSpace: 'nowrap' }}> · {note}</span>}
      </div>
    </div>
  );
  const chevron = <span className="rt-chev">›</span>;

  /* No live contract on file. */
  if (!c) {
    const last = history[0] ?? null;
    return (
      <details className="rt-contract" id={`contract-${p.id}`} open={saved || undefined}>
        <summary>
          {nameCell(last?.owner_party ?? p.owner_last)}
          <Cell main="—" color="var(--ink-4)" />
          {flight?.stage === 'countersigned' ? (
            <Cell main="Signed in Helm" sub="not registered yet" color="var(--signal)" bold />
          ) : flight?.stage === 'awaiting_countersign' ? (
            <Cell
              main={`Owner signed${flight.signedAt ? ` ${fmtStampShort(flight.signedAt)}` : ''}`}
              sub="awaiting countersign"
              color="var(--signal)"
              bold
            />
          ) : flight?.stage === 'awaiting_owner' ? (
            <Cell
              main={`Sent${flight.ownerEmailedAt ? ` ${fmtStampShort(flight.ownerEmailedAt)}` : ''}`}
              sub="awaiting owner signature"
              color="var(--signal)"
              bold
            />
          ) : (
            <Cell
              main="No live contract"
              sub={last ? `last term ended ${fmtMonth(last.term_end)}` : 'nothing on file'}
              color="var(--negative)"
              bold
            />
          )}
          <Cell main="—" color="var(--ink-4)" />
          <Cell main="—" color="var(--ink-4)" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, alignItems: 'baseline' }}>
            {flight?.stage === 'countersigned' ? (
              <Link href={registerHref({ property: p.id, projection: flight.projectionId })} style={flightLinkStyle}>
                Register →
              </Link>
            ) : flight?.stage === 'awaiting_countersign' ? (
              <Link href={`/prospects/${flight.projectionId}`} style={flightLinkStyle}>
                Countersign →
              </Link>
            ) : flight?.stage === 'awaiting_owner' ? (
              <Link href={`/prospects/${flight.projectionId}`} style={flightLinkStyle}>
                Draft →
              </Link>
            ) : last?.drive_url ? (
              <PdfLink href={last.drive_url} />
            ) : null}
            {chevron}
          </div>
        </summary>
        <div className="rt-contract-body">
          {saved && <SavedNote />}
          <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '9px 24px', fontSize: 13, alignItems: 'baseline', maxWidth: 760 }}>
            {flight && <FlightFact flight={flight} />}
            {last ? (
              <Fact label="Last agreement">
                {last.owner_party} · {SIGNED_VIA[last.signed_via]}
                {last.executed_on ? `, executed ${fmtDate(last.executed_on)}` : ''}
                <br />
                {historyLine(last)}
              </Fact>
            ) : (
              !flight && <Fact label="On file">Nothing.</Fact>
            )}
            {history.slice(1).map((h) => (
              <Fact key={h.id} label="Earlier">
                {h.owner_party} · {historyLine(h)}
              </Fact>
            ))}
          </div>
          <RowActions row={row} onRoster={onRoster} />
        </div>
      </details>
    );
  }

  /* Live contract. */
  const termEnd = currentTermEnd(c, todayIso);
  const rolled = termEnd > c.term_end;
  const upcoming = upcomingNoticeDeadline(c, todayIso);
  const fee = c.fee_pct != null ? Number(c.fee_pct) : null;
  const helmFee = p.management_fee_pct != null ? Number(p.management_fee_pct) : null;
  const feeMismatch = fee != null && helmFee != null && fee !== helmFee;
  const terms = c.special_terms ?? [];
  const negotiated = terms.length + (c.fee_notes ? 1 : 0);
  // A renewal mid-flight outranks the term count on the name line.
  const flightNote =
    flight?.stage === 'awaiting_countersign' ? (
      <span style={{ color: 'var(--signal)' }}>renewal signed by owner, awaiting countersign</span>
    ) : flight?.stage === 'awaiting_owner' ? (
      <span style={{ color: 'var(--signal)' }}>renewal out for signature</span>
    ) : negotiated > 0 ? (
      `${negotiated} negotiated ${plural(negotiated, 'term')}`
    ) : undefined;

  const renewalMain = c.renewal_type === 'auto_renew' ? 'Auto-renews' : c.renewal_type === 'mutual_agreement' ? 'Mutual agreement' : 'Fixed term';
  let renewalSub: string;
  if (c.renewal_type === 'auto_renew') {
    const initial = c.notice_days_initial;
    const later = c.notice_days_renewal;
    renewalSub =
      initial && later && later !== initial
        ? `${initial}-day notice window, ${later} after ${yearOf(c.term_end)}`
        : initial ?? later
          ? `${initial ?? later}-day notice window`
          : 'no notice clause';
  } else {
    renewalSub = c.renewal_type === 'mutual_agreement' ? 'renews only in writing' : 'no renewal clause';
  }

  let deadlineMain: string = '—';
  let deadlineSub: string | undefined;
  let deadlineColor = 'var(--ink-4)';
  let deadlineBold = false;
  if (c.renewal_type === 'auto_renew') {
    if (upcoming) {
      deadlineMain = fmtDate(upcoming.deadline);
      if (upcoming.renewedFor) {
        deadlineSub = `renewed for ${upcoming.renewedFor}`;
        deadlineColor = 'var(--ink-2)';
      } else {
        deadlineSub = relDays(upcoming.days);
        deadlineColor = upcoming.days <= 14 ? 'var(--negative)' : upcoming.days <= 75 ? 'var(--signal)' : 'var(--ink-2)';
        deadlineBold = upcoming.days <= 75;
      }
    } else {
      deadlineMain = 'No notice clause';
    }
  } else {
    const days = daysUntil(c.term_end, todayIso);
    deadlineMain = fmtDate(c.term_end);
    if (days < 0) {
      deadlineSub = 'lapsed';
      deadlineColor = 'var(--negative)';
      deadlineBold = true;
    } else {
      deadlineSub = 'term ends, new signature';
      deadlineColor = days <= 120 ? 'var(--signal)' : 'var(--ink-2)';
      deadlineBold = days <= 120;
    }
  }

  const termMain = c.term_start ? `${fmtMonth(c.term_start)} to ${fmtMonth(termEnd)}` : `Through ${fmtMonth(termEnd)}`;
  const termSub = rolled
    ? `auto-renewed for ${yearOf(termEnd)}`
    : c.executed_on
      ? `signed ${fmtMonth(c.executed_on)}`
      : 'copy on file is undated';

  const saleClause =
    c.sale_notice_days || c.sale_reputation_fee
      ? [
          c.sale_notice_days ? `${c.sale_notice_days}-day notice` : null,
          c.sale_reputation_fee ? `$${Number(c.sale_reputation_fee).toLocaleString('en-US')} reputation fee` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : null;

  return (
    <details className="rt-contract" id={`contract-${p.id}`} open={saved || undefined}>
      <summary>
        {nameCell(c.owner_party, flightNote)}
        <Cell
          main={fee != null ? `${fee}%` : '—'}
          sub={feeMismatch ? `Helm bills ${helmFee}%` : c.fee_notes ? 'conditional' : undefined}
          color={feeMismatch ? 'var(--negative)' : undefined}
          bold={feeMismatch}
        />
        <Cell main={termMain} sub={termSub} />
        <Cell main={renewalMain} sub={renewalSub} />
        <Cell main={deadlineMain} sub={deadlineSub} color={deadlineColor} bold={deadlineBold} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, alignItems: 'baseline' }}>
          {c.drive_url && <PdfLink href={c.drive_url} />}
          {chevron}
        </div>
      </summary>
      <div className="rt-contract-body">
        {saved && <SavedNote />}
        <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '9px 24px', fontSize: 13, alignItems: 'baseline', maxWidth: 760 }}>
          {flight && <FlightFact flight={flight} />}
          <Fact label="Signed">
            {SIGNED_VIA[c.signed_via]}
            {c.executed_on ? `, executed ${fmtDate(c.executed_on)}` : ', copy on file is undated'}
          </Fact>
          <Fact label="Written term">
            {c.term_start ? fmtDate(c.term_start) : 'start not recorded'} to {fmtDate(c.term_end)}
            {rolled && <span style={{ color: 'var(--ink-3)' }}>, now in the {yearOf(termEnd)} renewal term</span>}
          </Fact>
          {feeMismatch && (
            <Fact label="Fee">
              <span style={{ color: 'var(--negative)' }}>
                Contract says {fee}% but Helm bills {helmFee}%. Reconcile before the next statement.
              </span>
            </Fact>
          )}
          {c.fee_notes && <Fact label="Fee mechanics">{c.fee_notes}</Fact>}
          {c.min_availability && <Fact label="Availability">{c.min_availability}</Fact>}
          {saleClause && <Fact label="Sale clause">{saleClause}</Fact>}
          {terms.length > 0 && (
            <Fact label="Negotiated terms">
              <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'disc', display: 'grid', gap: 4 }}>
                {terms.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </Fact>
          )}
          {c.notes && (
            <Fact label="Notes">
              <span style={{ color: 'var(--ink-3)' }}>{c.notes}</span>
            </Fact>
          )}
          {c.drive_url && (
            <Fact label="Document">
              <a href={c.drive_url} target="_blank" rel="noreferrer" style={{ color: 'var(--tide-deep)', textDecoration: 'none' }}>
                {c.doc_title ?? 'Signed PDF'} ↗
              </a>
            </Fact>
          )}
          {history.map((h) => (
            <Fact key={h.id} label="Earlier">
              {h.owner_party} · {historyLine(h)}
            </Fact>
          ))}
        </div>
        <RowActions row={row} onRoster={onRoster} />
      </div>
    </details>
  );
}
