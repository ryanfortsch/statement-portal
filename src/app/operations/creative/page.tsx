import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { isFieldConfigured } from '@/lib/field-db';
import { loadShootBoard, loadCreativeContractors, type ShootSummary } from '@/lib/creative-shoots';
import { loadFieldProperties } from '@/lib/field-packets';
import { dollars } from '@/lib/field-types';
import { createShoot } from './actions';
import { PendingButton } from '@/app/field/packet/[packetId]/PendingButton';

export const dynamic = 'force-dynamic';

function fmtDate(d: string): string {
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return d;
  }
}
function fmtSettles(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/** One money line per shoot, matching the packet ledger's estimate→final voice
 *  but across creative's three states (floor → range → locked) plus paid. */
function payLine(s: ShootSummary): { text: string; tone: string; sub: string | null } {
  const shoot = s.shoot;
  const bonus = shoot.bonus_cents || 0;
  if (shoot.paid_at) {
    return { text: `Paid ${dollars((shoot.final_payout_cents ?? 0) + bonus)}`, tone: 'var(--positive)', sub: null };
  }
  if (shoot.final_payout_cents != null) {
    return { text: `${dollars(shoot.final_payout_cents + bonus)} owed`, tone: 'var(--signal)', sub: 'final · ready to pay' };
  }
  // Not finalized: show the live computed state.
  if (s.pay.state === 'empty') {
    return { text: 'No posts yet', tone: 'var(--ink-4)', sub: shoot.status === 'approved' ? 'approved · awaiting posts' : null };
  }
  if (s.pay.state === 'locked') {
    return {
      text: dollars(s.pay.totalCents + bonus),
      tone: 'var(--ink)',
      sub: shoot.status === 'approved' ? 'views in · finalize to pay' : 'views in · ready to approve',
    };
  }
  // counting
  return {
    text: `${dollars(s.pay.floorCents + bonus)}–${dollars(s.pay.ceilingCents + bonus)}`,
    tone: 'var(--ink-3)',
    sub: s.pay.settlesOn ? `settles ${fmtSettles(s.pay.settlesOn)}` : 'counting views',
  };
}

export default async function CreativeBoard() {
  if (!isFieldConfigured) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <HelmMasthead current="work" />
        <section className="max-w-[900px] mx-auto px-10" style={{ width: '100%', paddingTop: 40 }}>
          <p style={{ color: 'var(--ink-3)' }}>Field isn&apos;t configured in this environment.</p>
        </section>
        <HelmFooter module="Field" right="Creative" />
      </div>
    );
  }

  const [board, contributors, properties] = await Promise.all([
    loadShootBoard(),
    loadCreativeContractors(),
    loadFieldProperties(),
  ]);

  const attention = board.filter((s) => s.pay.needsAttention);
  const owed = board.filter((s) => !s.pay.needsAttention && s.shoot.final_payout_cents != null && !s.shoot.paid_at);
  const live = board.filter(
    (s) => !s.pay.needsAttention && s.shoot.final_payout_cents == null && s.shoot.status !== 'settled',
  );
  const done = board.filter((s) => !s.pay.needsAttention && s.shoot.paid_at);

  const owedTotal = owed.reduce((sum, s) => sum + (s.shoot.final_payout_cents ?? 0) + (s.shoot.bonus_cents || 0), 0);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="work" />
      <section className="max-w-[900px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, borderBottom: '1px solid var(--ink)', paddingBottom: 16, flexWrap: 'wrap' }}>
          <div>
            <div className="font-serif" style={{ fontSize: 26, fontWeight: 400 }}>Creative</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>
              Social shoots and the pay that follows the views. {board.length} {board.length === 1 ? 'shoot' : 'shoots'}.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 18, alignItems: 'baseline' }}>
            {owedTotal > 0 && (
              <div style={{ textAlign: 'right' }}>
                <div className="font-mono" style={{ fontSize: 22, color: 'var(--signal)' }}>{dollars(owedTotal)}</div>
                <div style={{ fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>owed now</div>
              </div>
            )}
            <Link href="/operations/contractors" style={{ fontSize: 12, color: 'var(--ink-4)', textDecoration: 'none' }}>Roster →</Link>
          </div>
        </div>

        {/* Log a shoot — the office records what was shot; views come later. */}
        <details style={{ marginTop: 18 }}>
          <summary style={{ ...quietSummary, fontSize: 13, color: 'var(--tide-deep)', fontWeight: 600 }}>+ Log a shoot ▾</summary>
          <form action={createShoot} style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxWidth: 620, border: '1px solid var(--rule)', borderRadius: 10, padding: 16, background: 'var(--paper-2, #fff)' }}>
            <label style={fieldLabel}>
              Contributor
              <select name="contractor_id" required defaultValue="" style={input}>
                <option value="" disabled>Choose…</option>
                {contributors.map((c) => (
                  <option key={c.id} value={c.id}>{c.full_name}</option>
                ))}
              </select>
            </label>
            <label style={fieldLabel}>
              Shoot date
              <input type="date" name="shoot_date" required style={input} />
            </label>
            <label style={{ ...fieldLabel, gridColumn: '1 / -1' }}>
              Title
              <input name="title" required maxLength={200} placeholder="e.g. Rocky Neck summer reel day" style={input} />
            </label>
            <label style={fieldLabel}>
              Property <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(optional)</span>
              <select name="property_id" defaultValue="" style={input}>
                <option value="">None / b-roll</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label style={fieldLabel}>
              Location note <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(optional)</span>
              <input name="location_note" maxLength={300} placeholder="e.g. downtown Gloucester" style={input} />
            </label>
            <label style={{ ...fieldLabel, gridColumn: '1 / -1' }}>
              Notes <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}>(optional)</span>
              <textarea name="notes" maxLength={4000} rows={2} placeholder="Brief, deliverables agreed, anything to remember" style={{ ...input, resize: 'vertical' }} />
            </label>
            <div style={{ gridColumn: '1 / -1' }}>
              {contributors.length === 0 ? (
                <div style={{ fontSize: 12.5, color: 'var(--signal)' }}>
                  No active contributors yet. <Link href="/operations/contractors" style={{ color: 'var(--signal)' }}>Invite one from the roster</Link> first.
                </div>
              ) : (
                <PendingButton label="Log shoot" busyLabel="Logging…" style={btnDark} />
              )}
            </div>
          </form>
        </details>

        {board.length === 0 ? (
          <div style={{ marginTop: 40, textAlign: 'center', color: 'var(--ink-4)', fontSize: 14 }}>
            No shoots yet. Log one above once a contributor has filmed.
          </div>
        ) : (
          <>
            <ShootGroup title="Needs attention" hint="Views overdue to read, or nothing posted yet" shoots={attention} accent />
            <ShootGroup title="Ready to pay" hint="Payout locked, awaiting send" shoots={owed} />
            <ShootGroup title="In flight" hint="Shot, posted, or counting views" shoots={live} />
            <ShootGroup title="Paid" hint="Settled" shoots={done} muted />
          </>
        )}
      </section>
      <HelmFooter module="Field" right="Creative" />
    </div>
  );
}

function ShootGroup({ title, hint, shoots, accent, muted }: { title: string; hint: string; shoots: ShootSummary[]; accent?: boolean; muted?: boolean }) {
  if (shoots.length === 0) return null;
  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: accent ? 'var(--signal)' : 'var(--ink-4)', fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>{hint}</span>
      </div>
      <div style={{ border: '1px solid var(--rule)', borderRadius: 10, overflow: 'hidden', background: 'var(--paper-2, #fff)', opacity: muted ? 0.72 : 1 }}>
        {shoots.map((s, i) => {
          const pay = payLine(s);
          const assetLine = s.assets.length
            ? `${s.assets.filter((a) => a.kind === 'reel').length} reel${s.assets.filter((a) => a.kind === 'reel').length === 1 ? '' : 's'}${s.assets.some((a) => a.kind === 'carousel') ? ` · ${s.assets.filter((a) => a.kind === 'carousel').length} carousel` : ''}`
            : 'no posts yet';
          return (
            <Link
              key={s.shoot.id}
              href={`/operations/creative/${s.shoot.id}`}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '13px 16px', borderTop: i ? '1px solid var(--rule)' : 'none', textDecoration: 'none', color: 'var(--ink)', alignItems: 'center' }}
            >
              <div style={{ minWidth: 0 }}>
                <div className="font-serif" style={{ fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.shoot.title}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 2 }}>
                  {s.contractorName} · {fmtDate(s.shoot.shoot_date)}{s.propertyName ? ` · ${s.propertyName}` : ''} · {assetLine}
                </div>
              </div>
              <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <div className="font-mono" style={{ fontSize: 15, color: pay.tone }}>{pay.text}</div>
                {pay.sub && <div style={{ fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', marginTop: 2 }}>{pay.sub}</div>}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

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
const quietCtl: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--ink-4)',
  fontSize: 12,
  textDecoration: 'underline',
  textUnderlineOffset: 3,
  padding: 0,
};
const quietSummary: React.CSSProperties = { ...quietCtl, display: 'flex', listStyle: 'none', userSelect: 'none' };
const fieldLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--ink-3)' };
const input: React.CSSProperties = {
  font: 'inherit',
  fontSize: 14,
  fontWeight: 400,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  padding: '7px 9px',
  borderRadius: 6,
};
