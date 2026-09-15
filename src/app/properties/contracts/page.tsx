import Link from 'next/link';
import type { ReactNode } from 'react';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { Stat } from '@/components/Stat';
import { supabaseAdmin as supabase, isServiceConfigured as isHelmConfigured } from '@/lib/supabase-admin';
import {
  getAllPropertyContracts,
  contractAttention,
  currentTermEnd,
  daysUntil,
  nextDecisionDate,
  upcomingNoticeDeadline,
  type PropertyContractRow,
} from '@/lib/property-contracts';
import { PropertiesTabBar } from '../PropertiesTabBar';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

/**
 * Fleet-wide management-contract register: one row per managed home, the
 * decisions coming up (non-renewal deadlines are hard dates; miss one and
 * the agreement locks in for another year), and the homes running with no
 * live agreement at all.
 *
 * Layout: a short strip of the numbers that matter, then "Action needed"
 * grouped by DATE (eight contracts sharing a Nov 1 deadline are one
 * decision, not eight lines), then the register as one scannable row per
 * home. The paper's detail (executed date, availability, sale clause,
 * negotiated terms, notes, prior agreements) folds under a native
 * <details> so the fleet stays readable at a glance and no client JS is
 * needed.
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

type UnregisteredSigned = { propertyId: string; projectionId: string; countersignedAt: string | null };

/**
 * Helm-signed contracts that never got a registry row: the projection has a
 * countersigned contract but property_contracts has no active row for the
 * property. Keeps the register honest as new prospects sign, without
 * dual-writing from the signing pipeline.
 */
async function getUnregisteredSigned(
  properties: PropertyLite[],
  contracts: PropertyContractRow[],
): Promise<UnregisteredSigned[]> {
  if (!isHelmConfigured) return [];
  const covered = new Set(contracts.filter((c) => c.status === 'active').map((c) => c.property_id));
  const candidates = properties.filter((p) => p.projection_id && !covered.has(p.id));
  if (candidates.length === 0) return [];
  try {
    const { data, error } = await supabase
      .from('projections')
      .select('id, contract_countersigned_at')
      .in('id', candidates.map((p) => p.projection_id as string));
    if (error) throw error;
    const signed = new Map(
      ((data ?? []) as Array<{ id: string; contract_countersigned_at: string | null }>)
        .filter((r) => r.contract_countersigned_at)
        .map((r) => [r.id, r.contract_countersigned_at]),
    );
    return candidates
      .filter((p) => signed.has(p.projection_id as string))
      .map((p) => ({
        propertyId: p.id,
        projectionId: p.projection_id as string,
        countersignedAt: signed.get(p.projection_id as string) ?? null,
      }));
  } catch {
    return [];
  }
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
  return `/properties/${propertyId}?tab=records`;
}

/* ---------- page ---------- */

type Chip = { key: string; label: string; href: string; external?: boolean; sub?: string };

type Decision = {
  key: string;
  /** ISO date for dated groups; null for the undated ones (uncovered, unregistered). */
  date: string | null;
  heading: string;
  sub: string;
  tone: 'signal' | 'negative';
  sentence: string;
  chips: Chip[];
};

type RegisterRow = {
  property: PropertyLite;
  live: PropertyContractRow | null;
  /** Expired / superseded rows for the home, newest first. */
  history: PropertyContractRow[];
  pending: UnregisteredSigned | null;
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

export default async function PropertyContractsPage() {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [properties, contracts, driveOrphans] = await Promise.all([
    getManagedProperties(),
    getAllPropertyContracts(),
    getDriveOrphans(),
  ]);
  const unregistered = await getUnregisteredSigned(properties, contracts);

  const byProperty = new Map(properties.map((p) => [p.id, p]));
  const live = contracts.filter((c) => c.status === 'active');
  const liveByProperty = new Map(live.map((c) => [c.property_id, c]));
  const historyByProperty = new Map<string, PropertyContractRow[]>();
  for (const c of contracts) {
    if (c.status === 'active') continue;
    historyByProperty.set(c.property_id, [...(historyByProperty.get(c.property_id) ?? []), c]);
  }
  const pendingByProperty = new Map(unregistered.map((u) => [u.propertyId, u]));

  // One register row per managed home, in roster order. A live contract
  // whose home has left the managed roster still gets a row at the end so
  // nothing on file goes invisible.
  const rows: RegisterRow[] = properties.map((p) => ({
    property: p,
    live: liveByProperty.get(p.id) ?? null,
    history: historyByProperty.get(p.id) ?? [],
    pending: pendingByProperty.get(p.id) ?? null,
  }));
  for (const c of live) {
    if (byProperty.has(c.property_id)) continue;
    rows.push({
      property: {
        id: c.property_id,
        name: c.property_id,
        owner_last: null,
        management_fee_pct: null,
        is_active: false,
        kind: null,
        projection_id: null,
        is_rising_tide_owned: null,
      },
      live: c,
      history: historyByProperty.get(c.property_id) ?? [],
      pending: null,
    });
  }

  const uncovered = rows.filter((r) => !r.live && !r.pending && byProperty.has(r.property.id));

  /* ----- the numbers ----- */
  const ahead = live
    .map((c) => nextDecisionDate(c, todayIso))
    .filter((d): d is NonNullable<typeof d> => d !== null);
  const nextDate = ahead.length ? ahead.map((d) => d.date).sort()[0] : null;
  const nextCount = nextDate ? ahead.filter((d) => d.date === nextDate).length : 0;
  const nextDays = nextDate ? daysUntil(nextDate, todayIso) : null;
  const nextYear = yearOf(todayIso) + 1;
  const settled = ahead.filter((d) => yearOf(d.date) >= nextYear).length;

  /* ----- action needed, grouped by date ----- */
  const propertyChip = (c: PropertyContractRow): Chip => ({
    key: c.id,
    label: byProperty.get(c.property_id)?.name ?? c.property_id,
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

  const decisions: Decision[] = [];
  for (const [date, g] of noticeGroups) {
    const n = g.contracts.length;
    const days = daysUntil(date, todayIso);
    decisions.push({
      key: `notice:${date}`,
      date,
      heading: fmtDate(date),
      sub: relDays(days),
      tone: days <= 14 ? 'negative' : 'signal',
      sentence: `Last day to give non-renewal notice on ${n} ${plural(n, 'agreement')}. After it, ${n === 1 ? 'it renews' : 'each renews'} for ${g.locksYear}.`,
      chips: g.contracts.map(propertyChip).sort(byLabel),
    });
  }
  for (const [date, cs] of renewGroups) {
    const n = cs.length;
    const days = daysUntil(date, todayIso);
    const only = n === 1 ? cs[0] : null;
    decisions.push({
      key: `term:${date}`,
      date,
      heading: fmtDate(date),
      sub: relDays(days),
      tone: days <= 14 ? 'negative' : 'signal',
      sentence: only
        ? `Term ends. ${only.renewal_type === 'mutual_agreement' ? 'It renews only by mutual written agreement' : 'It does not renew'}, so a new signature is needed to keep managing.`
        : `Terms end on ${n} agreements. None auto-renews; each needs a new signature to keep managing.`,
      chips: cs.map(propertyChip).sort(byLabel),
    });
  }
  for (const [date, cs] of lapsedGroups) {
    decisions.push({
      key: `lapsed:${date}`,
      date,
      heading: fmtDate(date),
      sub: 'lapsed',
      tone: 'negative',
      sentence: 'Term ended and nothing renewed it. Still managing without a live agreement.',
      chips: cs.map(propertyChip).sort(byLabel),
    });
  }
  decisions.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));

  if (uncovered.length > 0) {
    decisions.push({
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
          sub: last ? `ended ${fmtDate(last.term_end)}` : 'nothing on file',
        };
      }),
    });
  }
  if (unregistered.length > 0) {
    decisions.push({
      key: 'register',
      date: null,
      heading: 'Not registered',
      sub: 'signed in Helm',
      tone: 'signal',
      sentence: 'Countersigned in Helm but not in this register yet.',
      chips: unregistered
        .map((u) => ({
          key: u.propertyId,
          label: byProperty.get(u.propertyId)?.name ?? u.propertyId,
          href: `/projections/${u.projectionId}/contract`,
          sub: u.countersignedAt ? `signed ${fmtDate(u.countersignedAt)}` : undefined,
        }))
        .sort(byLabel),
    });
  }
  if (driveOrphans.length > 0) {
    decisions.push({
      key: 'drive',
      date: null,
      heading: 'In Drive',
      sub: 'not registered',
      tone: 'signal',
      sentence: 'Signed PDFs in the Drive Contracts folder that are not in this register yet.',
      chips: driveOrphans.map((o) => ({
        key: o.drive_file_id,
        label: o.title,
        href: o.drive_url,
        external: true,
        sub: o.folder_year,
      })),
    });
  }

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

      {/* STAT STRIP */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 36 }}>
        <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)' }}>
          <div className="rt-helm-stat-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <Stat label="Live contracts" value={live.length} sub={`of ${properties.length} managed homes`} />
            <Stat
              label="Next deadline"
              value={nextDate ? fmtDate(nextDate) : '—'}
              sub={nextDate && nextDays != null ? `${relDays(nextDays)} · ${nextCount} ${plural(nextCount, 'agreement')}` : 'nothing ahead'}
              accent={nextDays != null && nextDays <= 75}
            />
            <Stat label={`Settled for ${nextYear}`} value={settled} sub="nothing to decide this year" />
            <Stat
              label="No live contract"
              value={uncovered.length}
              valueColor={uncovered.length ? 'var(--negative)' : undefined}
              sub={uncovered.length ? uncovered.map((r) => r.property.name).join(', ') : 'every home is covered'}
              last
            />
          </div>
        </div>
      </section>

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
        <div className="rt-contracts-head">
          <div className="eyebrow">Property</div>
          <div className="eyebrow">Fee</div>
          <div className="eyebrow">Term</div>
          <div className="eyebrow">Renewal</div>
          <div className="eyebrow">Next deadline</div>
          <div />
        </div>
        {rows.map((r) => (
          <ContractRow key={r.property.id} row={r} todayIso={todayIso} />
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

function ContractRow({ row, todayIso }: { row: RegisterRow; todayIso: string }) {
  const { property: p, live: c, history, pending } = row;
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
      <details className="rt-contract" id={`contract-${p.id}`}>
        <summary>
          {nameCell(last?.owner_party ?? p.owner_last)}
          <Cell main="—" color="var(--ink-4)" />
          {pending ? (
            <Cell main="Signed in Helm" sub="not registered yet" color="var(--signal)" bold />
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
            {pending ? (
              <Link
                href={`/projections/${pending.projectionId}/contract`}
                style={{ color: 'var(--tide-deep)', textDecoration: 'none', fontSize: 11.5, whiteSpace: 'nowrap' }}
              >
                Signed ↗
              </Link>
            ) : last?.drive_url ? (
              <PdfLink href={last.drive_url} />
            ) : null}
            {chevron}
          </div>
        </summary>
        <div className="rt-contract-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '9px 24px', fontSize: 13, alignItems: 'baseline', maxWidth: 760 }}>
            {pending && (
              <Fact label="Signed">
                Countersigned in Helm{pending.countersignedAt ? ` on ${fmtDate(pending.countersignedAt)}` : ''}.{' '}
                <Link href={`/projections/${pending.projectionId}/contract`} style={{ color: 'var(--tide-deep)' }}>
                  Open the signed contract
                </Link>
                . It joins this register once its terms are entered.
              </Fact>
            )}
            {last ? (
              <Fact label="Last agreement">
                {last.owner_party} · {SIGNED_VIA[last.signed_via]}
                {last.executed_on ? `, executed ${fmtDate(last.executed_on)}` : ''}
                <br />
                {historyLine(last)}
              </Fact>
            ) : (
              !pending && <Fact label="On file">Nothing.</Fact>
            )}
            {history.slice(1).map((h) => (
              <Fact key={h.id} label="Earlier">
                {h.owner_party} · {historyLine(h)}
              </Fact>
            ))}
          </div>
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

  const renewalMain = c.renewal_type === 'auto_renew' ? 'Auto-renews' : c.renewal_type === 'mutual_agreement' ? 'Mutual agreement' : 'Fixed term';
  let renewalSub: string;
  if (c.renewal_type === 'auto_renew') {
    const initial = c.notice_days_initial;
    const later = c.notice_days_renewal;
    renewalSub =
      initial && later && later !== initial
        ? `${initial}-day notice, ${later} after ${yearOf(c.term_end)}`
        : `${initial ?? later ?? '—'}-day notice`;
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
    <details className="rt-contract" id={`contract-${p.id}`}>
      <summary>
        {nameCell(c.owner_party, negotiated > 0 ? `${negotiated} negotiated ${plural(negotiated, 'term')}` : undefined)}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '9px 24px', fontSize: 13, alignItems: 'baseline', maxWidth: 760 }}>
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
      </div>
    </details>
  );
}
