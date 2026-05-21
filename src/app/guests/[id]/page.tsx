import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { getContact, listContactEvents, listContactStays, type ContactStay } from '@/lib/guests';
import { displayName, formatTagLabel } from '@/lib/guests-types';
import { listReviewsForContact, type ReviewRow } from '@/lib/reviews';
import { unsubscribeContact, resubscribeContact } from '../actions';

export const dynamic = 'force-dynamic';

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [contact, events, reviews] = await Promise.all([
    getContact(id),
    listContactEvents(id, 50),
    listReviewsForContact(id),
  ]);

  if (!contact) notFound();

  const stays = await listContactStays(contact.guesty_guest_id);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="guests" />

      {/* HEADER */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          <Link href="/guests" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>← Guests</Link>
        </div>
        <h1 className="font-serif" style={{
          fontSize: 36,
          lineHeight: 1.05,
          fontWeight: 300,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
        }}>
          {displayName(contact)}
        </h1>
        <p style={{ marginTop: 8, fontSize: 14, color: 'var(--ink-3)' }}>
          {contact.email}
        </p>
      </section>

      {/* META STRIP */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 36 }}>
        <div
          style={{
            borderTop: '1px solid var(--ink)',
            borderBottom: '1px solid var(--ink)',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
          }}
        >
          <Field label="Status" value={contact.status} />
          <Field label="Subscribed" value={contact.subscribed_at ? formatDate(contact.subscribed_at) : '—'} />
          <Field label="Source" value={contact.source ?? '—'} />
          <Field label="Sent / Opened" value={`${contact.total_sent} / ${contact.total_opened}`} last />
        </div>
      </section>

      {/* TAGS */}
      {contact.tags.length > 0 && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 28, width: '100%' }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Tags</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {contact.tags.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: 11,
                  letterSpacing: '.04em',
                  padding: '4px 10px',
                  border: '1px solid var(--rule)',
                  color: 'var(--ink-3)',
                }}
              >
                {formatTagLabel(t)}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ACTIONS */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 36, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Actions</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {contact.status === 'subscribed' ? (
            <form action={unsubscribeContact}>
              <input type="hidden" name="id" value={contact.id} />
              <button type="submit" style={dangerButtonStyle}>
                Unsubscribe
              </button>
            </form>
          ) : (
            <form action={resubscribeContact}>
              <input type="hidden" name="id" value={contact.id} />
              <button type="submit" style={primaryButtonStyle}>
                Resubscribe
              </button>
            </form>
          )}
          <a href={`mailto:${contact.email}`} style={secondaryButtonStyle}>
            Send 1:1 email
          </a>
        </div>
      </section>

      {/* STAYS - past + upcoming reservations joined from
          guesty_reservations via guesty_guest_id. Internal Helm UI, so
          internal property names ("21 Horton") are fine here; the
          brand voice rule banning addresses applies to guest-facing
          campaign copy only. */}
      {stays.length > 0 && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 36, width: '100%' }}>
          <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
            <div className="eyebrow">Stays ({stays.length})</div>
          </div>
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {stays.map((s) => (
              <StayRow key={s.reservation_id} stay={s} />
            ))}
          </div>
        </section>
      )}

      {/* REVIEWS — what this guest said about their stays (when matched
          via contact_id by the Guesty sync). */}
      {reviews.length > 0 && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 36, width: '100%' }}>
          <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
            <div className="eyebrow">Reviews</div>
            <Link
              href={`/guests?q=${encodeURIComponent(displayName(contact))}`}
              className="eyebrow"
              style={{ color: 'var(--ink-3)', textDecoration: 'none' }}
            >
              See all reviews →
            </Link>
          </div>
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {reviews.map((r) => (
              <ReviewSummary key={r.id} review={r} />
            ))}
          </div>
        </section>
      )}

      {/* TIMELINE */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Timeline</div>
        {events.length === 0 ? (
          <div style={{ borderTop: '1px solid var(--ink)', padding: '24px 0', fontSize: 13, color: 'var(--ink-4)' }}>
            No events recorded yet. Engagement events arrive after the first send.
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {events.map((e) => (
              <div
                key={e.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '180px 1fr',
                  gap: 20,
                  padding: '14px 0',
                  borderBottom: '1px solid var(--rule)',
                }}
              >
                <span className="font-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                  {formatDateTime(e.occurred_at)}
                </span>
                <div style={{ fontSize: 13, color: 'var(--ink)' }}>
                  <span style={{ textTransform: 'uppercase', letterSpacing: '.08em', fontSize: 11, color: 'var(--ink-3)', marginRight: 10 }}>
                    {e.event_type}
                  </span>
                  {e.metadata && Object.keys(e.metadata).length > 0 && (
                    <code className="font-mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                      {Object.entries(e.metadata)
                        .filter(([k]) => k !== 'raw')
                        .slice(0, 3)
                        .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
                        .join(' · ')}
                    </code>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* FOOTER */}
      <footer style={{ borderTop: '1px solid var(--ink)' }}>
        <div className="max-w-[1100px] mx-auto px-10 flex items-center justify-between" style={{
          padding: '14px 40px',
          fontSize: 10,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-4)',
        }}>
          <span>Rising Tide &middot; Guests</span>
          <span style={{ fontStyle: 'italic', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-3)', fontSize: 11 }}>
            id: {contact.id.slice(0, 8)}
          </span>
        </div>
      </footer>
    </div>
  );
}

function ReviewSummary({ review: r }: { review: ReviewRow }) {
  const rating = r.overall_rating ?? 0;
  const stars = '★'.repeat(Math.round(rating)) + '☆'.repeat(Math.max(0, 5 - Math.round(rating)));
  const ratingColor = rating >= 5 ? 'var(--positive)' : rating >= 4 ? 'var(--ink-3)' : 'var(--signal)';
  const date = r.review_created_at ? formatDate(r.review_created_at) : '—';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 1fr auto',
        gap: 20,
        alignItems: 'baseline',
        padding: '14px 0',
        borderBottom: '1px solid var(--rule)',
      }}
    >
      <span className="font-mono tabular-nums" style={{ fontSize: 13, color: ratingColor, letterSpacing: '.05em' }}>
        {stars}
      </span>
      <span style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.5 }}>
        {r.public_review ? `“${r.public_review}”` : <span style={{ color: 'var(--ink-4)' }}>No public text.</span>}
        {r.channel && (
          <span style={{ color: 'var(--ink-4)', marginLeft: 8, fontSize: 11 }}>· {r.channel}</span>
        )}
      </span>
      <span style={{ fontSize: 11, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>{date}</span>
    </div>
  );
}

function StayRow({ stay: s }: { stay: ContactStay }) {
  const propertyLabel = s.property_name ?? s.property_id ?? 'Unknown property';
  const dateRange = formatStayDateRange(s.check_in, s.check_out);
  const today = new Date();
  const checkInDate = s.check_in ? new Date(s.check_in) : null;
  const isUpcoming = checkInDate ? checkInDate.getTime() > today.getTime() : false;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '180px 1fr auto auto',
        gap: 16,
        alignItems: 'baseline',
        padding: '14px 0',
        borderBottom: '1px solid var(--rule)',
      }}
    >
      <span className="font-mono tabular-nums" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
        {dateRange}
      </span>
      <span className="font-serif" style={{ fontSize: 15, fontWeight: 400, color: 'var(--ink)' }}>
        {propertyLabel}
        {isUpcoming && (
          <span
            style={{
              marginLeft: 10,
              fontSize: 10,
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              color: 'var(--signal)',
            }}
          >
            Upcoming
          </span>
        )}
      </span>
      <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
        {s.nights != null ? `${s.nights} ${s.nights === 1 ? 'night' : 'nights'}` : ''}
      </span>
      <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
        {s.channel ?? ''}
      </span>
    </div>
  );
}

function formatStayDateRange(checkIn: string | null, checkOut: string | null): string {
  if (!checkIn) return '—';
  const ci = new Date(checkIn);
  const co = checkOut ? new Date(checkOut) : null;
  const sameMonth = co && ci.getMonth() === co.getMonth() && ci.getFullYear() === co.getFullYear();
  if (!co) return formatDate(checkIn);
  if (sameMonth) {
    const month = ci.toLocaleDateString('en-US', { month: 'short' });
    return `${month} ${ci.getDate()} - ${co.getDate()}, ${co.getFullYear()}`;
  }
  return `${formatDate(checkIn)} - ${formatDate(checkOut as string)}`;
}

function Field({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div style={{ padding: '20px 22px', borderRight: last ? 'none' : '1px solid var(--rule)' }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>
      <div className="font-serif" style={{ fontSize: 18, fontWeight: 400, color: 'var(--ink)' }}>
        {value}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const primaryButtonStyle: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '10px 18px',
  border: 'none',
  cursor: 'pointer',
  textDecoration: 'none',
};

const secondaryButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '10px 18px',
  border: '1px solid var(--ink)',
  cursor: 'pointer',
  textDecoration: 'none',
};

const dangerButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  borderColor: 'var(--signal)',
  color: 'var(--signal)',
};
