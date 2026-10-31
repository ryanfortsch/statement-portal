import { SubmitButton } from '@/components/SubmitButton';
import { displayName, reviewMonth } from '@/lib/guest-testimonials';
import { listTestimonials, type TestimonialRow } from '@/lib/guest-testimonials-store';
import { stars } from '@/lib/review-ask-state';
import { approveTestimonial, hideTestimonial } from './testimonials-actions';

/**
 * Testimonials from direct (staycapeann.com) guests, on the Reviews tab.
 *
 * A direct guest's review ask links a form on staycapeann.com; what they write
 * lands here as "waiting" until a person approves it, and an approved one
 * renders ahead of the live Guesty reviews on that home's listing page.
 * Waiting first, then what is on the site, then what was hidden (which can be
 * shown again). Nothing renders until the first testimonial arrives.
 */
export async function TestimonialsBlock({ propertyMap }: { propertyMap: Record<string, string> }) {
  let rows: TestimonialRow[];
  try {
    rows = await listTestimonials();
  } catch {
    // The table is created by migration 20261031120000; until it exists, or
    // when the read fails, the tab shows the reviews it always showed.
    return null;
  }
  if (rows.length === 0) return null;
  const waiting = rows.filter((r) => r.status === 'submitted');
  const approved = rows.filter((r) => r.status === 'approved');
  const hidden = rows.filter((r) => r.status === 'hidden');
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 40 }}>
      <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
        <div className="eyebrow">Testimonials from direct guests</div>
        <span className="eyebrow">
          {waiting.length} waiting · {approved.length} on the site
        </span>
      </div>
      <div style={{ borderTop: '1px solid var(--ink)' }}>
        {[...waiting, ...approved, ...hidden].map((r) => (
          <Row key={r.id} row={r} propertyName={propertyMap[r.property_id]} />
        ))}
      </div>
    </section>
  );
}

const STATUS_WORD: Record<TestimonialRow['status'], string> = {
  invited: 'link sent',
  submitted: 'waiting for you',
  approved: 'on the site',
  hidden: 'hidden',
};

function Row({ row, propertyName }: { row: TestimonialRow; propertyName?: string }) {
  const month = reviewMonth(row);
  const when = month
    ? new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    : '';
  return (
    <div
      id={`testimonial-${row.id}`}
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 1fr auto',
        gap: 24,
        alignItems: 'start',
        padding: '18px 0',
        borderBottom: '1px solid var(--rule)',
      }}
    >
      <div>
        <div className="font-mono tabular-nums" style={{ fontSize: 14, color: 'var(--ink)' }}>{when}</div>
        <div style={{ marginTop: 4, fontSize: 11, color: row.status === 'submitted' ? 'var(--signal)' : 'var(--ink-4)' }}>
          {STATUS_WORD[row.status]}
        </div>
      </div>
      <div>
        <div className="font-serif" style={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
          {displayName(row)}
          {propertyName && <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> · {propertyName}</span>}
          {row.rating != null && (
            <span style={{ marginLeft: 10, fontSize: 13, color: 'var(--ink-3)', letterSpacing: '.04em' }}>{stars(row.rating)}</span>
          )}
        </div>
        <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2)', whiteSpace: 'pre-line' }}>{row.body}</p>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', whiteSpace: 'nowrap' }}>
        {row.status !== 'approved' && (
          <form action={approveTestimonial}>
            <input type="hidden" name="id" value={row.id} />
            <SubmitButton
              label={row.status === 'hidden' ? 'Show on the site' : 'Approve'}
              busyLabel="Saving"
              style={primaryStyle}
            />
          </form>
        )}
        {row.status !== 'hidden' && (
          <form action={hideTestimonial}>
            <input type="hidden" name="id" value={row.id} />
            <SubmitButton label="Hide" busyLabel="Hiding" style={quietStyle} spinnerTone="ink" />
          </form>
        )}
      </div>
    </div>
  );
}

const primaryStyle: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: 'none',
  padding: '8px 18px',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};

const quietStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  border: 'none',
  padding: '8px 6px',
  fontSize: 11,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  textDecoration: 'underline',
  cursor: 'pointer',
};
