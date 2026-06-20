import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { fieldDb, isFieldConfigured } from '@/lib/field-db';
import { loadInspectionWorkItems, loadPackets } from '@/lib/field-packets';
import { dollars, type ContractorRow, type PacketRow } from '@/lib/field-types';
import { PacketBuilder } from './PacketBuilder';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  published: 'Open for claim',
  claimed: 'Claimed',
  in_progress: 'In progress',
  submitted: 'Needs review',
  approved: 'Approved',
  cancelled: 'Cancelled',
};

function fmtDate(d: string): string {
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return d;
  }
}
function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}
function plusDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

export default async function PacketsBoard({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  if (!isFieldConfigured) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <HelmMasthead current="operations" />
        <section className="max-w-[1000px] mx-auto px-10" style={{ paddingTop: 56 }}>
          <div className="eyebrow">Field packets</div>
          <p style={{ marginTop: 14, color: 'var(--ink-3)' }}>Set SUPABASE_SERVICE_ROLE_KEY to enable the Field module.</p>
        </section>
      </div>
    );
  }

  const sp = await searchParams;
  const from = sp.from || todayStr();
  const to = sp.to || plusDays(14);

  const [workDays, packets, { data: cData }] = await Promise.all([
    loadInspectionWorkItems(from, to),
    loadPackets(),
    fieldDb().from('contractors').select('id, full_name'),
  ]);
  const contractorName = new Map(
    ((cData ?? []) as Pick<ContractorRow, 'id' | 'full_name'>[]).map((c) => [c.id, c.full_name]),
  );

  const live = packets.filter((p) => ['published', 'claimed', 'in_progress', 'submitted'].includes(p.status));
  const closed = packets.filter((p) => ['approved', 'cancelled'].includes(p.status));

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="operations" />
      <section className="max-w-[1000px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', borderBottom: '1px solid var(--ink)', paddingBottom: 16 }}>
          <div>
            <div className="font-serif" style={{ fontSize: 26, fontWeight: 400 }}>Field packets</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>
              The inspections coming up. Check the nearby ones, bundle them, send them out.{' '}
              <Link href="/operations/contractors" style={{ color: 'var(--tide-deep)' }}>Manage contractors →</Link>
            </div>
          </div>
          <form method="get" style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <label style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              From
              <input type="date" name="from" defaultValue={from} style={inDate} />
            </label>
            <label style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              To
              <input type="date" name="to" defaultValue={to} style={inDate} />
            </label>
            <button type="submit" style={btnGhost}>Apply</button>
          </form>
        </div>

        <div style={{ marginTop: 28 }}>
          <PacketBuilder days={workDays} />
        </div>

        {live.length > 0 && (
          <div style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 8 }}>
              Out to contractors · {live.length}
            </h2>
            <div style={{ borderTop: '1px solid var(--rule)' }}>
              {live.map((p) => (
                <LiveRow key={p.id} p={p} who={p.awarded_contractor_id ? contractorName.get(p.awarded_contractor_id) ?? null : null} />
              ))}
            </div>
          </div>
        )}

        {closed.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <h2 style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 8 }}>
              Closed · {closed.length}
            </h2>
            <div style={{ borderTop: '1px solid var(--rule)' }}>
              {closed.map((p) => (
                <LiveRow key={p.id} p={p} who={p.awarded_contractor_id ? contractorName.get(p.awarded_contractor_id) ?? null : null} dim />
              ))}
            </div>
          </div>
        )}
      </section>
      <HelmFooter module="Field" right="Inspection packets" />
    </div>
  );
}

function LiveRow({ p, who, dim }: { p: PacketRow; who: string | null; dim?: boolean }) {
  return (
    <Link
      href={`/operations/packets/${p.id}`}
      style={{ borderBottom: '1px solid var(--rule)', padding: '14px 0', display: 'flex', alignItems: 'center', gap: 16, textDecoration: 'none', color: 'var(--ink)', opacity: dim ? 0.6 : 1 }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <span className="font-serif" style={{ fontSize: 17 }}>{p.title}</span>
        <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 3 }}>
          {fmtDate(p.visit_date)} · {p.stop_count} {p.stop_count === 1 ? 'stop' : 'stops'}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: p.status === 'approved' ? 'var(--positive)' : 'var(--signal)' }}>
          {STATUS_LABEL[p.status] ?? p.status}
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
          {dollars(p.posted_price_cents)}
          {who ? ` · ${who}` : ''}
          {p.status === 'approved' && p.paid_at ? ' · paid' : ''}
        </div>
      </div>
    </Link>
  );
}

const inDate: React.CSSProperties = {
  display: 'block',
  marginTop: 4,
  font: 'inherit',
  fontSize: 13,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  padding: '6px 8px',
};
const btnGhost: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  border: '1px solid var(--rule)',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  padding: '8px 14px',
};
