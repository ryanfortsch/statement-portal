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
import { dollars, type ContractorRow } from '@/lib/field-types';
import { getVendor1099Report } from '@/lib/vendor-1099';
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
  not_started: 'not started',
  pending: 'pending',
  cleared: 'cleared ✓',
  failed: 'failed',
};
const BG_TINT: Record<string, string> = {
  not_started: 'var(--ink-4)',
  pending: '#7a5512',
  cleared: 'var(--positive)',
  failed: '#c0392b',
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export const dynamic = 'force-dynamic';

const STATUS_TINT: Record<string, string> = {
  invited: 'var(--ink-4)',
  onboarding: 'var(--signal)',
  active: 'var(--positive)',
  paused: 'var(--ink-4)',
  archived: 'var(--ink-4)',
};

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
const NEXT_TIER_NAME: Record<string, string> = { unrated: 'Bronze', bronze: 'Silver', silver: 'Gold' };

export default async function ContractorsPage() {
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
  const contractors = (data ?? []) as ContractorRow[];
  const base = fieldBaseUrl();

  // Field's own payout ledger + the books/1099 rollup for reconciliation. The
  // 1099 read is by normalized vendor name (or the contractor's vendor_key if
  // set) — it's the actual bank payment, kept separate from Field's agreed
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
  const newApplicants = applications.filter((a) => a.status === 'new' || a.status === 'reviewing').length;
  const booksByKey = new Map<string, { ytd: number; w9: boolean; over: boolean }>();
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

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="field" />
      <FieldTabs current="contractors" />
      <section className="max-w-[900px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
          <div className="font-serif" style={{ fontSize: 26, fontWeight: 400 }}>Contractors</div>
          <Link href="/operations/contractors/applicants" style={{ fontSize: 13, color: newApplicants > 0 ? 'var(--signal)' : 'var(--tide-deep)', fontWeight: newApplicants > 0 ? 600 : 400, textDecoration: 'none' }}>
            Applicants{newApplicants > 0 ? ` · ${newApplicants} new` : ''} →
          </Link>
        </div>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4, marginBottom: 24 }}>
          Invite an inspector and we email them a personal portal link. They set up their account (W-9 +
          agreement) before they can claim paid work.
        </p>

        <form action={inviteContractor} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', borderBottom: '1px solid var(--rule)', paddingBottom: 22, marginBottom: 22 }}>
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
            <select name="trade" defaultValue="inspection" style={inp}>
              <option value="inspection">Inspection</option>
              <option value="maintenance">Maintenance</option>
              <option value="cleaning">Cleaning</option>
            </select>
          </label>
          <button type="submit" style={btnDark}>Send invite</button>
        </form>

        {contractors.length === 0 ? (
          <p style={{ color: 'var(--ink-4)', fontSize: 14 }}>No contractors yet.</p>
        ) : (
          <div style={{ borderTop: '1px solid var(--rule)' }}>
            {ordered.map((c) => (
              <div key={c.id} style={{ borderBottom: '1px solid var(--rule)', padding: '14px 0', display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ width: 38, height: 38, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'var(--paper-2, #fff)', border: '1px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {c.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: 13, color: 'var(--ink-4)' }}>
                        {c.full_name.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
                      </span>
                    )}
                  </span>
                  <div style={{ minWidth: 0 }}>
                  <div className="font-serif" style={{ fontSize: 16 }}>
                    {c.full_name}
                    {c.trade && c.trade !== 'inspection' && (
                      <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--tide-deep)', border: '1px solid var(--rule)', borderRadius: 999, padding: '1px 7px', marginLeft: 8, verticalAlign: 'middle' }}>
                        {c.trade}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>{c.email}{c.phone ? ` · ${c.phone}` : ''}</div>
                  {(() => {
                    const r = ratings.get(c.id);
                    const rank = rankMap.get(c.id);
                    if (!r || r.count === 0) {
                      return <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>Unrated · no guest reviews yet</div>;
                    }
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
                        {rank && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>#{rank}</span>}
                        <span style={{ fontSize: 13, color: 'var(--ink)' }}>
                          ★ {r.rated && r.avg != null ? r.avg.toFixed(2) : '—'}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{r.count} {r.count === 1 ? 'review' : 'reviews'}</span>
                        <span
                          title={r.toNextTier != null ? `${r.toNextTier} more 5★ in a row → ${NEXT_TIER_NAME[r.tier]}` : 'Top tier'}
                          style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: RATING_TIER_TINT[r.tier], border: `1px solid ${RATING_TIER_TINT[r.tier]}`, borderRadius: 999, padding: '1px 7px' }}
                        >
                          {RATING_TIER_LABEL[r.tier]}
                        </span>
                        {r.tier !== 'gold' && r.toNextTier != null && r.toNextTier > 0 && (
                          <span style={{ fontSize: 10.5, color: 'var(--ink-4)' }}>
                            {r.fiveStarTotal} five-star · {r.toNextTier} to {NEXT_TIER_NAME[r.tier]}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                  </div>
                </div>
                <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: STATUS_TINT[c.status] ?? 'var(--ink-4)' }}>
                  {c.status}
                </div>
                {(() => {
                  const rel = reliability.get(c.id);
                  if (!rel) return null;
                  const parts: string[] = [`${rel.completed} done`];
                  if (rel.onTime + rel.late > 0) parts.push(`${Math.round((rel.onTime / (rel.onTime + rel.late)) * 100)}% on-time`);
                  if (rel.reworked) parts.push(`${rel.reworked} redo`);
                  if (rel.flaked) parts.push(`${rel.flaked} flaked`);
                  return (
                    <div style={{ textAlign: 'right', minWidth: 120 }}>
                      <span
                        title="Reliability: completion 50% + on-time 30% + low-rework 20%"
                        style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: TIER_TINT[rel.tier], border: `1px solid ${TIER_TINT[rel.tier]}`, borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}
                      >
                        {TIER_LABEL[rel.tier]}{rel.score != null ? ` · ${rel.score}` : ''}
                      </span>
                      <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 3 }}>{parts.join(' · ')}</div>
                    </div>
                  );
                })()}
                {(() => {
                  const ps = payStats.get(c.id);
                  const books = booksByKey.get(c.vendor_key ? norm(c.vendor_key) : norm(c.full_name));
                  return (
                    <div style={{ fontSize: 11, textAlign: 'right', minWidth: 150 }}>
                      <div>
                        {ps && ps.owedCents > 0 && <span style={{ color: 'var(--signal)' }}>{dollars(ps.owedCents)} owed</span>}
                        {ps && ps.owedCents > 0 && ps.paidCents > 0 && <span style={{ color: 'var(--ink-4)' }}> · </span>}
                        {ps && ps.paidCents > 0 && <span style={{ color: 'var(--positive)' }}>{dollars(ps.paidCents)} paid</span>}
                        {(!ps || (ps.owedCents === 0 && ps.paidCents === 0)) && <span style={{ color: 'var(--ink-4)' }}>no approved work</span>}
                      </div>
                      {ps && ps.owedCents > 0 && (
                        <form action={markContractorPaid} style={{ marginTop: 3, display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
                          <input type="hidden" name="contractor_id" value={c.id} />
                          <input name="reference" placeholder="ref #" style={{ font: 'inherit', fontSize: 10, width: 64, border: '1px solid var(--rule)', background: 'var(--paper)', padding: '2px 4px', color: 'var(--ink)' }} />
                          <button type="submit" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--positive)', fontSize: 11, textDecoration: 'underline', padding: 0 }}>
                            mark {dollars(ps.owedCents)} paid
                          </button>
                        </form>
                      )}
                      <div style={{ color: 'var(--ink-4)', marginTop: 2 }}>
                        books YTD {books ? dollars(Math.round(books.ytd * 100)) : '$0'}
                        {books?.over ? ' · 1099' : ''} ·{' '}
                        <span style={{ color: books?.w9 ? 'var(--positive)' : 'var(--signal)' }}>{books?.w9 ? 'W-9 on file' : 'no W-9'}</span>
                      </div>
                      {(() => {
                        // Reconciliation: Field-recorded payouts vs the bank/books YTD.
                        if (!ps || ps.paidCents === 0 || !books) return null;
                        const booksCents = Math.round(books.ytd * 100);
                        const gap = ps.paidCents - booksCents;
                        if (Math.abs(gap) <= 5000) return null; // within $50, call it matched
                        return (
                          <div style={{ color: 'var(--signal)', marginTop: 2 }}>
                            Field {dollars(ps.paidCents)} vs books {dollars(booksCents)} · gap {dollars(Math.abs(gap))}
                          </div>
                        );
                      })()}
                      {(() => {
                        const w9 = w9s.get(c.id);
                        if (w9) {
                          return (
                            <div style={{ color: 'var(--ink-4)', marginTop: 4, lineHeight: 1.5 }}>
                              <span style={{ color: 'var(--positive)' }}>W-9 on file</span>
                              {' · '}{w9.legalName}
                              {w9.businessName ? ` (${w9.businessName})` : ''}
                              <div>
                                {w9.taxClassification} · {w9.tinType.toUpperCase()} ••••{w9.tinLast4 ?? '????'} ·{' '}
                                <RevealW9 contractorId={c.id} />
                              </div>
                              <div>{w9.address}</div>
                            </div>
                          );
                        }
                        // No in-app W-9 yet — keep the manual books flag toggle.
                        return (
                          <form action={setContractorW9} style={{ marginTop: 4 }}>
                            <input type="hidden" name="contractor_id" value={c.id} />
                            <input type="hidden" name="on_file" value={books?.w9 ? 'false' : 'true'} />
                            <button
                              type="submit"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 11, textDecoration: 'underline', padding: 0 }}
                            >
                              {books?.w9 ? 'clear W-9' : 'mark W-9 on file'}
                            </button>
                          </form>
                        );
                      })()}
                      {(() => {
                        const pm = payMethods.get(c.id);
                        if (!pm) return null;
                        return (
                          <div style={{ color: 'var(--ink-4)', marginTop: 4 }}>
                            Pays via {pm.method}{pm.hint ? ` · ${pm.hint}` : ''}
                            {pm.hasDetails && pm.method === 'Direct deposit (ACH)' ? (
                              <> · <RevealPay contractorId={c.id} /></>
                            ) : null}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}
                <div style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--font-mono-dash), monospace', wordBreak: 'break-all', maxWidth: 240 }}>
                  {base}/field/{c.portal_token}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', width: '100%', marginTop: 2 }}>
                  <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                    Background:{' '}
                    <span style={{ color: BG_TINT[c.background_check_status] ?? 'var(--ink-4)', fontWeight: 600 }}>
                      {BG_LABEL[c.background_check_status] ?? c.background_check_status}
                    </span>
                  </span>
                  {(['pending', 'cleared', 'failed'] as const)
                    .filter((s) => s !== c.background_check_status)
                    .map((s) => (
                      <form key={s} action={setContractorBackgroundCheck} style={{ margin: 0 }}>
                        <input type="hidden" name="contractor_id" value={c.id} />
                        <input type="hidden" name="bg_status" value={s} />
                        <button type="submit" style={ctlBtn} title={`Mark background check ${s}`}>mark {s}</button>
                      </form>
                    ))}
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', width: '100%', marginTop: 2 }}>
                  {c.status === 'active' && (
                    <form action={setContractorStatus} style={{ margin: 0 }}>
                      <input type="hidden" name="contractor_id" value={c.id} />
                      <input type="hidden" name="status" value="paused" />
                      <button type="submit" style={ctlBtn}>pause</button>
                    </form>
                  )}
                  {(c.status === 'paused' || c.status === 'archived') && (
                    <form action={setContractorStatus} style={{ margin: 0 }}>
                      <input type="hidden" name="contractor_id" value={c.id} />
                      <input type="hidden" name="status" value="active" />
                      <button type="submit" style={ctlBtn}>reactivate</button>
                    </form>
                  )}
                  <form action={resendInvite} style={{ margin: 0 }}>
                    <input type="hidden" name="contractor_id" value={c.id} />
                    <button type="submit" style={ctlBtn}>resend invite</button>
                  </form>
                  <form action={rotateContractorToken} style={{ margin: 0 }}>
                    <input type="hidden" name="contractor_id" value={c.id} />
                    <button type="submit" style={ctlBtn} title="Kill the old link + all sessions and email a fresh one">rotate link</button>
                  </form>
                  {c.status !== 'archived' && (
                    <form action={setContractorStatus} style={{ margin: 0 }}>
                      <input type="hidden" name="contractor_id" value={c.id} />
                      <input type="hidden" name="status" value="archived" />
                      <button type="submit" style={{ ...ctlBtn, color: 'var(--signal)' }}>archive</button>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <HelmFooter module="Field" right="Contractor roster" />
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
  minWidth: 180,
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
};
const ctlBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--ink-4)',
  fontSize: 11,
  textDecoration: 'underline',
  padding: 0,
};
