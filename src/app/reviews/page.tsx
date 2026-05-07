import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { Stat } from '@/components/Stat';
import { isConfigured as isHelmConfigured, supabase } from '@/lib/supabase';
import {
  getReviewWindowStats,
  listReviews,
  listReviewChannels,
  type ReviewRow,
  type ReviewListFilters,
} from '@/lib/reviews';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const VALID_RATINGS: ReviewListFilters['rating'][] = ['5', 'below'];
const VALID_WINDOWS = [7, 30, 90, 365] as const;
type WindowDays = (typeof VALID_WINDOWS)[number];

type SearchParams = Promise<{
  rating?: string;
  property?: string;
  channel?: string;
  q?: string;
  days?: string;
}>;

async function getPropertyNameMap(): Promise<Record<string, string>> {
  if (!isHelmConfigured) return {};
  try {
    const { data } = await supabase.from('properties').select('id, name');
    const map: Record<string, string> = {};
    for (const r of (data ?? []) as Array<{ id: string; name: string }>) {
      map[r.id] = r.name;
    }
    return map;
  } catch {
    return {};
  }
}

export default async function ReviewsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const rating = (VALID_RATINGS as string[]).includes(sp.rating ?? '')
    ? (sp.rating as ' 5' | 'below') === 'below'
      ? 'below'
      : '5'
    : undefined;
  const propertyId = sp.property?.trim() || undefined;
  const channel = sp.channel?.trim() || undefined;
  const search = sp.q?.trim() || '';
  const daysParam = Number(sp.days);
  const days: WindowDays = (VALID_WINDOWS as readonly number[]).includes(daysParam)
    ? (daysParam as WindowDays)
    : 7;

  const [stats, reviews, channels, propertyMap] = await Promise.all([
    getReviewWindowStats(days),
    listReviews({ rating, propertyId, channel, search, limit: 100 }),
    listReviewChannels(),
    getPropertyNameMap(),
  ]);

  const fiveStarRate = stats.total > 0 ? Math.round((stats.fiveStar / stats.total) * 100) : null;

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--paper)', color: 'var(--ink)' }}
    >
      <HelmMasthead current="reviews" />

      <HelmHero
        eyebrow="Helm · Reviews"
        title="Five-star,"
        emphasis="and the ones that aren't."
        description="Guest reviews from Airbnb, VRBO, Booking.com, and direct. Synced nightly from Guesty."
      />

      {/* WINDOW STAT STRIP */}
      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{ width: '100%', paddingBottom: 32 }}
      >
        <div
          className="flex items-baseline justify-between"
          style={{ marginBottom: 14 }}
        >
          <div className="eyebrow">Window</div>
          <WindowSwitcher current={days} />
        </div>
        <div
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
      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{ width: '100%', paddingBottom: 24 }}
      >
        <form
          method="get"
          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
        >
          <input type="hidden" name="days" value={days} />
          <input
            name="q"
            defaultValue={search}
            placeholder="Search guest name or review text"
            style={inputStyle}
          />
          <select name="rating" defaultValue={rating ?? ''} style={selectStyle}>
            <option value="">All ratings</option>
            <option value="5">Five-star only</option>
            <option value="below">Below five</option>
          </select>
          <select name="channel" defaultValue={channel ?? ''} style={selectStyle}>
            <option value="">All channels</option>
            {channels.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input
            name="property"
            defaultValue={propertyId ?? ''}
            placeholder="Property id"
            style={{ ...inputStyle, maxWidth: 140 }}
          />
          <button type="submit" style={buttonStyle}>Filter</button>
          {(rating || propertyId || channel || search) && (
            <Link
              href={`/reviews?days=${days}`}
              style={{ fontSize: 12, color: 'var(--ink-3)', textDecoration: 'underline' }}
            >
              Clear
            </Link>
          )}
        </form>
      </section>

      {/* LIST */}
      <section
        className="max-w-[1100px] mx-auto px-10"
        style={{ paddingBottom: 80, flex: 1, width: '100%' }}
      >
        <div
          className="flex items-baseline justify-between"
          style={{ marginBottom: 14 }}
        >
          <h2
            className="font-serif"
            style={{
              fontSize: 22,
              fontWeight: 400,
              letterSpacing: '-0.01em',
              color: 'var(--ink)',
              margin: 0,
            }}
          >
            Reviews
          </h2>
          <span className="eyebrow">
            {reviews.length === 100 ? 'showing first 100' : `${reviews.length} ${reviews.length === 1 ? 'match' : 'matches'}`}
          </span>
        </div>

        {!isHelmConfigured ? (
          <EmptyBlock body="Helm Supabase env vars are not set." />
        ) : reviews.length === 0 ? (
          <EmptyBlock body="No reviews match these filters." />
        ) : (
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {reviews.map((r) => (
              <ReviewRow key={r.id} review={r} propertyName={r.property_id ? propertyMap[r.property_id] : undefined} />
            ))}
          </div>
        )}
      </section>

      <HelmFooter module="Reviews" right="Source: Guesty" />
    </div>
  );
}

function WindowSwitcher({ current }: { current: WindowDays }) {
  return (
    <div className="flex items-baseline" style={{ gap: 14 }}>
      {VALID_WINDOWS.map((d) => {
        const active = d === current;
        return (
          <Link
            key={d}
            href={`/reviews?days=${d}`}
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
}: {
  review: ReviewRow;
  propertyName?: string;
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
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 1fr auto',
        gap: 24,
        alignItems: 'baseline',
        padding: '18px 0',
        borderBottom: '1px solid var(--rule)',
      }}
    >
      <div>
        <div
          className="font-mono tabular-nums"
          style={{
            fontSize: 14,
            color: ratingColor,
            letterSpacing: '0.05em',
          }}
        >
          {stars}
        </div>
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)' }}>{date}</div>
      </div>
      <div>
        <div
          className="font-serif"
          style={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)', letterSpacing: '-0.01em' }}
        >
          {r.guest_name || 'Anonymous guest'}
          {propertyName && (
            <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> · {propertyName}</span>
          )}
        </div>
        {r.public_review && (
          <p
            style={{
              marginTop: 6,
              fontSize: 13,
              lineHeight: 1.55,
              color: 'var(--ink-2)',
            }}
          >
            “{r.public_review}”
          </p>
        )}
        {r.private_feedback && (
          <p
            style={{
              marginTop: 6,
              fontSize: 12,
              fontStyle: 'italic',
              color: 'var(--ink-4)',
              lineHeight: 1.5,
            }}
          >
            Private feedback: {r.private_feedback}
          </p>
        )}
      </div>
      <span
        style={{
          fontSize: 10,
          letterSpacing: '.16em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
          whiteSpace: 'nowrap',
        }}
      >
        {r.channel || '—'}
      </span>
    </div>
  );
}

function EmptyBlock({ body }: { body: string }) {
  return (
    <div
      style={{
        borderTop: '1px solid var(--ink)',
        padding: '40px 0',
        textAlign: 'center',
      }}
    >
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
