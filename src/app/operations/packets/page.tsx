import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { FieldTabs } from '@/components/FieldTabs';
import { HelmFooter } from '@/components/HelmFooter';
import { fieldDb, isFieldConfigured } from '@/lib/field-db';
import { loadInspectionCalendar, loadPackets } from '@/lib/field-packets';
import { dollars, type ContractorRow, type PacketRow } from '@/lib/field-types';
import { FieldAvatar } from '@/components/FieldAvatar';

type Who = { name: string; photoUrl: string | null } | null;
import { InspectionCalendar } from './InspectionCalendar';
import { approvePacket, markPacketPaid, releasePacket, publishPacket, cancelPacket } from './actions';

export const dynamic = 'force-dynamic';

function todayET(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}
function daysUntilET(d: string): number {
  return Math.round((Date.parse(`${d}T00:00:00`) - Date.parse(`${todayET()}T00:00:00`)) / 86_400_000);
}

function statusChip(status: string): { label: string; bg: string; color: string } {
  switch (status) {
    case 'published':
      return { label: 'Open · unclaimed', bg: 'rgba(186,117,23,0.14)', color: '#7a5512' };
    case 'claimed':
      return { label: 'Claimed', bg: 'rgba(58,107,138,0.16)', color: 'var(--tide-deep)' };
    case 'in_progress':
      return { label: 'In progress', bg: 'rgba(58,107,138,0.16)', color: 'var(--tide-deep)' };
    case 'submitted':
      return { label: 'Needs review', bg: 'rgba(200,90,58,0.14)', color: 'var(--signal)' };
    case 'approved':
      return { label: 'Approved', bg: 'rgba(63,153,34,0.16)', color: 'var(--positive)' };
    case 'cancelled':
      return { label: 'Cancelled', bg: 'rgba(30,46,52,0.06)', color: 'var(--ink-4)' };
    default:
      return { label: status, bg: 'rgba(30,46,52,0.06)', color: 'var(--ink-4)' };
  }
}

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
  searchParams: Promise<{ from?: string; to?: string; sent?: string }>;
}) {
  if (!isFieldConfigured) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <HelmMasthead current="field" />
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

  const [calendar, packets, { data: cData }] = await Promise.all([
    loadInspectionCalendar(from, to),
    loadPackets(),
    fieldDb().from('contractors').select('id, full_name, photo_url'),
  ]);
  const contractorInfo = new Map(
    ((cData ?? []) as Pick<ContractorRow, 'id' | 'full_name' | 'photo_url'>[]).map((c) => [c.id, c]),
  );
  const whoOf = (id: string | null): Who => {
    const c = id ? contractorInfo.get(id) : null;
    return c ? { name: c.full_name, photoUrl: c.photo_url } : null;
  };

  const live = packets.filter((p) => ['published', 'claimed', 'in_progress', 'submitted'].includes(p.status));
  const closed = packets.filter((p) => ['approved', 'cancelled'].includes(p.status));
  // Auto-drafted routine checks for idle homes (and any hand-saved drafts),
  // soonest first — waiting for the operator to publish or dismiss.
  const drafts = packets
    .filter((p) => p.status === 'draft')
    .sort((a, b) => a.visit_date.localeCompare(b.visit_date));

  const today = todayET();
  const outToday = packets.filter((p) => p.visit_date === today && (p.status === 'claimed' || p.status === 'in_progress'));
  const startedToday = outToday.filter((p) => p.status === 'in_progress').length;
  const awaitingApproval = packets.filter((p) => p.status === 'submitted');
  const unclaimedSoon = packets.filter((p) => p.status === 'published' && daysUntilET(p.visit_date) >= 0 && daysUntilET(p.visit_date) <= 2);
  // At risk: claimed but never started, and the visit day has arrived/passed —
  // the contractor may no-show before the guest arrives.
  const atRiskPackets = packets.filter((p) => p.status === 'claimed' && daysUntilET(p.visit_date) <= 0);
  const hasBrief = outToday.length > 0 || awaitingApproval.length > 0 || unclaimedSoon.length > 0 || atRiskPackets.length > 0;

  // Live per-packet progress (done stops) for claimed/in-progress packets, so
  // the office can watch a visit move stop-by-stop on the board.
  const trackIds = packets.filter((p) => p.status === 'claimed' || p.status === 'in_progress').map((p) => p.id);
  const progress = new Map<string, number>();
  if (trackIds.length) {
    const { data: ps } = await fieldDb().from('packet_stops').select('packet_id, status').in('packet_id', trackIds);
    for (const r of (ps ?? []) as { packet_id: string; status: string }[]) {
      if (r.status === 'complete' || r.status === 'skipped') progress.set(r.packet_id, (progress.get(r.packet_id) ?? 0) + 1);
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="field" />
      <FieldTabs current="packets" />
      <section className="max-w-[1000px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', borderBottom: '1px solid var(--ink)', paddingBottom: 16 }}>
          <div>
            <div className="font-serif" style={{ fontSize: 26, fontWeight: 400 }}>Field packets</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>
              Each property&apos;s open days. Pick a day where nearby ones overlap, then bundle and send.{' '}
              <Link href="/operations/packets/maintenance" style={{ color: 'var(--tide-deep)' }}>Maintenance jobs →</Link>
              {' · '}
              <Link href="/operations/contractors" style={{ color: 'var(--tide-deep)' }}>Manage contractors →</Link>
              {' · '}
              <Link href="/operations/packets/test" style={{ color: 'var(--tide-deep)' }}>Test console →</Link>
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

        {sp.sent === '1' && (
          <div style={{ marginTop: 18, border: '1px solid var(--positive)', background: 'rgba(63,153,34,0.08)', color: 'var(--positive)', padding: '10px 14px', borderRadius: 8, fontSize: 13 }}>
            Packet sent — it&apos;s out to contractors below.
          </div>
        )}
        {sp.sent === '0' && (
          <div style={{ marginTop: 18, border: '1px solid var(--signal)', background: 'rgba(200,90,58,0.06)', color: 'var(--signal)', padding: '10px 14px', borderRadius: 8, fontSize: 13 }}>
            Couldn&apos;t bundle that — those days are already covered or a guest has since moved in. Refresh and pick open days again.
          </div>
        )}

        {hasBrief && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 22 }}>
            {atRiskPackets.length > 0 && (
              <TodayStat n={atRiskPackets.length} label="at risk · not started" tone="#c0392b" />
            )}
            {outToday.length > 0 && (
              <TodayStat n={outToday.length} label="out today" sub={`${startedToday} started`} tone="var(--tide-deep)" />
            )}
            {awaitingApproval.length > 0 && (
              <TodayStat n={awaitingApproval.length} label="awaiting your approval" tone="var(--signal)" />
            )}
            {unclaimedSoon.length > 0 && (
              <TodayStat n={unclaimedSoon.length} label="unclaimed within 48h" tone="#7a5512" />
            )}
          </div>
        )}

        <div style={{ marginTop: 28 }}>
          <InspectionCalendar days={calendar.days} rows={calendar.rows} />
          {calendar.missingCoords > 0 && (
            <div style={{ fontSize: 12, color: 'var(--signal)', marginTop: 8 }}>
              {calendar.missingCoords} {calendar.missingCoords === 1 ? 'property is' : 'properties are'} hidden here — no map
              coordinates on file, so they can&apos;t be bundled. Add lat/long on the property to include them.
            </div>
          )}
        </div>

        {drafts.length > 0 && (
          <div style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 4 }}>
              Suggested · {drafts.length}
            </h2>
            <div style={{ fontSize: 12, color: 'var(--ink-4)', marginBottom: 8 }}>
              Routine checks for idle homes. Publish to send to inspectors, or dismiss.
            </div>
            <div style={{ border: '1px dashed var(--rule)', borderRadius: 10, overflow: 'hidden', background: 'var(--paper-2, #fff)' }}>
              {drafts.map((p) => (
                <DraftRow key={p.id} p={p} />
              ))}
            </div>
          </div>
        )}

        {live.length > 0 && (
          <div style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 8 }}>
              Out to contractors · {live.length}
            </h2>
            <div style={{ border: '1px solid var(--rule)', borderRadius: 10, overflow: 'hidden', background: 'var(--paper-2, #fff)' }}>
              {live.map((p) => (
                <LiveRow
                  key={p.id}
                  p={p}
                  who={whoOf(p.awarded_contractor_id)}
                  done={progress.get(p.id) ?? 0}
                />
              ))}
            </div>
          </div>
        )}

        {closed.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <h2 style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 8 }}>
              Closed · {closed.length}
            </h2>
            <div style={{ border: '1px solid var(--rule)', borderRadius: 10, overflow: 'hidden', background: 'var(--paper-2, #fff)' }}>
              {closed.slice(0, 25).map((p) => (
                <LiveRow key={p.id} p={p} who={whoOf(p.awarded_contractor_id)} dim />
              ))}
            </div>
            {closed.length > 25 && (
              <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 6 }}>Showing the 25 most recent of {closed.length}.</div>
            )}
          </div>
        )}
      </section>
      <HelmFooter module="Field" right="Inspection packets" />
    </div>
  );
}

function TodayStat({ n, label, sub, tone }: { n: number; label: string; sub?: string; tone: string }) {
  return (
    <div style={{ border: '1px solid var(--rule)', borderLeft: `3px solid ${tone}`, borderRadius: 8, padding: '10px 16px', minWidth: 130, background: 'var(--paper-2, #fff)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="font-mono" style={{ fontSize: 22, color: 'var(--ink)' }}>{n}</span>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{label}</span>
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function DraftRow({ p }: { p: PacketRow }) {
  return (
    <div style={{ borderBottom: '1px solid var(--rule)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <Link href={`/operations/packets/${p.id}`} style={{ flex: 1, minWidth: 200, textDecoration: 'none', color: 'var(--ink)' }}>
        <span className="font-serif" style={{ fontSize: 17 }}>{p.title}</span>
        <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 3 }}>
          {fmtDate(p.visit_date)} · {p.stop_count} {p.stop_count === 1 ? 'stop' : 'stops'} · {dollars(p.posted_price_cents)}
        </div>
      </Link>
      <form action={publishPacket} style={{ margin: 0 }}>
        <input type="hidden" name="packet_id" value={p.id} />
        <button type="submit" style={btnDark}>Publish</button>
      </form>
      <form action={cancelPacket} style={{ margin: 0 }}>
        <input type="hidden" name="packet_id" value={p.id} />
        <button type="submit" style={btnGhost} title="Dismiss this suggestion">Dismiss</button>
      </form>
    </div>
  );
}

function LiveRow({ p, who, dim, done = 0 }: { p: PacketRow; who: Who; dim?: boolean; done?: number }) {
  const c = statusChip(p.status);
  const atRisk = p.status === 'claimed' && daysUntilET(p.visit_date) <= 0;
  const tracking = p.status === 'claimed' || p.status === 'in_progress';
  return (
    <div
      style={{ borderBottom: '1px solid var(--rule)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, opacity: dim ? 0.6 : 1, flexWrap: 'wrap' }}
    >
      <Link href={`/operations/packets/${p.id}`} style={{ flex: 1, minWidth: 200, textDecoration: 'none', color: 'var(--ink)' }}>
        <span className="font-serif" style={{ fontSize: 17 }}>{p.title}</span>
        {p.trade !== 'inspection' && (
          <span style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--tide-deep)', border: '1px solid var(--rule)', borderRadius: 999, padding: '1px 6px', marginLeft: 8, verticalAlign: 'middle' }}>
            {p.trade}
          </span>
        )}
        <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 3 }}>
          {fmtDate(p.visit_date)} · {p.stop_count} {p.stop_count === 1 ? 'stop' : 'stops'}
          {tracking && p.stop_count > 0 ? ` · ${done}/${p.stop_count} done` : ''}
        </div>
      </Link>
      <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
        {atRisk ? (
          <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, padding: '3px 9px', borderRadius: 6, background: 'rgba(192,57,43,0.14)', color: '#c0392b', whiteSpace: 'nowrap' }}>
            At risk · not started
          </span>
        ) : (
          <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, padding: '3px 9px', borderRadius: 6, background: c.bg, color: c.color, whiteSpace: 'nowrap' }}>
            {c.label}
          </span>
        )}
        <div style={{ fontSize: 12, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <span>{dollars(p.posted_price_cents)}</span>
          {who && (
            <>
              <span>·</span>
              <FieldAvatar name={who.name} url={who.photoUrl} size={18} />
              <span>{who.name}</span>
            </>
          )}
          {p.status === 'approved' && p.paid_at ? <span>· paid</span> : null}
        </div>
      </div>
      {p.status === 'claimed' && (
        <form action={releasePacket} style={{ margin: 0 }}>
          <input type="hidden" name="packet_id" value={p.id} />
          <button type="submit" style={btnGhost} title="Release back to the open marketplace and re-notify inspectors">Release</button>
        </form>
      )}
      {p.status === 'submitted' && (
        <form action={approvePacket} style={{ margin: 0 }}>
          <input type="hidden" name="packet_id" value={p.id} />
          <button type="submit" style={btnDark}>Approve</button>
        </form>
      )}
      {p.status === 'approved' && !p.paid_at && (
        <form action={markPacketPaid} style={{ margin: 0 }}>
          <input type="hidden" name="packet_id" value={p.id} />
          <button type="submit" style={btnGhost}>Mark paid</button>
        </form>
      )}
    </div>
  );
}

const btnDark: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  padding: '8px 14px',
};

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
