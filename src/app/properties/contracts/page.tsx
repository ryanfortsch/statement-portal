import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { Stat } from '@/components/Stat';
import { supabaseAdmin as supabase, isServiceConfigured as isHelmConfigured } from '@/lib/supabase-admin';
import {
  getAllPropertyContracts,
  contractAttention,
  currentTermEnd,
  noticeDeadline,
  daysUntil,
  renewalSummary,
  type PropertyContractRow,
} from '@/lib/property-contracts';
import { PropertiesTabBar } from '../PropertiesTabBar';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

/**
 * Fleet-wide management-contract register. Every property's live agreement
 * (fee, term, renewal mechanics, negotiated clauses, signed PDF), the
 * renewal radar (non-renewal notice deadlines are hard dates — miss one and
 * the contract locks for another year), and the holes: properties operating
 * with an expired agreement or none on file at all.
 */

type PropertyLite = {
  id: string;
  name: string;
  owner_last: string | null;
  management_fee_pct: number | null;
  is_active: boolean;
  kind: string | null;
  projection_id: string | null;
};

async function getManagedProperties(): Promise<PropertyLite[]> {
  if (!isHelmConfigured) return [];
  try {
    const { data, error } = await supabase
      .from('properties')
      .select('id, name, owner_last, management_fee_pct, is_active, kind, projection_id')
      .eq('is_active', true)
      .eq('kind', 'managed')
      .order('name');
    if (error) throw error;
    return (data ?? []) as PropertyLite[];
  } catch {
    return [];
  }
}

/**
 * Helm-signed contracts that never got a registry row: the projection has a
 * countersigned contract but property_contracts has no active row for the
 * property. Keeps the register honest as new prospects sign, without
 * dual-writing from the signing pipeline.
 */
async function getUnregisteredSigned(
  properties: PropertyLite[],
  contracts: PropertyContractRow[],
): Promise<Array<{ propertyId: string; projectionId: string }>> {
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
    const signed = new Set(
      ((data ?? []) as Array<{ id: string; contract_countersigned_at: string | null }>)
        .filter((r) => r.contract_countersigned_at)
        .map((r) => r.id),
    );
    return candidates
      .filter((p) => signed.has(p.projection_id as string))
      .map((p) => ({ propertyId: p.id, projectionId: p.projection_id as string }));
  } catch {
    return [];
  }
}

type DriveOrphan = { drive_file_id: string; title: string; folder_year: string; drive_url: string };

/**
 * Signed PDFs the weekly contracts-sweep cron found in the Drive Contracts
 * folder with no matching register row — a contract someone dug up and
 * dropped in Drive announces itself here until it's registered.
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

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const chipStyle: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '.14em',
  textTransform: 'uppercase',
  fontWeight: 600,
  padding: '3px 8px',
  border: '1px solid var(--rule)',
  color: 'var(--ink-3)',
  whiteSpace: 'nowrap',
};

export default async function PropertyContractsPage() {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [properties, contracts, driveOrphans] = await Promise.all([
    getManagedProperties(),
    getAllPropertyContracts(),
    getDriveOrphans(),
  ]);
  const unregistered = await getUnregisteredSigned(properties, contracts);

  const byProperty = new Map(properties.map((p) => [p.id, p]));
  const active = contracts
    .filter((c) => c.status === 'active')
    .sort((a, b) => {
      const da = noticeDeadline(a, todayIso) ?? currentTermEnd(a, todayIso);
      const db = noticeDeadline(b, todayIso) ?? currentTermEnd(b, todayIso);
      return da.localeCompare(db);
    });
  const history = contracts.filter((c) => c.status !== 'active');
  const coveredIds = new Set(active.map((c) => c.property_id));
  const pendingIds = new Set(unregistered.map((u) => u.propertyId));
  // Properties running with no live agreement: expired-on-file vs nothing at all.
  const uncovered = properties.filter((p) => !coveredIds.has(p.id) && !pendingIds.has(p.id));
  const expiredIds = new Set(history.filter((c) => c.status === 'expired').map((c) => c.property_id));

  const attention = active
    .map((c) => ({ c, a: contractAttention(c, todayIso) }))
    .filter((x): x is { c: PropertyContractRow; a: NonNullable<ReturnType<typeof contractAttention>> } => x.a !== null);
  const attentionCount = attention.length + uncovered.length + driveOrphans.length;

  const fees = active.map((c) => c.fee_pct).filter((f): f is number => f != null);
  const feeSpan = fees.length ? `${Math.min(...fees)}–${Math.max(...fees)}%` : '—';

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <HelmHero
        eyebrow="Helm · Properties"
        title="Management"
        emphasis="contracts."
        description={`${active.length} live agreements across ${properties.length} managed properties. Terms from the signed PDFs, deadlines derived from the clauses.`}
      />
      <PropertiesTabBar active="contracts" />

      {/* STAT STRIP */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 28 }}>
        <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)' }}>
          <div className="rt-helm-stat-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <Stat label="Live contracts" value={active.length} />
            <Stat
              label="Need attention"
              value={attentionCount}
              accent={attentionCount > 0}
              sub={attentionCount ? 'deadlines + gaps below' : 'all quiet'}
            />
            <Stat
              label="No live contract"
              value={uncovered.length}
              valueColor={uncovered.length ? 'var(--negative)' : undefined}
            />
            <Stat label="Fee span" value={feeSpan} sub="headline commission" last />
          </div>
        </div>
      </section>

      {/* RENEWAL RADAR — renders only when something needs a decision. */}
      {(attention.length > 0 || uncovered.length > 0 || unregistered.length > 0 || driveOrphans.length > 0) && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 34 }}>
          <div style={{ borderTop: '1px solid var(--rule-soft)', paddingTop: 18 }}>
            <div className="eyebrow" style={{ color: 'var(--signal)', marginBottom: 12 }}>
              Action needed
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 10, fontSize: 13.5, lineHeight: 1.55 }}>
              {attention.map(({ c, a }) => {
                const p = byProperty.get(c.property_id);
                return (
                  <li key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                    <span
                      className="font-mono tabular-nums"
                      style={{
                        fontSize: 11,
                        color: a.kind === 'notice_window' && a.days <= 14 ? 'var(--negative)' : 'var(--signal)',
                        minWidth: 86,
                      }}
                    >
                      {a.kind === 'notice_window' ? fmtDate(a.deadline) : a.kind === 'needs_renewal' && a.days >= 0 ? fmtDate(c.term_end) : 'lapsed'}
                    </span>
                    <span>
                      <Link href={`/properties/${c.property_id}?tab=records`} style={{ color: 'var(--ink)', fontWeight: 600, textDecoration: 'none' }}>
                        {p?.name ?? c.property_id}
                      </Link>
                      {' — '}
                      {a.detail}
                    </span>
                  </li>
                );
              })}
              {uncovered.map((p) => (
                <li key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                  <span className="font-mono tabular-nums" style={{ fontSize: 11, color: 'var(--negative)', minWidth: 86 }}>
                    uncovered
                  </span>
                  <span>
                    <Link href={`/properties/${p.id}?tab=records`} style={{ color: 'var(--ink)', fontWeight: 600, textDecoration: 'none' }}>
                      {p.name}
                    </Link>
                    {' — '}
                    {expiredIds.has(p.id)
                      ? 'last agreement expired; operating without a live contract'
                      : 'no management agreement on file'}
                  </span>
                </li>
              ))}
              {driveOrphans.map((o) => (
                <li key={o.drive_file_id} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                  <span className="font-mono tabular-nums" style={{ fontSize: 11, color: 'var(--signal)', minWidth: 86 }}>
                    in Drive
                  </span>
                  <span>
                    <a href={o.drive_url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink)', fontWeight: 600 }}>
                      {o.title}
                    </a>
                    {` — found in the Contracts/${o.folder_year} folder but not in this register yet`}
                  </span>
                </li>
              ))}
              {unregistered.map((u) => {
                const p = byProperty.get(u.propertyId);
                return (
                  <li key={u.propertyId} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                    <span className="font-mono tabular-nums" style={{ fontSize: 11, color: 'var(--signal)', minWidth: 86 }}>
                      register
                    </span>
                    <span>
                      <Link href={`/properties/${u.propertyId}?tab=records`} style={{ color: 'var(--ink)', fontWeight: 600, textDecoration: 'none' }}>
                        {p?.name ?? u.propertyId}
                      </Link>
                      {' — Helm-signed contract not yet in this register ('}
                      <Link href={`/projections/${u.projectionId}/contract`} style={{ color: 'var(--tide-deep)' }}>
                        view signed contract
                      </Link>
                      {')'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      {/* LIVE AGREEMENTS */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 40 }}>
        <div className="eyebrow" style={{ marginBottom: 4 }}>Live agreements</div>
        {active.map((c) => {
          const p = byProperty.get(c.property_id);
          const termEnd = currentTermEnd(c, todayIso);
          const rolled = termEnd > c.term_end;
          const deadline = noticeDeadline(c, todayIso);
          const deadlineDays = deadline ? daysUntil(deadline, todayIso) : null;
          const feeMismatch =
            c.fee_pct != null && p?.management_fee_pct != null && Number(p.management_fee_pct) !== Number(c.fee_pct);
          return (
            <div key={c.id} style={{ borderTop: '1px solid var(--rule)', padding: '18px 0' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', alignItems: 'baseline' }}>
                <Link
                  href={`/properties/${c.property_id}?tab=records`}
                  className="font-serif"
                  style={{ fontSize: 19, color: 'var(--ink)', textDecoration: 'none', fontWeight: 500 }}
                >
                  {p?.name ?? c.property_id}
                </Link>
                <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{c.owner_party}</span>
                <span style={{ flex: 1 }} />
                <span style={chipStyle}>{c.fee_pct != null ? `${c.fee_pct}% fee` : 'fee n/a'}</span>
                <span style={chipStyle}>
                  {c.signed_via === 'helm' ? 'Helm e-sign' : c.signed_via === 'docusign' ? 'Docusign' : 'External'}
                </span>
                {c.drive_url && (
                  <a href={c.drive_url} target="_blank" rel="noreferrer" style={{ ...chipStyle, color: 'var(--tide-deep)', textDecoration: 'none' }}>
                    Signed PDF ↗
                  </a>
                )}
              </div>
              <div style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6, maxWidth: 860 }}>
                {fmtDate(c.term_start)} to {fmtDate(termEnd)}
                {rolled && (
                  <span style={{ color: 'var(--ink-3)' }}> (auto-renewed; written term ended {fmtDate(c.term_end)})</span>
                )}
                {' · '}
                {renewalSummary(c)}
                {deadline && (
                  <>
                    {' · '}
                    <span
                      className="tabular-nums"
                      style={{
                        color:
                          deadlineDays != null && deadlineDays <= 14
                            ? 'var(--negative)'
                            : deadlineDays != null && deadlineDays <= 75
                              ? 'var(--signal)'
                              : 'var(--ink-3)',
                        fontWeight: deadlineDays != null && deadlineDays <= 75 ? 600 : 400,
                      }}
                    >
                      notice deadline {fmtDate(deadline)}
                      {deadlineDays != null && deadlineDays >= 0 ? ` (${deadlineDays}d)` : ''}
                    </span>
                  </>
                )}
              </div>
              {feeMismatch && (
                <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--negative)' }}>
                  Contract says {c.fee_pct}% but Helm bills {p?.management_fee_pct}% — reconcile before the next statement.
                </div>
              )}
              {c.fee_notes && (
                <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--ink-3)', maxWidth: 860, lineHeight: 1.55 }}>
                  Fee mechanics: {c.fee_notes}
                </div>
              )}
              {c.min_availability && (
                <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--ink-3)', maxWidth: 860, lineHeight: 1.55 }}>
                  Availability: {c.min_availability}
                </div>
              )}
              {c.special_terms.length > 0 && (
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6, maxWidth: 860 }}>
                  {c.special_terms.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              )}
              {c.notes && (
                <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--signal)', maxWidth: 860, lineHeight: 1.55 }}>
                  {c.notes}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* HISTORY */}
      {history.length > 0 && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 48 }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Past agreements</div>
          {history.map((c) => {
            const p = byProperty.get(c.property_id);
            return (
              <div
                key={c.id}
                style={{ borderTop: '1px solid var(--rule-soft)', padding: '12px 0', fontSize: 13, color: 'var(--ink-3)', display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'baseline' }}
              >
                <span style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{p?.name ?? c.property_id}</span>
                <span>{c.owner_party}</span>
                <span className="tabular-nums">
                  {fmtDate(c.term_start)} to {fmtDate(c.term_end)}
                </span>
                <span>{c.fee_pct != null ? `${c.fee_pct}%` : ''}</span>
                <span style={chipStyle}>{c.status}</span>
                {c.drive_url && (
                  <a href={c.drive_url} target="_blank" rel="noreferrer" style={{ color: 'var(--tide-deep)', textDecoration: 'none', fontSize: 12 }}>
                    Signed PDF ↗
                  </a>
                )}
              </div>
            );
          })}
        </section>
      )}

      <HelmFooter />
    </div>
  );
}
