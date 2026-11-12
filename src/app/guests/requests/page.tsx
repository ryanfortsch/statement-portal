import type { CSSProperties } from 'react';
import { HelmFooter } from '@/components/HelmFooter';
import { EmptyState } from '@/components/EmptyState';
import { listBookingRequests, type RequestCalendar, type ReviewRequest } from '@/lib/booking-requests-db';
import {
  BOOKING_REQUEST_STATUS_LABEL,
  clockLabel,
  easternShort,
  effectiveStatus,
  guestFullName,
  isOpen,
  isUrgent,
  nightsOf,
  openOverlaps,
} from '@/lib/booking-requests';
import { displayTitle, fmtCents, fmtShortDate } from '@/lib/sca-quotes-types';
import { RequestActions } from './RequestActions';

export const dynamic = 'force-dynamic';

/**
 * The Requests tab of the Growth strip (owners only): guests asking for
 * dates at a partner home on staycapeann.com. Each open request shows its
 * 24-hour clock, what the calendar says about its nights now, any other
 * request after the same nights, the guest's note and both contacts. The
 * office tells the host by hand (Phase 1), then declines it or lets it
 * close; the guest is emailed either way (src/lib/booking-requests-db.ts).
 */
export default async function BookingRequestsPage() {
  const now = new Date();
  const listed = await listBookingRequests({ now });

  return (
    <div className="flex-1 flex flex-col">
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 96 }}>
        {!listed.ok ? (
          <EmptyState>Ask Ryan: booking requests are not switched on yet.</EmptyState>
        ) : (
          <RequestList rows={listed.rows} now={now} />
        )}
      </section>
      <HelmFooter module="Requests" right="Stay Cape Ann · Rising Tide" />
    </div>
  );
}

function RequestList({ rows, now }: { rows: ReviewRequest[]; now: Date }) {
  const open = rows.filter((r) => isOpen(r, now)).sort((a, b) => a.respond_by.localeCompare(b.respond_by));
  const closed = rows.filter((r) => !isOpen(r, now));
  const overlaps = openOverlaps(rows, now);
  const byId = new Map(rows.map((r) => [r.id, r]));

  return (
    <>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
          {open.length === 0 ? 'Nothing waiting on a host.' : `${open.length} waiting on a host`}
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 4, maxWidth: 640, lineHeight: 1.5 }}>
          A host who says yes cannot be booked from here yet: accepting takes the guest&apos;s payment on the host&apos;s own
          account, which comes with card payments for partner homes.
        </p>
      </div>

      {open.length === 0 ? (
        <EmptyState>No requests waiting.</EmptyState>
      ) : (
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {open.map((r) => (
            <OpenRequest key={r.id} r={r} now={now} overlapping={(overlaps.get(r.id) ?? []).map((id) => byId.get(id)).filter((x): x is ReviewRequest => !!x)} />
          ))}
        </div>
      )}

      {closed.length > 0 && (
        <div style={{ marginTop: 48 }}>
          <h2 className="eyebrow" style={{ marginBottom: 10 }}>Closed in the last 30 days</h2>
          <div style={{ borderTop: '1px solid var(--rule)' }}>
            {closed.map((r) => (
              <ClosedRequest key={r.id} r={r} now={now} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function homeLabel(r: ReviewRequest): string {
  return displayTitle(r.home?.title) || r.home?.name || r.property_id;
}

function stayLine(r: ReviewRequest): string {
  const n = nightsOf(r.check_in, r.check_out);
  return `${fmtShortDate(r.check_in)} to ${fmtShortDate(r.check_out)} · ${n} night${n === 1 ? '' : 's'} · ${r.guests} guest${r.guests === 1 ? '' : 's'}`;
}

function nightsList(nights: string[]): string {
  const shown = nights.slice(0, 4).map(fmtShortDate).join(', ');
  return nights.length > 4 ? `${shown} and ${nights.length - 4} more` : shown;
}

function CalendarLine({ c }: { c: RequestCalendar | null }) {
  if (!c || c.state === 'unknown') return <span style={{ color: 'var(--ink-4)' }}>Calendar not checked</span>;
  if (c.state === 'open') return <span style={{ color: '#1d6b46' }}>Nights still open</span>;
  if (c.state === 'booked') return <span style={{ color: 'var(--signal)' }}>Booked since it came in: {nightsList(c.nights)}</span>;
  return <span style={{ color: 'var(--signal)' }}>Closed on the calendar: {nightsList(c.nights)}</span>;
}

const meta: CSSProperties = { fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.06em', marginTop: 6 };

function OpenRequest({ r, now, overlapping }: { r: ReviewRequest; now: Date; overlapping: ReviewRequest[] }) {
  const guest = guestFullName(r);
  const urgent = isUrgent(r, now);
  const host = r.home;
  return (
    <div style={{ padding: '18px 4px', borderBottom: '1px solid var(--rule)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <span style={{ fontSize: 15, fontWeight: 500 }}>{homeLabel(r)}</span>
          {host?.name && host.name !== homeLabel(r) && <span style={{ fontSize: 11, color: 'var(--ink-4)', marginLeft: 8 }}>{host.name}</span>}
        </div>
        <div className="tabular-nums" style={{ fontSize: 12.5, color: urgent ? 'var(--signal)' : 'var(--ink-3)', fontWeight: urgent ? 600 : 400 }}>
          {clockLabel(r, now)} · answer by {easternShort(r.respond_by)}
        </div>
      </div>

      <div className="tabular-nums" style={{ fontSize: 13.5, marginTop: 6 }}>
        {guest} · {stayLine(r)} · {fmtCents(r.quoted_total_cents, r.currency)}
      </div>

      <div style={{ fontSize: 12.5, marginTop: 6 }}>
        <CalendarLine c={r.calendar} />
        {overlapping.length > 0 && (
          <span style={{ color: 'var(--signal)' }}>
            {' · '}Same nights as {overlapping.map(guestFullName).join(', ')}
          </span>
        )}
      </div>

      {r.message && (
        <p style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 10, whiteSpace: 'pre-wrap', maxWidth: 720, lineHeight: 1.55, borderLeft: '2px solid var(--rule)', paddingLeft: 12 }}>
          {r.message}
        </p>
      )}

      <div style={meta}>
        GUEST <a href={`mailto:${r.guest_email}`} style={{ color: 'inherit' }}>{r.guest_email}</a>
        {r.guest_phone && <> · <a href={`tel:${r.guest_phone}`} style={{ color: 'inherit' }}>{r.guest_phone}</a></>}
      </div>
      <div style={{ ...meta, marginTop: 2 }}>
        HOST {host?.host_name || 'no name on file'}
        {host?.host_emails[0] && <> · <a href={`mailto:${host.host_emails[0]}`} style={{ color: 'inherit' }}>{host.host_emails[0]}</a></>}
        {host?.host_phone && <> · <a href={`tel:${host.host_phone}`} style={{ color: 'inherit' }}>{host.host_phone}</a></>}
        {r.host_told_at && <> · told {easternShort(r.host_told_at)}</>}
      </div>

      <div style={{ marginTop: 12 }}>
        <RequestActions id={r.id} guest={guest} home={homeLabel(r)} hostTold={!!r.host_told_at} />
      </div>
    </div>
  );
}

function ClosedRequest({ r, now }: { r: ReviewRequest; now: Date }) {
  const status = effectiveStatus(r, now);
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', padding: '10px 4px', borderBottom: '1px solid var(--rule)', fontSize: 13 }}>
      <span>
        {homeLabel(r)} · {guestFullName(r)} · <span className="tabular-nums">{fmtShortDate(r.check_in)} to {fmtShortDate(r.check_out)}</span>
        {r.decline_reason && <span style={{ color: 'var(--ink-4)' }}> · {r.decline_reason}</span>}
      </span>
      <span style={{ color: 'var(--ink-3)' }}>
        {BOOKING_REQUEST_STATUS_LABEL[status]}
        {r.decided_at && <span style={{ color: 'var(--ink-4)' }}> · {easternShort(r.decided_at)}</span>}
        {(status === 'declined' || status === 'expired') && !r.outcome_emailed_at && <span style={{ color: 'var(--signal)' }}> · email not sent yet</span>}
      </span>
    </div>
  );
}
