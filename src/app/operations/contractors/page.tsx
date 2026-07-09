import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { FieldTabs } from '@/components/FieldTabs';
import { HelmFooter } from '@/components/HelmFooter';
import { fieldDb, isFieldConfigured } from '@/lib/field-db';
import { fieldBaseUrl } from '@/lib/field-notify';
import { getContractorPayStats, getContractorReliability, loadApplications } from '@/lib/field-packets';
import { getContractorRatings, TIER_RANK, type RatingTier } from '@/lib/field-ratings';
import { loadW9Summaries } from '@/lib/field-w9';
import { loadPaymentSummaries } from '@/lib/field-pay';
import { dollars, parseTrade, TRADE_META, type ContractorRow } from '@/lib/field-types';
import { getVendor1099Report } from '@/lib/vendor-1099';
import { CopyCode } from '@/app/field/CopyCode';
import { SubmitButton } from '@/components/SubmitButton';
import { RevealW9 } from './RevealW9';
import { RevealPay } from './RevealPay';
import {
  inviteContractor,
  setContractorW9,
  setContractorBackgroundCheck,
  markContractorPaid,
  setContractorStatus,
  rotateContractorToken,
  resendInvite,
} from '../packets/actions';

const BG_LABEL: Record<string, string> = {
  not_started: 'Not started',
  pending: 'Pending',
  cleared: 'Cleared',
  failed: 'Failed',
};
const BG_TINT: Record<string, string> = {
  not_started: 'var(--ink-4)',
  pending: '#7a5512',
  cleared: 'var(--positive)',
  failed: '#c0392b',
};

const STATUS_TINT: Record<string, string> = {
  invited: 'var(--ink-4)',
  onboarding: 'var(--signal)',
  active: 'var(--positive)',
  paused: '#7a5512',
  archived: 'var(--ink-4)',
};

// Reliability tiers (completion / on-time / low-rework).
const TIER_LABEL: Record<string, string> = { new: 'New', watch: 'Watch', steady: 'Steady', top: 'Top rated' };
const TIER_TINT: Record<string, string> = {
  new: 'var(--ink-4)',
  watch: 'var(--signal)',
  steady: 'var(--tide-deep)',
  top: 'var(--positive)',
};

// Guest-review reputation tiers (consecutive 5-star streaks).
const RATING_TIER_LABEL: Record<RatingTier, string> = { unrated: 'Unrated', bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };
const RATING_TIER_TINT: Record<RatingTier, string> = { unrated: 'var(--ink-4)', bronze: '#a0522d', silver: '#8a8d91', gold: '#b8860b' };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export const dynamic = 'force-dynamic';

// Exact value shapes from the loaders, so the card props stay in sync without
// re-declaring them.
type MapValue<M> = M extends Map<unknown, infer V> ? V : never;
type RatingVal = MapValue<Awaited<ReturnType<typeof getContractorRatings>>>;
type RelVal = MapValue<Awaited<ReturnType<typeof getContractorReliability>>>;
type PayStatVal = MapValue<Awaited<ReturnType<typeof getContractorPayStats>>>;
type W9Val = MapValue<Awaited<ReturnType<typeof loadW9Summaries>>>;
type PayMethodVal = MapValue<Awaited<ReturnType<typeof loadPaymentSummaries>>>;
type BooksVal = { ytd: number; w9: boolean; over: boolean };

export default async function ContractorsPage({
  searchParams,
}: {
  searchParams: Promise<{ trade?: string }>;
}) {
  const trade = parseTrade((await searchParams).trade);
  const meta = TRADE_META[trade];
  if (!isFieldConfigured) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <HelmMasthead current="field" />
        <section className="max-w-[900px] mx-auto px-10" style={{ paddingTop: 56 }}>
          <p style={{ color: 'var(--ink-3)' }}>Set SUPABASE_SERVICE_ROLE_KEY to enable the Field module.</p>
        </section>
      </div>
    );
  }

  const { data } = await fieldDb()
    .from('contractors')
    .select('*')
    .order('created_at', { ascending: false });
  const contractors = ((data ?? []) as ContractorRow[]).filter((c) => (c.trade ?? 'inspection') === trade);
  const base = fieldBaseUrl();

  // Field's own payout ledger + the books/1099 rollup for reconciliation. The
  // 1099 read is by normalized vendor name (or the contractor's vendor_key if
  // set) -- it's the actual bank payment, kept separate from Field's agreed
  // price so nothing double-counts.
  const [payStats, report, reliability, w9s, ratings, payMethods, applications] = await Promise.all([
    getContractorPayStats(),
    getVendor1099Report().catch(() => null),
    getContractorReliability(),
    loadW9Summaries(),
    getContractorRatings(),
    loadPaymentSummaries(),
    loadApplications().catch(() => []),
  ]);
  const newApplicants = applications.filter(
    (a) => (a.status === 'new' || a.status === 'reviewing') && (a.trade ?? 'inspection') === trade,
  ).length;
  const booksByKey = new Map<string, BooksVal>();
  if (report) {
    for (const r of report.rows) booksByKey.set(r.vendorKey, { ytd: r.ytdTotal, w9: r.w9OnFile, over: r.eligible1099 });
  }

  // Stack-rank by guest-review reputation (tier, then 5-star streak, then
  // average, then volume); inspectors with reviews float to the top, everyone
  // else keeps the default newest-first order.
  const ranked = contractors
    .filter((c) => (ratings.get(c.id)?.count ?? 0) > 0)
    .sort((a, b) => {
      const ra = ratings.get(a.id)!;
      const rb = ratings.get(b.id)!;
      return (
        TIER_RANK[rb.tier] - TIER_RANK[ra.tier] ||
        rb.fiveStreak - ra.fiveStreak ||
        (rb.avg ?? 0) - (ra.avg ?? 0) ||
        rb.count - ra.count
      );
    });
  const rankMap = new Map<string, number>();
  ranked.forEach((c, i) => rankMap.set(c.id, i + 1));
  const ordered = [...ranked, ...contractors.filter((c) => !rankMap.has(c.id))];

  // Active contractors still missing a W-9 (same on-file test the card uses:
  // an in-app W-9 or the books flag). The recurring pre-1099 chore, surfaced as
  // one workspace instead of hunting card to card.
  const needsW9 = ordered.filter((c) => {
    if (c.status !== 'active') return false;
    const hasW9 = w9s.has(c.id) || !!booksByKey.get(c.vendor_key ? norm(c.vendor_key) : norm(c.full_name))?.w9;
    return !hasW9;
  });

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="field" />
      <FieldTabs current="contractors" trade={trade} />
      <section className="max-w-[900px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
          <div className="font-serif" style={{ fontSize: 26, fontWeight: 400 }}>{meta.label}</div>
          <Link href={`/operations/contractors/applicants?trade=${trade}`} style={{ fontSize: 13, color: newApplicants > 0 ? 'var(--signal)' : 'var(--tide-deep)', fontWeight: newApplicants > 0 ? 600 : 400, textDecoration: 'none' }}>
            Applicants{newApplicants > 0 ? ` · ${newApplicants} new` : ''} →
          </Link>
        </div>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4, marginBottom: 20 }}>
          Invite {trade === 'creative' ? 'a contributor' : `a ${meta.singular}`} and we email them a personal portal
          link. They set up their account (W-9 + agreement) before they can {trade === 'creative' ? 'take on paid assets' : 'claim paid work'}.
        </p>

        {trade === 'creative' && <CreativeIntro base={base} />}

        {/* Invite form */}
        <form action={inviteContractor} style={{ border: '1px solid var(--rule)', borderRadius: 12, background: 'var(--paper-2, #fff)', padding: '14px 18px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 26 }}>
          <label style={lbl}>
            Name
            <input name="full_name" required placeholder="Marcus Reed" style={inp} />
          </label>
          <label style={lbl}>
            Email
            <input name="email" type="email" required placeholder="marcus@example.com" style={inp} />
          </label>
          <label style={lbl}>
            Phone
            <input name="phone" type="tel" placeholder="(978) 555-0123" style={inp} />
          </label>
          <label style={lbl}>
            Trade
            <select name="trade" defaultValue={trade} style={inp}>
              <option value="inspection">Inspection</option>
              <option value="maintenance">Maintenance</option>
              <option value="cleaning">Cleaning</option>
              <option value="creative">Creative</option>
            </select>
          </label>
          <SubmitButton label="Send invite" busyLabel="Sending invite…" style={btnDark} />
        </form>

        {/* W-9 workspace: clear the recurring pre-1099 chore in one place. */}
        {needsW9.length > 0 && (
          <div style={{ border: '1px solid var(--signal)', borderRadius: 12, background: 'rgba(200,90,58,0.05)', padding: '14px 18px', marginBottom: 20 }}>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--signal)', fontWeight: 600, marginBottom: 4 }}>
              W-9 needed · {needsW9.length}
            </div>
            <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '0 0 12px', lineHeight: 1.5 }}>
              Active {meta.label.toLowerCase()} without a W-9 on file. You need one before issuing a 1099 — mark each as you collect it.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {needsW9.map((c) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontSize: 14, color: 'var(--ink)' }}>{c.full_name}</span>
                    <span style={{ fontSize: 12, color: 'var(--ink-4)' }}> · {c.email}</span>
                  </div>
                  <form action={setContractorW9} style={{ margin: 0 }}>
                    <input type="hidden" name="contractor_id" value={c.id} />
                    <input type="hidden" name="on_file" value="true" />
                    <SubmitButton label="Mark on file" busyLabel="Marking…" style={actBtn} spinnerTone="ink" />
                  </form>
                </div>
              ))}
            </div>
          </div>
        )}

        {contractors.length === 0 ? (
          <p style={{ color: 'var(--ink-4)', fontSize: 14 }}>No {meta.label.toLowerCase()} yet.</p>
        ) : (
          ordered.map((c) => (
            <ContractorCard
              key={c.id}
              c={c}
              base={base}
              rating={ratings.get(c.id)}
              rank={rankMap.get(c.id)}
              rel={reliability.get(c.id)}
              ps={payStats.get(c.id)}
              w9={w9s.get(c.id)}
              pm={payMethods.get(c.id)}
              books={booksByKey.get(c.vendor_key ? norm(c.vendor_key) : norm(c.full_name))}
            />
          ))
        )}
      </section>
      <HelmFooter module="Field" right={`${meta.label} roster`} />
    </div>
  );
}

/** Reference panel on the Creative roster: this trade has no packet board, so
 *  the office needs the role + pay model + apply link where the people are. */
function CreativeIntro({ base }: { base: string }) {
  const rates: [string, string][] = [
    ['Reel, full', '$95'],
    ['Carousel', '$45'],
    ['Story set', '$30'],
    ['Property capture', '$250'],
    ['Monthly plan', '$175'],
  ];
  return (
    <div style={{ border: '1px solid var(--rule)', borderRadius: 12, background: 'var(--paper-2, #fff)', padding: '16px 18px', marginBottom: 22 }}>
      <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--tide-deep)', fontWeight: 600 }}>
        Pay per delivered asset
      </div>
      <div className="font-serif" style={{ fontSize: 18, marginTop: 4 }}>Social Media Contributor</div>
      <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, marginTop: 6, marginBottom: 12, maxWidth: 560 }}>
        A content role, not a route. They shoot and edit at our homes and deliver ready-to-post assets for Stay Cape
        Ann and Rising Tide. No packets: you approve delivered assets and pay monthly against the rate card.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {rates.map(([k, v]) => (
          <span key={k} style={{ fontSize: 12, color: 'var(--ink-3)', border: '1px solid var(--rule)', borderRadius: 999, padding: '3px 10px' }}>
            {k} <strong style={{ color: 'var(--ink)' }}>{v}</strong>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
        <span style={{ color: 'var(--ink-4)' }}>Public application</span>
        <CopyCode value={`${base}/field/apply?trade=creative`} mono={false} />
        <span style={{ color: 'var(--rule)' }}>·</span>
        <a
          href="https://claude.ai/code/artifact/b7d40497-85f6-4d06-8cb7-e94bb347a540"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--tide-deep)', textDecoration: 'none', fontWeight: 600 }}
        >
          Full hiring package ↗
        </a>
      </div>
    </div>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color, border: `1px solid ${color}`, borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--paper)', borderRadius: 8, padding: '9px 12px', minWidth: 0 }}>
      <div style={{ fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.45 }}>{children}</div>
    </div>
  );
}

function ContractorCard({
  c, base, rating, rank, rel, ps, w9, pm, books,
}: {
  c: ContractorRow;
  base: string;
  rating?: RatingVal;
  rank?: number;
  rel?: RelVal;
  ps?: PayStatVal;
  w9?: W9Val;
  pm?: PayMethodVal;
  books?: BooksVal;
}) {
  const initials = c.full_name.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  const earned = ps && (ps.paidCents > 0 || ps.owedCents > 0);
  const onTimePct = rel && rel.onTime + rel.late > 0 ? Math.round((rel.onTime / (rel.onTime + rel.late)) * 100) : null;
  const booksCents = books ? Math.round(books.ytd * 100) : 0;
  const gap = ps && ps.paidCents > 0 && books ? ps.paidCents - booksCents : 0;
  const w9OnFile = !!w9 || !!books?.w9;

  return (
    <div style={{ border: '1px solid var(--rule)', borderRadius: 12, background: 'var(--paper-2, #fff)', padding: '16px 18px', marginBottom: 14 }}>
      {/* Header: identity + state */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
          <span style={{ width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'var(--paper)', border: '1px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {c.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ fontSize: 13, color: 'var(--ink-4)' }}>{initials}</span>
            )}
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="font-serif" style={{ fontSize: 17, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {c.full_name}
              {c.trade && c.trade !== 'inspection' && (
                <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--tide-deep)', border: '1px solid var(--rule)', borderRadius: 999, padding: '1px 7px' }}>{c.trade}</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 2 }}>{c.email}{c.phone ? ` · ${c.phone}` : ''}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Pill label={c.status} color={STATUS_TINT[c.status] ?? 'var(--ink-4)'} />
          <Pill label={`Check: ${BG_LABEL[c.background_check_status] ?? c.background_check_status}`} color={BG_TINT[c.background_check_status] ?? 'var(--ink-4)'} />
        </div>
      </div>

      {/* Metric ribbon */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 14 }}>
        <Stat label="Earnings">
          {earned ? (
            <>
              {ps!.owedCents > 0 && <span style={{ color: 'var(--signal)', fontWeight: 600 }}>{dollars(ps!.owedCents)} owed</span>}
              {ps!.owedCents > 0 && ps!.paidCents > 0 && <span style={{ color: 'var(--ink-4)' }}> · </span>}
              {ps!.paidCents > 0 && <span style={{ color: 'var(--positive)' }}>{dollars(ps!.paidCents)} paid</span>}
              {ps!.owedCents > 0 && (
                <form action={markContractorPaid} style={{ marginTop: 5, display: 'flex', gap: 5, alignItems: 'center' }}>
                  <input type="hidden" name="contractor_id" value={c.id} />
                  <input name="reference" placeholder="ref #" style={{ font: 'inherit', fontSize: 11, width: 56, border: '1px solid var(--rule)', background: 'var(--paper)', padding: '3px 5px', color: 'var(--ink)', borderRadius: 4 }} />
                  <SubmitButton label={`Mark ${dollars(ps!.owedCents)} paid`} busyLabel="Recording…" style={payBtn} />
                </form>
              )}
            </>
          ) : (
            <span style={{ color: 'var(--ink-4)' }}>No approved work</span>
          )}
        </Stat>

        <Stat label="Guest reviews">
          {rating && rating.count > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              {rank && <span style={{ fontWeight: 700 }}>#{rank}</span>}
              <span>★ {rating.rated && rating.avg != null ? rating.avg.toFixed(2) : '—'}</span>
              <span style={{ color: 'var(--ink-4)', fontSize: 12 }}>{rating.count}</span>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: RATING_TIER_TINT[rating.tier] }}>{RATING_TIER_LABEL[rating.tier]}</span>
            </div>
          ) : (
            <span style={{ color: 'var(--ink-4)' }}>None yet</span>
          )}
        </Stat>

        <Stat label="Reliability">
          {rel ? (
            <>
              <span style={{ color: TIER_TINT[rel.tier], fontWeight: 600 }}>{TIER_LABEL[rel.tier]}{rel.score != null ? ` · ${rel.score}` : ''}</span>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>
                {[`${rel.completed} done`, onTimePct != null ? `${onTimePct}% on-time` : '', rel.reworked ? `${rel.reworked} redo` : '', rel.flaked ? `${rel.flaked} flaked` : ''].filter(Boolean).join(' · ')}
              </div>
            </>
          ) : (
            <span style={{ color: 'var(--ink-4)' }}>No work yet</span>
          )}
        </Stat>

        <Stat label="Books YTD">
          <span>{dollars(booksCents)}{books?.over ? ' · 1099' : ''}</span>
          <div style={{ fontSize: 11, marginTop: 2 }}>
            {w9OnFile ? (
              <span style={{ color: 'var(--positive)' }}>W-9 on file</span>
            ) : (
              <form action={setContractorW9} style={{ display: 'inline' }}>
                <input type="hidden" name="contractor_id" value={c.id} />
                <input type="hidden" name="on_file" value="true" />
                <SubmitButton label="Mark W-9 on file" busyLabel="Marking…" style={linkBtn} spinnerTone="ink" />
              </form>
            )}
          </div>
        </Stat>
      </div>

      {/* Quiet compliance + access strip */}
      <div style={{ marginTop: 13, paddingTop: 12, borderTop: '1px solid var(--rule)', fontSize: 11.5, color: 'var(--ink-4)', lineHeight: 1.7 }}>
        {w9 && (
          <div>
            <span style={{ color: 'var(--ink-3)' }}>{w9.legalName}</span>{w9.businessName ? ` (${w9.businessName})` : ''} · {w9.taxClassification} · {w9.tinType.toUpperCase()} ••••{w9.tinLast4 ?? '????'} · <RevealW9 contractorId={c.id} /> · {w9.address}
          </div>
        )}
        {pm && (
          <div>
            Pays via {pm.method}{pm.hint ? ` · ${pm.hint}` : ''}
            {pm.hasDetails && pm.method === 'Direct deposit (ACH)' ? <> · <RevealPay contractorId={c.id} /></> : null}
          </div>
        )}
        {Math.abs(gap) > 5000 && (
          <div style={{ color: 'var(--signal)' }}>
            Field {dollars(ps!.paidCents)} vs books {dollars(booksCents)} · gap {dollars(Math.abs(gap))}
          </div>
        )}
        <div>
          BG authorization:{' '}
          {c.bg_authorized_at ? (
            <span style={{ color: 'var(--positive)' }}>
              signed{c.bg_authorized_name ? ` by ${c.bg_authorized_name}` : ''} · {new Date(c.bg_authorized_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          ) : (
            <span style={{ color: 'var(--signal)' }}>not on file</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--rule)' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Background</span>
          {(['pending', 'cleared', 'failed'] as const)
            .filter((s) => s !== c.background_check_status)
            .map((s) => (
              <form key={s} action={setContractorBackgroundCheck} style={{ margin: 0 }} title={`Mark background check ${s}`}>
                <input type="hidden" name="contractor_id" value={c.id} />
                <input type="hidden" name="bg_status" value={s} />
                <SubmitButton label={s} busyLabel="Marking…" style={s === 'cleared' ? { ...actBtn, color: 'var(--positive)', borderColor: 'var(--positive)' } : actBtn} spinnerTone="ink" />
              </form>
            ))}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginLeft: 'auto' }}>
          {/* Their portal link, first-class next to the other row actions
              (was buried in the quiet compliance strip below). */}
          <CopyCode value="Copy portal link" copyValue={`${base}/field/${c.portal_token}`} mono={false} />
          {c.status === 'active' && (
            <form action={setContractorStatus} style={{ margin: 0 }}>
              <input type="hidden" name="contractor_id" value={c.id} />
              <input type="hidden" name="status" value="paused" />
              <SubmitButton label="Pause" busyLabel="Pausing…" style={actBtn} spinnerTone="ink" />
            </form>
          )}
          {(c.status === 'paused' || c.status === 'archived') && (
            <form action={setContractorStatus} style={{ margin: 0 }}>
              <input type="hidden" name="contractor_id" value={c.id} />
              <input type="hidden" name="status" value="active" />
              <SubmitButton label="Reactivate" busyLabel="Reactivating…" style={actBtn} spinnerTone="ink" />
            </form>
          )}
          <form action={resendInvite} style={{ margin: 0 }}>
            <input type="hidden" name="contractor_id" value={c.id} />
            <SubmitButton label="Resend invite" busyLabel="Resending…" style={actBtn} spinnerTone="ink" />
          </form>
          <form action={rotateContractorToken} style={{ margin: 0 }} title="Kill the old link + all sessions and email a fresh one">
            <input type="hidden" name="contractor_id" value={c.id} />
            <SubmitButton label="Rotate link" busyLabel="Rotating…" style={actBtn} spinnerTone="ink" />
          </form>
          {c.status !== 'archived' && (
            <form action={setContractorStatus} style={{ margin: 0 }}>
              <input type="hidden" name="contractor_id" value={c.id} />
              <input type="hidden" name="status" value="archived" />
              <SubmitButton label="Archive" busyLabel="Archiving…" style={{ ...actBtn, color: 'var(--signal)', borderColor: 'var(--signal)' }} spinnerTone="ink" />
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

const lbl: React.CSSProperties = { fontSize: 11, color: 'var(--ink-4)', display: 'flex', flexDirection: 'column', gap: 4 };
const inp: React.CSSProperties = {
  font: 'inherit',
  fontSize: 14,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  padding: '8px 10px',
  minWidth: 170,
  borderRadius: 6,
};
const btnDark: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: 'none',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  padding: '10px 18px',
  borderRadius: 6,
};
const actBtn: React.CSSProperties = {
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  borderRadius: 999,
  cursor: 'pointer',
  color: 'var(--ink-3)',
  fontSize: 11,
  fontWeight: 500,
  padding: '4px 12px',
};
const payBtn: React.CSSProperties = {
  background: 'var(--positive)',
  color: 'var(--paper)',
  border: 'none',
  borderRadius: 5,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  padding: '4px 10px',
  whiteSpace: 'nowrap',
};
const linkBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--signal)',
  fontSize: 11,
  textDecoration: 'underline',
  padding: 0,
};
