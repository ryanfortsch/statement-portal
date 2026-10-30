import Link from 'next/link';
import { fieldDb } from '@/lib/field-db';

type Packet = { id: string; title: string; visit_date: string | null; status: string };
type OneOrMany<T> = T | T[] | null;
const one = <T,>(value: OneOrMany<T>): T | null => Array.isArray(value) ? value[0] ?? null : value;

/** Both a dedicated stop and a bundled attachment count as planned work.
 * A draft is visibly only a proposal, not evidence that a worker accepted. */
export async function WorkVisitLinks({ slipId, scheduledDate }: { slipId: string; scheduledDate: string | null }) {
  try {
    const db = fieldDb();
    const [direct, attached] = await Promise.all([
      db.from('packet_stops').select('inspection_packets!inner(id, title, visit_date, status)').eq('work_slip_id', slipId),
      db.from('packet_stop_work_slips').select('packet_stops!inner(inspection_packets!inner(id, title, visit_date, status))').eq('work_slip_id', slipId),
    ]);
    if (direct.error || attached.error) throw new Error('Visit lookup failed');
    const packets = new Map<string, Packet>();
    const collect = (packet: Packet | null) => {
      if (packet && ['draft', 'published', 'claimed', 'in_progress', 'submitted', 'approved'].includes(packet.status)) packets.set(packet.id, packet);
    };
    for (const row of direct.data as unknown as { inspection_packets: OneOrMany<Packet> }[]) collect(one(row.inspection_packets));
    for (const row of attached.data as unknown as { packet_stops: OneOrMany<{ inspection_packets: OneOrMany<Packet> }> }[]) collect(one(one(row.packet_stops)?.inspection_packets ?? null));
    return <div style={{ paddingTop: 12, fontSize: 13, lineHeight: 1.6 }}>
      {scheduledDate && <div>Scheduled work: {scheduledDate}</div>}
      {packets.size ? [...packets.values()].map(p => <div key={p.id}>
        {p.status === 'draft' ? 'Proposed Field job' : 'On Field job'}: <Link href={`/fieldwork/packets/${p.id}`}>{p.title}</Link>
        {p.visit_date ? ` · ${p.visit_date}` : ''} · {p.status.replaceAll('_', ' ')}
      </div>) : <span style={{ color: 'var(--ink-3)' }}>No active Field job linked.</span>}
    </div>;
  } catch {
    return <p role="status" style={{ fontSize: 13, color: 'var(--ink-3)' }}>Field job links could not be checked. <Link href="/fieldwork/packets">View Field jobs</Link></p>;
  }
}
