import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { FieldTabs } from '@/components/FieldTabs';
import { HelmFooter } from '@/components/HelmFooter';
import { fieldDb, isFieldConfigured } from '@/lib/field-db';
import { fieldBaseUrl } from '@/lib/field-notify';
import { getContractorPayStats, getContractorReliability, loadApplications, loadContractorVisits } from '@/lib/field-packets';
import type { ContractorVisits } from '@/lib/field-roster-visits';
import { operatingDate } from '@/lib/operating-date';
import { getContractorRatings, TIER_RANK, type RatingTier } from '@/lib/field-ratings';
import { loadW9Summaries } from '@/lib/field-w9';
import { loadPaymentSummaries } from '@/lib/field-pay';
import { dollars, parseTrade, navTrade, isEmployee, NAV_TRADES, TRADE_META, type ContractorRow } from '@/lib/field-types';
import { buttonClass } from '@/lib/button-class';
import { getVendor1099Report } from '@/lib/vendor-1099';
import { loadRateCards, type RateCard } from '@/lib/creative-rates';
import { isOwnerSession } from '@/lib/helm-access-server';
import { CopyCode } from '@/app/field/CopyCode';
import { SubmitButton } from '@/components/SubmitButton';
import { RevealW9 } from './RevealW9';
import { RevealPay } from './RevealPay';
import { RateCardPanel, TalentRateStrip, rateCardSummary } from './RateCardPanel';
import { Applicants } from './Applicants';
import {
  setContractorW9, setContractorWorkBoard, setContractorEmployment,
  setContractorBackgroundCheck,
  markContractorPaid,
  setContractorStatus,
  rotateContractorToken,
  resendInvite,
} from '../packets/actions';

const BG_LABEL: Record<string, string> = {
  not_started: 'Not started',
  pending: 'Running',
  cleared: 'Cleared',
  failed: 'Failed',
};
const BG_TINT: Record<string, string> = {
  not_started: 'var(--ink-4)',
  pending: '#7a5512',
  cleared: 'var(--positive)',
  failed: '#c0392b',
};

// The DB keeps 'archived'; the office says "retired". Label-only mapping so
// the stored value (and every guard that reads it) stays untouched.
const STATUS_LABEL: Record<string, string> = { archived: 'retired' };

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
  searchParams: Promise<{ trade?: string; w9?: string }>;
}) {
  // A trade with no chip (cleaning) is clamped to Inspectors, the way the
  // packet page clamps it, so the filter line always has a lit trade.
  const sp = await searchParams;
  const trade = navTrade(parseTrade(sp.trade));
  // The W-9 needed filter: the chore list the old box held, as cards.
  const w9Only = sp.w9 === 'needed';
  const meta = TRADE_META[trade];
  // Pay, W-9 and the contractor-admin buttons are owner controls. The
  // actions refuse a staff session; the cards hide them for one too.
  const owner = await isOwnerSession();
  if (!isFieldConfigured) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <HelmMasthead />
        <section className="max-w-[900px] mx-auto px-10" style={{ paddingTop: 56 }}>
          <p style={{ color: 'var(--ink-3)' }}>Ask Ryan: the Field module is not set up.</p>
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
  const today = operatingDate();
  const [payStats, report, reliability, w9s, ratings, payMethods, applications, rateCards, visits] = await Promise.all([
    getContractorPayStats(),
    getVendor1099Report().catch(() => null),
    getContractorReliability(),
    loadW9Summaries(),
    getContractorRatings(),
    loadPaymentSummaries(),
    loadApplications().catch(() => []),
    loadRateCards(),
    // The card's calendar line. A failed read leaves the line saying nothing
    // rather than "No visits yet" about someone booked tomorrow.
    loadContractorVisits(today).catch(() => null),
  ]);
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
  // Retired people keep their record (pay history, W-9, 1099 totals) but stop
  // cluttering the working roster -- they live in their own folded section.
  const working = ordered.filter((c) => c.status !== 'archived');
  const retired = ordered.filter((c) => c.status === 'archived');

  // Active contractors still missing a W-9 (same on-file test the card uses:
  // an in-app W-9 or the books flag). The recurring pre-1099 chore, as a
  // roster filter instead of hunting card to card.
  const needsW9 = ordered.filter((c) => {
    if (c.status !== 'active') return false;
    const hasW9 = w9s.has(c.id) || !!booksByKey.get(c.vendor_key ? norm(c.vendor_key) : norm(c.full_name))?.w9;
    return !hasW9;
  });

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <FieldTabs current="contractors" trade={trade} />
      <section className="max-w-[900px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
          <div className="font-serif" style={{ fontSize: 26, fontWeight: 400 }}>{meta.label}</div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
            {/* What the invitee's portal looks like at each stage — workshop it
                here before any invite goes out. */}
            <Link href={`/field?office=1&trade=${trade}`} target="_blank" style={{ fontSize: 13, color: 'var(--tide-deep)', textDecoration: 'none' }}>
              Preview as contractor →
            </Link>
            {/* The pay ledger is an owner page: no link to it for staff. */}
            {trade === 'creative' && owner && (
              <Link href="/fieldwork/shoots" style={{ fontSize: 13, color: 'var(--tide-deep)', fontWeight: 600, textDecoration: 'none' }}>
                Shoots &amp; pay →
              </Link>
            )}
          </div>
        </div>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4, marginBottom: 18 }}>
          {trade === 'creative'
            ? owner
              ? 'Everyone who shoots for us: standing, pay to date, W-9. To send someone to a home, use Shoots & pay.'
              : 'Everyone who shoots for us. To send someone to a home, ask Ryan.'
            : owner
              ? `Everyone on the ${meta.label.toLowerCase()} roster: standing, reliability, pay to date, W-9.`
              : `Everyone on the ${meta.label.toLowerCase()} roster: standing and reliability.`}
        </p>

        {/* The trade is the first filter: it was the strip's first row until
            the strip became one row (UX audit, 2026-11-07). W-9 needed is
            the second: the chore list the old box at the top held, as the
            cards themselves, each with its own Mark on file. */}
        <nav aria-label="Filter the roster" className="rt-field-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
          {NAV_TRADES.map((t) => (
            <Link key={t} href={`/fieldwork/roster?trade=${t}`} aria-current={t === trade && !w9Only ? 'page' : undefined}>{TRADE_META[t].label}</Link>
          ))}
          {(needsW9.length > 0 || w9Only) && (
            <>
              <span aria-hidden style={{ width: 1, alignSelf: 'stretch', background: 'var(--rule)', margin: '0 4px' }} />
              <Link href={`/fieldwork/roster?trade=${trade}&w9=needed`} aria-current={w9Only ? 'page' : undefined}>W-9 needed · {needsW9.length}</Link>
            </>
          )}
        </nav>

        {/* Hiring lives here now: the applicants for this trade first, with
            the one invite door. The retired Hiring page redirects here. */}
        <Applicants apps={applications} trade={trade} base={base} />

        {/* The rate card folds away: a set-up chore that, open, pushed the
            people below the fold on every visit (Dotti, 2026-09-21:
            "simplify overall"). The fold summary still carries the ladder,
            so the numbers stay one glance away. The panel keeps its
            #rate-card anchor for the save redirect; a fragment landing
            inside a closed details opens it. */}
        {trade === 'creative' && (
          <details style={{ marginBottom: 10 }}>
            <summary style={foldSummary}>
              Reel rate card <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>· {rateCardSummary(rateCards.def)}</span> ▾
            </summary>
            <div style={{ marginTop: 10 }}>
              <RateCardPanel card={rateCards.def} base={base} />
            </div>
          </details>
        )}

        {contractors.length === 0 ? (
          <p style={{ color: 'var(--ink-4)', fontSize: 14 }}>No {meta.label.toLowerCase()} yet.</p>
        ) : w9Only && needsW9.length === 0 ? (
          <p style={{ color: 'var(--ink-4)', fontSize: 14 }}>Every active {meta.singular} has a W-9 on file.</p>
        ) : (
          (w9Only ? needsW9 : working).map((c) => (
            <ContractorCard
              key={c.id}
              c={c}
              base={base}
              owner={owner}
              rating={ratings.get(c.id)}
              rank={rankMap.get(c.id)}
              rel={reliability.get(c.id)}
              ps={payStats.get(c.id)}
              w9={w9s.get(c.id)}
              pm={payMethods.get(c.id)}
              books={booksByKey.get(c.vendor_key ? norm(c.vendor_key) : norm(c.full_name))}
              visits={visits ? visits.get(c.id) ?? { next: null, last: null } : null}
              today={today}
              rate={
                trade === 'creative'
                  ? { card: rateCards.byContractor.get(c.id) ?? rateCards.def, isCustom: rateCards.byContractor.has(c.id) }
                  : null
              }
            />
          ))
        )}

        {/* Retired: off the working roster, one click away. Their record stays
            whole -- pay history, W-9, and books totals still feed the 1099. */}
        {retired.length > 0 && !w9Only && (
          <details style={{ marginTop: 18 }}>
            <summary style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', cursor: 'pointer', padding: '6px 0' }}>
              Retired · {retired.length}
            </summary>
            <div style={{ marginTop: 12 }}>
              {retired.map((c) => (
                <ContractorCard
                  key={c.id}
                  c={c}
                  base={base}
                  owner={owner}
                  rating={ratings.get(c.id)}
                  rank={rankMap.get(c.id)}
                  rel={reliability.get(c.id)}
                  ps={payStats.get(c.id)}
                  w9={w9s.get(c.id)}
                  pm={payMethods.get(c.id)}
                  books={booksByKey.get(c.vendor_key ? norm(c.vendor_key) : norm(c.full_name))}
                  visits={visits ? visits.get(c.id) ?? { next: null, last: null } : null}
                  today={today}
                  rate={
                    trade === 'creative'
                      ? { card: rateCards.byContractor.get(c.id) ?? rateCards.def, isCustom: rateCards.byContractor.has(c.id) }
                      : null
                  }
                />
              ))}
            </div>
          </details>
        )}
      </section>
      <HelmFooter module="Field" right={`${meta.label} roster`} />
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

/** One line of a card's Record: the label, then what it says. */
function RecordRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '108px 1fr', gap: 10, padding: '6px 0', alignItems: 'baseline', borderTop: '1px solid var(--rule)' }}>
      <div style={{ fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.45, minWidth: 0 }}>{children}</div>
    </div>
  );
}

/** "Fri, Oct 24" for a YYYY-MM-DD, pinned to noon UTC so Eastern can't slip a day. */
function fmtVisitDay(d: string): string {
  try {
    return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return d;
  }
}

/** The status pill: where they stand, with the background check folded in
 *  while it is the thing between them and a claim. */
function standingOf(c: ContractorRow): { label: string; color: string; carriesCheck: boolean } {
  const status = STATUS_LABEL[c.status] ?? c.status;
  const tint = STATUS_TINT[c.status] ?? 'var(--ink-4)';
  const bg = c.background_check_status;
  if (c.status === 'archived' || isEmployee(c) || bg === 'cleared') return { label: status, color: tint, carriesCheck: false };
  return { label: `${status} · check ${(BG_LABEL[bg] ?? bg).toLowerCase()}`, color: bg === 'failed' ? BG_TINT.failed : tint, carriesCheck: true };
}

function ContractorCard({
  c, base, owner, rating, rank, rel, ps, w9, pm, books, visits, today, rate,
}: {
  c: ContractorRow;
  base: string;
  /** Owner session: shows pay, W-9 reveal and the admin buttons. */
  owner: boolean;
  rating?: RatingVal;
  rank?: number;
  rel?: RelVal;
  ps?: PayStatVal;
  w9?: W9Val;
  pm?: PayMethodVal;
  books?: BooksVal;
  /** Next and last visit; null when the read failed (the line says nothing). */
  visits: ContractorVisits | null;
  today: string;
  rate?: { card: RateCard; isCustom: boolean } | null;
}) {
  const initials = c.full_name.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  const isCreative = c.trade === 'creative';
  const earned = ps && (ps.paidCents > 0 || ps.owedCents > 0 || ps.pendingCents > 0);
  const onTimePct = rel && rel.onTime + rel.late > 0 ? Math.round((rel.onTime / (rel.onTime + rel.late)) * 100) : null;
  const booksCents = books ? Math.round(books.ytd * 100) : 0;
  const gap = ps && ps.paidCents > 0 && books ? ps.paidCents - booksCents : 0;
  const w9OnFile = !!w9 || !!books?.w9;
  const standing = standingOf(c);
  const noun = isCreative ? 'shoot' : 'visit';
  const visitLine = !visits
    ? null
    : visits.next === today
      ? `${isCreative ? 'Shoot' : 'Visit'} today`
      : visits.next
        ? `Next ${noun} ${fmtVisitDay(visits.next)}`
        : visits.last
          ? `Last ${noun} ${fmtVisitDay(visits.last)}`
          : `No ${noun}s yet`;

  return (
    <details style={{ border: '1px solid var(--rule)', borderRadius: 12, background: 'var(--paper-2, #fff)', marginBottom: 14 }}>
      {/* Collapsed by default: the summary carries three facts (where they
          stand, their next or last visit, their W-9) so the whole roster
          scans in one screen for "who can I send tomorrow". Pay, the
          reliability score and the guest-review medal are in the Record.
          Deliberately uncontrolled -- no `open` prop -- so a card the operator
          expanded stays expanded when an action inside it revalidates. */}
      <summary className="rt-fold-summary" style={{ padding: '16px 18px', cursor: 'pointer', listStyle: 'none' }}>
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
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 2 }}>{c.email}{c.phone ? ` · ${c.phone}` : ''}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
          {isEmployee(c) && <Pill label="Employee" color="var(--tide-deep)" />}
          <Pill label={standing.label} color={standing.color} />
          <span aria-hidden style={{ fontSize: 11, color: 'var(--ink-4)' }}>&#9662;</span>
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
        {visitLine && <span style={{ color: visits?.next ? 'var(--ink-3)' : 'var(--ink-4)' }}>{visitLine}</span>}
        {isEmployee(c) ? (
          <span>On payroll</span>
        ) : w9OnFile ? (
          <span style={{ color: 'var(--positive)' }}>W-9 on file</span>
        ) : (
          <span style={{ color: 'var(--signal)', fontWeight: 600 }}>W-9 needed</span>
        )}
      </div>
      </summary>

      <div style={{ padding: '0 18px 16px' }}>
      {/* The Record: how they have done, in one block. Reliability (or the
          shoots) and guest reviews for everyone; earnings and Books YTD are
          owner money and render for owners only. */}
      <div style={{ marginTop: 14, background: 'var(--paper)', borderRadius: 8, padding: '8px 14px 4px' }}>
        <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, paddingBottom: 6 }}>Record</div>
        {isCreative ? (
          // Creative pay is per delivered post, not per packet, so packet-based
          // reliability (on-time / redo / flaked) doesn't apply: show shoots.
          <RecordRow label="Shoots">
            {ps && ps.approvedCount + ps.paidCount > 0 ? (
              <span>{ps.paidCount} paid{ps.approvedCount > 0 ? ` · ${ps.approvedCount} to pay` : ''}</span>
            ) : (
              <span style={{ color: 'var(--ink-4)' }}>No approved shoots</span>
            )}
          </RecordRow>
        ) : (
          <RecordRow label="Reliability">
            {rel ? (
              <>
                <span style={{ color: TIER_TINT[rel.tier], fontWeight: 600 }}>{TIER_LABEL[rel.tier]}{rel.score != null ? ` · ${rel.score}` : ''}</span>
                <span style={{ color: 'var(--ink-4)', fontSize: 12 }}>
                  {' · '}{[`${rel.completed} done`, onTimePct != null ? `${onTimePct}% on-time` : '', rel.reworked ? `${rel.reworked} redo` : '', rel.flaked ? `${rel.flaked} flaked` : ''].filter(Boolean).join(' · ')}
                </span>
              </>
            ) : (
              <span style={{ color: 'var(--ink-4)' }}>No work yet</span>
            )}
          </RecordRow>
        )}

        <RecordRow label="Guest reviews">
          {rating && rating.count > 0 ? (
            <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap' }}>
              <span>★ {rating.rated && rating.avg != null ? rating.avg.toFixed(2) : '—'}</span>
              <span style={{ color: 'var(--ink-4)', fontSize: 12 }}>({rating.count})</span>
              {rank && <span style={{ color: 'var(--ink-4)', fontSize: 12 }}>#{rank} on the roster</span>}
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: RATING_TIER_TINT[rating.tier] }}>{RATING_TIER_LABEL[rating.tier]}</span>
            </span>
          ) : (
            <span style={{ color: 'var(--ink-4)' }}>None yet</span>
          )}
        </RecordRow>

        {owner && (
          <RecordRow label="Earnings">
            {earned ? (
              <>
                {ps!.owedCents > 0 && <span style={{ color: 'var(--signal)', fontWeight: 600 }}>{dollars(ps!.owedCents)} owed</span>}
                {ps!.owedCents > 0 && ps!.paidCents > 0 && <span style={{ color: 'var(--ink-4)' }}> · </span>}
                {ps!.paidCents > 0 && <span style={{ color: 'var(--positive)' }}>{dollars(ps!.paidCents)} paid</span>}
                {ps!.pendingCents > 0 && (
                  // Approved creative shoots still counting views: real money, not
                  // a firm number yet, so it can't be "paid" from here.
                  <span style={{ fontSize: 11, color: 'var(--ink-4)' }}> · {dollars(ps!.pendingCents)} counting views</span>
                )}
                {ps!.owedCents > 0 && (
                  isCreative ? (
                    // Creative pay is settled per post on the shoot page, not swept here.
                    <Link href="/fieldwork/shoots" style={{ marginTop: 5, display: 'block', fontSize: 11.5, color: 'var(--tide-deep)', fontWeight: 600, textDecoration: 'none' }}>
                      Pay {dollars(ps!.owedCents)} on the shoots →
                    </Link>
                  ) : (
                    <form action={markContractorPaid} style={{ marginTop: 5, display: 'flex', gap: 5, alignItems: 'center' }}>
                      <input type="hidden" name="contractor_id" value={c.id} />
                      <input name="reference" placeholder="ref #" style={{ font: 'inherit', fontSize: 11, width: 56, border: '1px solid var(--rule)', background: 'var(--paper-2, #fff)', padding: '3px 5px', color: 'var(--ink)', borderRadius: 4 }} />
                      <SubmitButton label={`Mark ${dollars(ps!.owedCents)} paid`} busyLabel="Recording…" className={buttonClass('primary', 'sm')} />
                    </form>
                  )
                )}
              </>
            ) : (
              <span style={{ color: 'var(--ink-4)' }}>No approved work</span>
            )}
          </RecordRow>
        )}

        {owner && (
          <RecordRow label="Books YTD">
            <span>{dollars(booksCents)}{books?.over ? ' · 1099' : ''}</span>
            {owner && Math.abs(gap) > 5000 && (
              <span style={{ color: 'var(--signal)' }}>
                {' · '}Field {dollars(ps!.paidCents)} vs books {dollars(booksCents)}, gap {dollars(Math.abs(gap))}
              </span>
            )}
          </RecordRow>
        )}

        {/* The W-9, once: the summary says whether it is on file; this line
            holds the details (owner money: legal name, classification, TIN
            last four, address) or the one verb that records it. Staff read
            the summary only, as before. */}
        {owner && !isEmployee(c) && (
          <RecordRow label="W-9">
            {owner && w9 && (
              <span>
                <span style={{ color: 'var(--ink-3)' }}>{w9.legalName}</span>{w9.businessName ? ` (${w9.businessName})` : ''} · {w9.taxClassification} · {w9.tinType.toUpperCase()} ••••{w9.tinLast4 ?? '????'} · <RevealW9 contractorId={c.id} /> · {w9.address}
              </span>
            )}
            {!w9 && (books?.w9 ? (
              <span style={{ color: 'var(--ink-3)' }}>On file in the books</span>
            ) : (
              <form action={setContractorW9} style={{ display: 'inline' }}>
                <input type="hidden" name="contractor_id" value={c.id} />
                <input type="hidden" name="on_file" value="true" />
                <SubmitButton label="Mark on file" busyLabel="Marking…" className={buttonClass('secondary', 'sm')} spinnerTone="ink" />
              </form>
            ))}
          </RecordRow>
        )}

        {/* The background check, once: its state rides the status pill while
            it stands between them and a claim, and prints here only once the
            pill no longer carries it. The authorization is its own fact. */}
        {!isEmployee(c) && (
          <RecordRow label="Background">
            {!standing.carriesCheck && (
              <span style={{ color: BG_TINT[c.background_check_status] ?? 'var(--ink-4)' }}>{BG_LABEL[c.background_check_status] ?? c.background_check_status} · </span>
            )}
            {c.bg_authorized_at ? (
              <span>
                Authorization signed{c.bg_authorized_name ? ` by ${c.bg_authorized_name}` : ''} · {new Date(c.bg_authorized_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            ) : (
              <span style={{ color: 'var(--signal)' }}>Authorization not on file</span>
            )}
          </RecordRow>
        )}
      </div>

      {/* Creative only: the talent's rate card (standard or custom). */}
      {rate && <TalentRateStrip c={c} card={rate.card} isCustom={rate.isCustom} />}

      {/* Two verbs stay in sight: their portal link and Pause or Reactivate.
          Everything else folds under More (UX audit, 2026-11-07). */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--rule)' }}>
        <CopyCode value="Copy portal link" copyValue={`${base}/field/${c.portal_token}`} mono={false} />
        {/* Pause and reactivate are staff's (2026-10-19). Reactivating a
            retired person restores their access, so that one is the owners'. */}
        {c.status === 'active' && (
          <form action={setContractorStatus} style={{ margin: 0 }}>
            <input type="hidden" name="contractor_id" value={c.id} />
            <input type="hidden" name="status" value="paused" />
            <SubmitButton label="Pause" busyLabel="Pausing…" className={buttonClass('secondary', 'sm')} spinnerTone="ink" />
          </form>
        )}
        {(c.status === 'paused' || (owner && c.status === 'archived')) && (
          <form action={setContractorStatus} style={{ margin: 0 }}>
            <input type="hidden" name="contractor_id" value={c.id} />
            <input type="hidden" name="status" value="active" />
            <SubmitButton label="Reactivate" busyLabel="Reactivating…" className={buttonClass('secondary', 'sm')} spinnerTone="ink" />
          </form>
        )}
      </div>

      <details style={{ marginTop: 10 }}>
        <summary style={foldSummary}>More ▾</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
          {owner && pm && (
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              Pays via {pm.method}{pm.hint ? ` · ${pm.hint}` : ''}
              {owner && pm.hasDetails && pm.method === 'Direct deposit (ACH)' ? <> · <RevealPay contractorId={c.id} /></> : null}
            </div>
          )}
          {/* The check's state is above; these change it. Staff run the
              hiring lifecycle since 2026-10-19 (Dotti), so the ops manager
              clears a check; each change confirms first. Running and cleared
              text and email the contractor (the portal home promises both);
              failed sends nothing, so the office calls. */}
          {!isEmployee(c) && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)', marginRight: 4 }}>Background check</span>
              {(['pending', 'cleared', 'failed'] as const)
                .filter((s) => s !== c.background_check_status)
                .map((s) => {
                  const word = (BG_LABEL[s] ?? s).toLowerCase();
                  const first = c.full_name.split(' ')[0];
                  const tell = c.phone ? 'text and email' : 'email';
                  const effect =
                    s === 'failed'
                      ? `Mark ${first}'s check failed? They can no longer claim work, and nothing is sent to them: call them.`
                      : s === 'pending'
                        ? `Mark ${first}'s check running? They can claim work from now, and we ${tell} them that it is running.`
                        : `Mark ${first}'s check cleared? We ${tell} them that they are all set.`;
                  return (
                    <form key={s} action={setContractorBackgroundCheck} style={{ margin: 0 }} title={`Mark background check ${word}`}>
                      <input type="hidden" name="contractor_id" value={c.id} />
                      <input type="hidden" name="bg_status" value={s} />
                      <SubmitButton label={`Mark ${word}`} busyLabel="Marking…" confirm={effect} className={buttonClass('secondary', 'sm')} spinnerTone="ink" />
                    </form>
                  );
                })}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* The property board grant and Resend invite are staff's
                (2026-10-19). Employment, Rotate link and Retire stay with the
                owners: Retire pulls door codes and republishes their work,
                and the server refuses it for staff. */}
            {owner && (
              <form action={setContractorEmployment} style={{ margin: 0 }} title={isEmployee(c) ? 'Back to a 1099 contractor: paid packets, new-work texts and streak bonuses resume.' : 'On payroll: the record and the work board stay, but no paid packet, new-work text or streak bonus from here on. Approve and pay anything outstanding first.'}>
                <input type="hidden" name="contractor_id" value={c.id} />
                <input type="hidden" name="employment_status" value={isEmployee(c) ? 'contractor' : 'employee'} />
                <SubmitButton label={isEmployee(c) ? 'Mark contractor' : 'Mark employee'} busyLabel="Saving…" className={buttonClass('secondary', 'sm')} spinnerTone="ink" />
              </form>
            )}
            <form action={setContractorWorkBoard} style={{ margin: 0 }} title="The all-properties work-slip board in their Field portal. It reveals the full portfolio, so grant deliberately.">
              <input type="hidden" name="contractor_id" value={c.id} />
              <input type="hidden" name="grant" value={c.work_board_access ? 'false' : 'true'} />
              <SubmitButton
                label={c.work_board_access ? 'Revoke property board' : 'Grant property board'}
                busyLabel="Saving…"
                className={buttonClass('secondary', 'sm')}
                spinnerTone="ink"
              />
            </form>
            <form action={resendInvite} style={{ margin: 0 }}>
              <input type="hidden" name="contractor_id" value={c.id} />
              <SubmitButton label="Resend invite" busyLabel="Resending…" className={buttonClass('secondary', 'sm')} spinnerTone="ink" />
            </form>
            {owner && (
              <form action={rotateContractorToken} style={{ margin: 0 }}>
                <input type="hidden" name="contractor_id" value={c.id} />
                <SubmitButton
                  label="Rotate link"
                  busyLabel="Rotating…"
                  className={buttonClass('secondary', 'sm')}
                  spinnerTone="ink"
                  confirm={`Rotate ${c.full_name.split(' ')[0]}'s link? The old link and every signed-in session stop working, and we email them a fresh one.`}
                />
              </form>
            )}
            {owner && c.status !== 'archived' && (
              <form action={setContractorStatus} style={{ margin: 0 }}>
                <input type="hidden" name="contractor_id" value={c.id} />
                <input type="hidden" name="status" value="archived" />
                <SubmitButton
                  label="Retire"
                  busyLabel="Retiring…"
                  className={buttonClass('danger', 'sm')}
                  spinnerTone="ink"
                  confirm={`Retire ${c.full_name}? Their portal link and signed-in sessions stop working, any live door codes are pulled, and work they were holding goes back on the board with the roster texted. Reactivate brings them back.`}
                />
              </form>
            )}
          </div>
        </div>
      </details>
      </div>
    </details>
  );
}

const foldSummary: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--tide-deep)',
  fontWeight: 600,
  cursor: 'pointer',
  listStyle: 'none',
  userSelect: 'none',
  padding: '6px 0',
};
