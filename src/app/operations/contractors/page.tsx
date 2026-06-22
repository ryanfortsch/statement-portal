import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { fieldDb, isFieldConfigured } from '@/lib/field-db';
import { fieldBaseUrl } from '@/lib/field-notify';
import { getContractorPayStats, getContractorReliability } from '@/lib/field-packets';
import { dollars, type ContractorRow } from '@/lib/field-types';
import { getVendor1099Report } from '@/lib/vendor-1099';
import {
  inviteContractor,
  setContractorW9,
  markContractorPaid,
  setContractorStatus,
  rotateContractorToken,
  resendInvite,
} from '../packets/actions';

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
  const [payStats, report, reliability] = await Promise.all([
    getContractorPayStats(),
    getVendor1099Report().catch(() => null),
    getContractorReliability(),
  ]);
  const booksByKey = new Map<string, { ytd: number; w9: boolean; over: boolean }>();
  if (report) {
    for (const r of report.rows) booksByKey.set(r.vendorKey, { ytd: r.ytdTotal, w9: r.w9OnFile, over: r.eligible1099 });
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="field" />
      <section className="max-w-[900px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <Link href="/operations/packets" style={{ fontSize: 12, color: 'var(--ink-4)', textDecoration: 'none' }}>← Field packets</Link>
        <div className="font-serif" style={{ fontSize: 26, fontWeight: 400, marginTop: 12 }}>Contractors</div>
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
            {contractors.map((c) => (
              <div key={c.id} style={{ borderBottom: '1px solid var(--rule)', padding: '14px 0', display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div className="font-serif" style={{ fontSize: 16 }}>
                    {c.full_name}
                    {c.trade && c.trade !== 'inspection' && (
                      <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--tide-deep)', border: '1px solid var(--rule)', borderRadius: 999, padding: '1px 7px', marginLeft: 8, verticalAlign: 'middle' }}>
                        {c.trade}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>{c.email}{c.phone ? ` · ${c.phone}` : ''}</div>
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
                        <form action={markContractorPaid} style={{ marginTop: 3 }}>
                          <input type="hidden" name="contractor_id" value={c.id} />
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
                    </div>
                  );
                })()}
                <div style={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'var(--font-mono-dash), monospace', wordBreak: 'break-all', maxWidth: 240 }}>
                  {base}/field/{c.portal_token}
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
