import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { fieldDb, isFieldConfigured } from '@/lib/field-db';
import { loadPackets } from '@/lib/field-packets';
import { dollars, type ContractorRow, type PacketRow } from '@/lib/field-types';
import { runSuggest, publishPacket, setPacketPrice, cancelPacket } from './actions';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Suggested',
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

export default async function PacketsBoard() {
  if (!isFieldConfigured) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <HelmMasthead current="operations" />
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56 }}>
          <div className="eyebrow">Field packets</div>
          <p style={{ marginTop: 14, color: 'var(--ink-3)' }}>
            Set SUPABASE_SERVICE_ROLE_KEY to enable the Field module.
          </p>
        </section>
      </div>
    );
  }

  const packets = await loadPackets();
  const { data: cData } = await fieldDb().from('contractors').select('id, full_name');
  const contractorName = new Map(
    ((cData ?? []) as Pick<ContractorRow, 'id' | 'full_name'>[]).map((c) => [c.id, c.full_name]),
  );

  const byStatus = (s: string) => packets.filter((p) => p.status === s);
  const drafts = byStatus('draft');
  const live = packets.filter((p) => ['published', 'claimed', 'in_progress'].includes(p.status));
  const review = byStatus('submitted');
  const done = packets.filter((p) => ['approved', 'cancelled'].includes(p.status));

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="operations" />
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 40 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', borderBottom: '1px solid var(--ink)', paddingBottom: 16 }}>
          <div>
            <div className="font-serif" style={{ fontSize: 26, fontWeight: 400 }}>Field packets</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>
              Group nearby inspections into priced packets and publish them to contractors.{' '}
              <Link href="/operations/contractors" style={{ color: 'var(--tide-deep)' }}>Manage contractors →</Link>
            </div>
          </div>
          <form action={runSuggest} style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <label style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              From
              <input type="date" name="window_start" defaultValue={todayStr()} style={inDate} />
            </label>
            <label style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              To
              <input type="date" name="window_end" defaultValue={plusDays(14)} style={inDate} />
            </label>
            <button type="submit" style={btnDark}>Suggest packets</button>
          </form>
        </div>

        {packets.length === 0 && (
          <p style={{ marginTop: 32, color: 'var(--ink-3)', fontSize: 14 }}>
            No packets yet. Pick a window and hit <strong>Suggest packets</strong> to group upcoming inspections.
          </p>
        )}

        {drafts.length > 0 && (
          <Group title={`Suggested · ${drafts.length}`}>
            {drafts.map((p) => (
              <DraftRow key={p.id} p={p} />
            ))}
          </Group>
        )}

        {live.length > 0 && (
          <Group title={`Live · ${live.length}`}>
            {live.map((p) => (
              <LiveRow key={p.id} p={p} who={p.awarded_contractor_id ? contractorName.get(p.awarded_contractor_id) ?? null : null} />
            ))}
          </Group>
        )}

        {review.length > 0 && (
          <Group title={`Needs review · ${review.length}`}>
            {review.map((p) => (
              <LiveRow key={p.id} p={p} who={p.awarded_contractor_id ? contractorName.get(p.awarded_contractor_id) ?? null : null} />
            ))}
          </Group>
        )}

        {done.length > 0 && (
          <Group title={`Closed · ${done.length}`}>
            {done.map((p) => (
              <LiveRow key={p.id} p={p} who={p.awarded_contractor_id ? contractorName.get(p.awarded_contractor_id) ?? null : null} dim />
            ))}
          </Group>
        )}
      </section>
      <HelmFooter module="Field" right="Inspection packets" />
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 32 }}>
      <h2 style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 6 }}>
        {title}
      </h2>
      <div style={{ borderTop: '1px solid var(--rule)' }}>{children}</div>
    </div>
  );
}

function Meta({ p }: { p: PacketRow }) {
  return (
    <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 3 }}>
      {fmtDate(p.visit_date)} · {p.stop_count} {p.stop_count === 1 ? 'stop' : 'stops'}
      {p.max_pairwise_miles != null ? ` · ${p.max_pairwise_miles < 1 ? '<1' : Math.round(p.max_pairwise_miles)} mi spread` : ''}
    </div>
  );
}

function DraftRow({ p }: { p: PacketRow }) {
  return (
    <div style={{ borderBottom: '1px solid var(--rule)', padding: '14px 0', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <Link href={`/operations/packets/${p.id}`} className="font-serif" style={{ fontSize: 17, color: 'var(--ink)', textDecoration: 'none' }}>
          {p.title}
        </Link>
        <Meta p={p} />
      </div>
      <form action={setPacketPrice} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="hidden" name="packet_id" value={p.id} />
        <span style={{ color: 'var(--ink-4)' }}>$</span>
        <input type="number" name="price_dollars" min={0} step={5} defaultValue={Math.round(p.posted_price_cents / 100)} style={{ ...inDate, width: 80 }} />
        <button type="submit" style={btnGhost}>Save</button>
      </form>
      <form action={publishPacket}>
        <input type="hidden" name="packet_id" value={p.id} />
        <button type="submit" style={btnDark}>Publish</button>
      </form>
      <form action={cancelPacket}>
        <input type="hidden" name="packet_id" value={p.id} />
        <button type="submit" style={btnGhost}>Dismiss</button>
      </form>
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
        <Meta p={p} />
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--signal)' }}>{STATUS_LABEL[p.status] ?? p.status}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
          {dollars(p.posted_price_cents)}{who ? ` · ${who}` : ''}
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
const btnDark: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: 'none',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  padding: '9px 16px',
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
