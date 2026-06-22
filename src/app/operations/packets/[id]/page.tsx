import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { fieldDb } from '@/lib/field-db';
import { loadPacketDetail, loadPacketReview } from '@/lib/field-packets';
import { dollars, type PacketStopDetail } from '@/lib/field-types';
import { publishPacket, unpublishPacket, cancelPacket, setPacketPrice, approvePacket, markPacketPaid, releasePacket, requestChanges, removeStop } from '../actions';

export const dynamic = 'force-dynamic';

function fmtDate(d: string): string {
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  } catch {
    return d;
  }
}
function windowLabel(s: PacketStopDetail): string {
  if (s.window_basis === 'checkout_day') return `after ${s.prior_checkout ?? 'morning'} checkout`;
  if (s.window_basis === 'pre_checkin') return `before ${s.next_checkin ?? ''} check-in`;
  return 'vacant all day';
}

export default async function PacketDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const packet = await loadPacketDetail(id, { revealAccess: true });
  if (!packet) notFound();

  const review =
    packet.status === 'submitted' || packet.status === 'approved' ? await loadPacketReview(id) : [];

  const { data: evData } = await fieldDb()
    .from('packet_events')
    .select('event_type, actor_email, created_at')
    .eq('packet_id', id)
    .order('created_at', { ascending: false })
    .limit(8);
  const events = (evData ?? []) as { event_type: string; actor_email: string | null; created_at: string }[];

  const editable = packet.status === 'draft';
  const isLive = ['published', 'claimed', 'in_progress', 'submitted'].includes(packet.status);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="field" />
      <section className="max-w-[900px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <Link href="/operations/packets" style={{ fontSize: 12, color: 'var(--ink-4)', textDecoration: 'none' }}>← All packets</Link>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginTop: 12, borderBottom: '1px solid var(--ink)', paddingBottom: 16, flexWrap: 'wrap' }}>
          <div>
            <div className="font-serif" style={{ fontSize: 26, fontWeight: 400 }}>{packet.title}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>
              {fmtDate(packet.visit_date)} · {packet.stop_count} stops
              {packet.contractor ? ` · ${packet.contractor.full_name}` : ''}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--signal)' }}>{packet.status}</div>
            <div className="font-mono" style={{ fontSize: 24, marginTop: 4 }}>{dollars(packet.posted_price_cents)}</div>
          </div>
        </div>

        {review.length > 0 && (
          <div style={{ marginTop: 20, border: '1px solid var(--rule)', borderRadius: 10, padding: '14px 18px', background: 'var(--paper-2, #fff)' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 10 }}>
              Review before approving
            </div>
            {review.map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: i ? '1px solid var(--rule)' : 'none', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 160 }}>
                  <div className="font-serif" style={{ fontSize: 15 }}>{r.propertyName}</div>
                  {r.issues.length > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--signal)', marginTop: 2 }}>{r.issues.join(', ')}</div>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                  <span style={{ color: 'var(--positive)' }}>{r.pass} pass</span>
                  {r.issue > 0 && <span style={{ color: 'var(--signal)' }}> · {r.issue} issue</span>}
                  {r.na > 0 && <span> · {r.na} n/a</span>}
                  {' · '}
                  {r.photos} {r.photos === 1 ? 'photo' : 'photos'}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Price + lifecycle controls */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 18 }}>
          {editable && (
            <>
              <form action={setPacketPrice} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="hidden" name="packet_id" value={packet.id} />
                <span style={{ color: 'var(--ink-4)' }}>$</span>
                <input type="number" name="price_dollars" min={0} step={5} defaultValue={Math.round(packet.posted_price_cents / 100)} style={priceInput} />
                <button type="submit" style={btnGhost}>Update price</button>
              </form>
              <form action={publishPacket}>
                <input type="hidden" name="packet_id" value={packet.id} />
                <button type="submit" style={btnDark}>Publish to contractors</button>
              </form>
            </>
          )}
          {packet.status === 'published' && (
            <form action={unpublishPacket}>
              <input type="hidden" name="packet_id" value={packet.id} />
              <button type="submit" style={btnGhost}>Unpublish</button>
            </form>
          )}
          {packet.status === 'claimed' && (
            <form action={releasePacket}>
              <input type="hidden" name="packet_id" value={packet.id} />
              <button type="submit" style={btnGhost} title="Release back to the open marketplace and re-notify inspectors">Release claim</button>
            </form>
          )}
          {packet.status === 'submitted' && (
            <form action={approvePacket}>
              <input type="hidden" name="packet_id" value={packet.id} />
              <button type="submit" style={btnDark}>Approve packet</button>
            </form>
          )}
          {packet.status === 'submitted' && (
            <form action={requestChanges} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="hidden" name="packet_id" value={packet.id} />
              <input name="note" placeholder="What to fix (optional)" style={{ ...priceInput, width: 200 }} />
              <button type="submit" style={btnGhost}>Request changes</button>
            </form>
          )}
          {packet.status === 'approved' && !packet.paid_at && (
            <form action={markPacketPaid}>
              <input type="hidden" name="packet_id" value={packet.id} />
              <button type="submit" style={btnDark}>Mark paid · {dollars(packet.posted_price_cents)}</button>
            </form>
          )}
          {packet.status === 'approved' && packet.paid_at && (
            <span style={{ fontSize: 12, color: 'var(--positive)', alignSelf: 'center' }}>
              Paid {new Date(packet.paid_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              {packet.contractor ? ` to ${packet.contractor.full_name}` : ''}
            </span>
          )}
          {isLive && packet.status !== 'submitted' && (
            <form action={cancelPacket}>
              <input type="hidden" name="packet_id" value={packet.id} />
              <button type="submit" style={btnGhost}>Cancel</button>
            </form>
          )}
        </div>

        {/* Stops */}
        <div style={{ marginTop: 30, borderTop: '1px solid var(--rule)' }}>
          {packet.stops.map((s, i) => (
            <div key={s.id} style={{ borderBottom: '1px solid var(--rule)', padding: '14px 0', display: 'flex', gap: 14, alignItems: 'baseline' }}>
              <span style={{ width: 22, color: 'var(--ink-4)', fontSize: 13 }}>{i + 1}</span>
              <div style={{ flex: 1 }}>
                <div className="font-serif" style={{ fontSize: 16 }}>{s.property.name}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 2 }}>
                  {s.property.address} · {windowLabel(s)} · {dollars(s.base_price_cents)}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 12 }}>
                {s.inspection_id ? (
                  <Link href={`/inspections/${s.inspection_id}/summary`} style={{ color: 'var(--tide-deep)', textDecoration: 'none' }}>
                    {s.status === 'complete' ? 'View inspection →' : 'In progress →'}
                  </Link>
                ) : (
                  <span style={{ color: 'var(--ink-4)' }}>{s.status}</span>
                )}
                {editable && packet.stop_count > 1 && (
                  <form action={removeStop} style={{ marginTop: 4 }}>
                    <input type="hidden" name="packet_id" value={packet.id} />
                    <input type="hidden" name="stop_id" value={s.id} />
                    <button type="submit" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 11, textDecoration: 'underline' }}>remove</button>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>

        {events.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <h2 style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 8 }}>Activity</h2>
            {events.map((e, i) => (
              <div key={i} style={{ fontSize: 12, color: 'var(--ink-3)', padding: '3px 0' }}>
                {e.event_type.replace(/_/g, ' ')}
                {e.actor_email ? ` · ${e.actor_email}` : ''}
                {' · '}
                {new Date(e.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </div>
            ))}
          </div>
        )}
      </section>
      <HelmFooter module="Field" right={packet.title} />
    </div>
  );
}

const priceInput: React.CSSProperties = {
  font: 'inherit',
  fontSize: 14,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  padding: '6px 8px',
  width: 90,
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
const btnGhost: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  border: '1px solid var(--rule)',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  padding: '9px 16px',
};
