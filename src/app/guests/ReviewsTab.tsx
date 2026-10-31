import Link from 'next/link';
import { feedbackLabel } from '@/lib/guesty-review-normalize';
import { Stat } from '@/components/Stat';
import { isServiceConfigured as isHelmConfigured, supabaseAdmin as supabase } from '@/lib/supabase-admin';
import {
  getReviewWindowStats,
  listReviews,
  listReviewChannels,
  type ReviewRow,
  type ReviewListFilters,
} from '@/lib/reviews';
import { loadRecentStays, stayWindowsForReviews, type RecentStay } from '@/lib/recent-stays';
import { TestimonialsBlock } from './TestimonialsBlock';
import { shortDay, type AskTone } from '@/lib/review-ask-state';

/**
 * The Reviews tab of the Growth strip, at the bare /guests.
 *
 * All filter links and the filter form point back at bare /guests so
 * navigating within the tab keeps you on the tab. /reviews redirects here.
 * The window defaults to 30 days, the same window the Marketing page's
 * five-star tile reads, so a quiet week never opens on zeros.
 *
 * Two views share the window: the reviews themselves, and Recent stays
 * (?view=stays), one row per checkout saying whether we asked for a review,
 * whether a follow-up is due, and whether the review came in. A review links
 * to its stay and back. This is a page you open, not a queue: nothing here
 * reaches the home feed.
 */

// Reviews lives at the bare /guests path, so its links do too.
const TAB_BASE = '/guests';

const VALID_RATINGS: ReviewListFilters['rating'][] = ['5', 'below'];
const VALID_WINDOWS = [7, 30, 90, 365] as const;
type WindowDays = (typeof VALID_WINDOWS)[number];
const DEFAULT_WINDOW: WindowDays = 30;

export type ReviewsTabParams = {
  rating?: string;
  property?: string;
  channel?: string;
  q?: string;
  days?: string;
  view?: string;
};

type PropertyOption = { id: string; name: string };

async function getPropertyOptions(): Promise<PropertyOption[]> {
  if (!isHelmConfigured) return [];
  try {
    const { data } = await supabase
      .from('properties')
      .select('id, name, is_active')
      .eq('is_active', true);
    const rows = (data ?? []) as Array<{ id: string; name: string }>;
    const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    return rows.sort((a, b) => collator.compare(a.name, b.name));
  } catch {
    return [];
  }
}

function propertyMapFromOptions(options: PropertyOption[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const r of options) map[r.id] = r.name;
  return map;
}

export async function ReviewsTab({ params }: { params: ReviewsTabParams }) {
  const rating = (VALID_RATINGS as string[]).includes(params.rating ?? '')
    ? params.rating === 'below'
      ? 'below'
      : '5'
    : undefined;
  const propertyId = params.property?.trim() || undefined;
  const channel = params.channel?.trim() || undefined;
  const search = params.q?.trim() || '';
  const daysParam = Number(params.days);
  const days: WindowDays = (VALID_WINDOWS as readonly number[]).includes(daysParam)
    ? (daysParam as WindowDays)
    : DEFAULT_WINDOW;
  const view: View = params.view === 'stays' ? 'stays' : 'reviews';

  const [stats, channels, propertyOptions] = await Promise.all([
    getReviewWindowStats(days),
    listReviewChannels(),
    getPropertyOptions(),
  ]);
  const propertyMap = propertyMapFromOptions(propertyOptions);
  const reviews =
    view === 'reviews' ? await listReviews({ rating, propertyId, channel, search, days, limit: 100 }) : [];
  const stayWindows =
    view === 'reviews'
      ? await stayWindowsForReviews(reviews.map((r) => r.reservation_id ?? ''), VALID_WINDOWS)
      : new Map<string, number>();
  const recent =
    view === 'stays'
      ? await loadRecentStays({
          days,
          windows: VALID_WINDOWS,
          activePropertyIds: propertyOptions.map((p) => p.id),
          propertyId,
          channel,
          search,
        }).catch(() => null)
      : null;
  const viewQuery = view === 'stays' ? '&view=stays' : '';
  const fiveStarRate = stats.total > 0 ? Math.round((stats.fiveStar / stats.total) * 100) : null;

  return (
    <>
      {/* WINDOW STAT STRIP */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 32 }}>
        <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
          <div className="eyebrow">Window</div>
          <WindowSwitcher current={days} view={view} />
        </div>
        <div
          className="rt-helm-stat-strip"
          style={{
            borderTop: '1px solid var(--ink)',
            borderBottom: '1px solid var(--ink)',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
          }}
        >
          <Stat
            label="Total reviews"
            value={String(stats.total)}
            sub={`past ${days === 365 ? 'year' : `${days} days`}`}
            size="hero"
          />
          <Stat
            label="Five-star"
            value={String(stats.fiveStar)}
            sub={fiveStarRate != null ? `${fiveStarRate}% of total` : 'no reviews yet'}
            accent
            size="hero"
          />
          <Stat
            label="Below five"
            value={String(stats.belowFive)}
            sub={stats.belowFive > 0 ? 'review individually' : 'clean run'}
            size="hero"
          />
          <Stat
            label="Avg rating"
            value={stats.avg != null ? stats.avg.toFixed(2) : '—'}
            sub="overall (1-5)"
            size="hero"
            last
          />
        </div>
      </section>

      {/* FILTER BAR */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 24 }}>
        <form
          method="get"
          className="rt-helm-filter-bar"
          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
        >
          {/* Reviews is the default lens, so the GET submits to bare
              /guests with no tab param. */}
          <input type="hidden" name="days" value={days} />
          {view === 'stays' && <input type="hidden" name="view" value="stays" />}
          <input
            name="q"
            defaultValue={search}
            placeholder={view === 'stays' ? 'Search guest name' : 'Search guest name or review text'}
            style={inputStyle}
          />
          {view === 'reviews' && (
            <select name="rating" defaultValue={rating ?? ''} style={selectStyle}>
              <option value="">All ratings</option>
              <option value="5">Five-star only</option>
              <option value="below">Below five</option>
            </select>
          )}
          <select name="channel" defaultValue={channel ?? ''} style={selectStyle}>
            <option value="">All channels</option>
            {channels.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select name="property" defaultValue={propertyId ?? ''} style={selectStyle}>
            <option value="">All properties</option>
            {propertyOptions.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button type="submit" style={buttonStyle}>Filter</button>
          {(rating || propertyId || channel || search) && (
            <Link
              href={`${TAB_BASE}?days=${days}${viewQuery}`}
              style={{ fontSize: 12, color: 'var(--ink-3)', textDecoration: 'underline' }}
            >
              Clear
            </Link>
          )}
        </form>
      </section>

      {/* TESTIMONIALS from direct guests: nothing until the first one arrives. */}
      <TestimonialsBlock propertyMap={propertyMap} />

      {/* LIST */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        {/* A row reached from its review or its stay shows which one it is. */}
        <style>{'.rt-anchor-row:target{background:var(--paper-2)}'}</style>
        <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
          <ViewSwitcher current={view} days={days} />
          <span className="eyebrow">
            {view === 'reviews'
              ? reviews.length === 100
                ? 'showing first 100'
                : `${reviews.length} ${reviews.length === 1 ? 'match' : 'matches'}`
              : recent
                ? `${recent.truncated ? 'latest 200 checkouts' : `${recent.stays.length} ${recent.stays.length === 1 ? 'checkout' : 'checkouts'}`}${recent.askHistory ? '' : ' · ask history unavailable'}`
                : ''}
          </span>
        </div>

        {!isHelmConfigured ? (
          <EmptyBlock body="Ask Ryan: this page is not set up." />
        ) : view === 'stays' ? (
          recent === null ? (
            <EmptyBlock body="Recent stays could not be loaded." />
          ) : recent.stays.length === 0 ? (
            <EmptyBlock
              body={propertyId || channel || search ? 'No checkouts match these filters.' : 'No checkouts in this window.'}
            />
          ) : (
            <div style={{ borderTop: '1px solid var(--ink)' }}>
              {recent.stays.map((s) => (
                <StayRow key={s.reservationId} stay={s} propertyName={propertyMap[s.propertyId]} />
              ))}
            </div>
          )
        ) : reviews.length === 0 ? (
          <EmptyBlock body="No reviews match these filters." />
        ) : (
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {reviews.map((r) => (
              <ReviewRow
                key={r.id}
                review={r}
                propertyName={r.property_id ? propertyMap[r.property_id] : undefined}
                stayDays={r.reservation_id ? stayWindows.get(r.reservation_id) : undefined}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

type View = 'reviews' | 'stays';

function ViewSwitcher({ current, days }: { current: View; days: WindowDays }) {
  const views: Array<{ key: View; label: string; href: string }> = [
    { key: 'reviews', label: 'Reviews', href: `${TAB_BASE}?days=${days}` },
    { key: 'stays', label: 'Recent stays', href: `${TAB_BASE}?days=${days}&view=stays` },
  ];
  return (
    <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', margin: 0, display: 'flex', gap: 20 }}>
      {views.map((v) =>
        v.key === current ? (
          <span key={v.key} style={{ color: 'var(--ink)' }}>{v.label}</span>
        ) : (
          <Link key={v.key} href={v.href} style={{ color: 'var(--ink-4)', textDecoration: 'none' }}>
            {v.label}
          </Link>
        ),
      )}
    </h2>
  );
}

function WindowSwitcher({ current, view }: { current: WindowDays; view: View }) {
  return (
    <div className="flex items-baseline" style={{ gap: 14 }}>
      {VALID_WINDOWS.map((d) => {
        const active = d === current;
        return (
          <Link
            key={d}
            href={`${TAB_BASE}?days=${d}${view === 'stays' ? '&view=stays' : ''}`}
            style={{
              fontSize: 11,
              letterSpacing: '.16em',
              textTransform: 'uppercase',
              color: active ? 'var(--ink)' : 'var(--ink-3)',
              textDecoration: 'none',
              borderBottom: active ? '2px solid var(--signal)' : '2px solid transparent',
              paddingBottom: 3,
            }}
          >
            {d === 365 ? '1y' : `${d}d`}
          </Link>
        );
      })}
    </div>
  );
}

function ReviewRow({
  review: r,
  propertyName,
  stayDays,
}: {
  review: ReviewRow;
  propertyName?: string;
  /** The Recent stays window that holds this review's stay, when known. */
  stayDays?: number;
}) {
  const date = r.review_created_at
    ? new Date(r.review_created_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '—';
  const rating = r.overall_rating ?? 0;
  const stars = '★'.repeat(Math.round(rating)) + '☆'.repeat(Math.max(0, 5 - Math.round(rating)));
  const ratingColor = rating >= 5 ? 'var(--positive)' : rating >= 4 ? 'var(--ink-3)' : 'var(--signal)';

  return (
    <div
      id={`review-${r.id}`}
      className="rt-anchor-row"
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 1fr auto',
        gap: 24,
        alignItems: 'baseline',
        padding: '18px 0',
        borderBottom: '1px solid var(--rule)',
        scrollMarginTop: 96,
      }}
    >
      <div>
        <div className="font-mono tabular-nums" style={{ fontSize: 14, color: ratingColor, letterSpacing: '0.05em' }}>
          {stars}
        </div>
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)' }}>{date}</div>
      </div>
      <div>
        <div className="font-serif" style={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
          {r.contact_id ? (
            <Link
              href={`/guests/${r.contact_id}`}
              style={{ color: 'var(--ink)', textDecoration: 'none', borderBottom: '1px dotted var(--rule)' }}
              title="Open guest record"
            >
              {r.guest_name || 'Anonymous guest'}
            </Link>
          ) : (
            r.guest_name || 'Anonymous guest'
          )}
          {propertyName && (
            <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> · {propertyName}</span>
          )}
        </div>
        {r.public_review && (
          <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2)' }}>
            “{r.public_review}”
          </p>
        )}
        {r.private_feedback && (
          <p style={{ marginTop: 6, fontSize: 12, fontStyle: 'italic', color: 'var(--ink-4)', lineHeight: 1.5 }}>
            {feedbackLabel(r.channel)}: {r.private_feedback}
          </p>
        )}
      </div>
      <div style={{ textAlign: 'right' }}>
        <span style={{ fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
          {r.channel || '—'}
        </span>
        {r.reservation_id && stayDays != null && (
          <div style={{ marginTop: 6 }}>
            <Link
              href={`${TAB_BASE}?days=${stayDays}&view=stays#stay-${r.reservation_id}`}
              style={{ fontSize: 12, color: 'var(--ink-3)', textDecoration: 'none', borderBottom: '1px dotted var(--rule)' }}
              title="The stay this review is for"
            >
              Stay
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

const ASK_TONE_COLOR: Record<AskTone, string> = {
  done: 'var(--ink-2)',
  waiting: 'var(--signal)',
  due: 'var(--signal)',
  skipped: 'var(--ink-3)',
  unknown: 'var(--ink-4)',
};

function StayRow({ stay, propertyName }: { stay: RecentStay; propertyName?: string }) {
  const reviewColor =
    stay.review.kind === 'reviewed' ? 'var(--positive)' : stay.review.kind === 'sealed' ? 'var(--ink-3)' : 'var(--ink-4)';
  return (
    <div
      id={`stay-${stay.reservationId}`}
      className="rt-anchor-row"
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 1fr auto',
        gap: 24,
        alignItems: 'baseline',
        padding: '18px 0',
        borderBottom: '1px solid var(--rule)',
        scrollMarginTop: 96,
      }}
    >
      <div>
        <div className="font-mono tabular-nums" style={{ fontSize: 14, color: 'var(--ink)' }}>
          {shortDay(stay.checkOut)}
        </div>
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)' }}>checked out</div>
      </div>
      <div>
        <div className="font-serif" style={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
          {stay.guestFirst}
          {propertyName && <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> · {propertyName}</span>}
        </div>
        <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.55, color: ASK_TONE_COLOR[stay.ask.tone] }}>
          {stay.ask.text}
        </p>
        {stay.ourReview && (
          <p style={{ marginTop: 4, fontSize: 12, lineHeight: 1.5, color: ASK_TONE_COLOR[stay.ourReview.tone] }}>
            {stay.ourReview.text}
          </p>
        )}
      </div>
      <div style={{ textAlign: 'right' }}>
        <span style={{ fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
          {stay.channel || 'Direct'}
        </span>
        <div style={{ marginTop: 6, fontSize: 12, color: reviewColor, whiteSpace: 'nowrap' }}>
          {stay.reviewLink ? (
            <Link
              href={`${TAB_BASE}?days=${stay.reviewLink.days}#review-${stay.reviewLink.id}`}
              style={{ color: reviewColor, textDecoration: 'none', borderBottom: '1px dotted var(--rule)' }}
              title="Open the review"
            >
              {stay.review.text}
            </Link>
          ) : (
            stay.review.text
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyBlock({ body }: { body: string }) {
  return (
    <div style={{ borderTop: '1px solid var(--ink)', padding: '40px 0', textAlign: 'center' }}>
      <p style={{ color: 'var(--ink-3)', marginBottom: 8 }}>{body}</p>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 240,
  background: 'transparent',
  border: '1px solid var(--rule)',
  color: 'var(--ink)',
  padding: '8px 12px',
  fontSize: 13,
  fontFamily: 'inherit',
};

const selectStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--rule)',
  color: 'var(--ink)',
  padding: '8px 24px 8px 12px',
  fontSize: 13,
  fontFamily: 'inherit',
};

const buttonStyle: React.CSSProperties = {
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
