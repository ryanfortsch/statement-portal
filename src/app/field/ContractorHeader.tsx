import { ProfilePhoto } from './ProfilePhoto';
import { TRADE_META, type ContractorRow } from '@/lib/field-types';
import type { ContractorRating } from '@/lib/field-ratings';

const GOLD = '#b8860b';

function monthYear(d: string | null): string {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  } catch {
    return '';
  }
}

function stars(n: number): string {
  const full = Math.round(n);
  return '★'.repeat(Math.max(0, Math.min(5, full))) + '☆'.repeat(Math.max(0, 5 - full));
}

/**
 * The contractor hero, shared by the Work and Profile tabs so the two can
 * never drift: photo, name, role · since, and the guest rating on the right.
 * `subline` is the one per-page slot (Work uses it for the open-packets
 * status sentence); everything else renders identically.
 */
export function ContractorHeader({
  contractor,
  rating,
  subline,
}: {
  contractor: ContractorRow;
  rating: ContractorRating | undefined;
  subline?: React.ReactNode;
}) {
  const roleLabel = TRADE_META[contractor.trade]?.role ?? contractor.trade;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, margin: '16px 0 26px', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, minWidth: 0 }}>
        <ProfilePhoto current={contractor.photo_url} name={contractor.full_name} size={76} stacked />
        <div style={{ minWidth: 0 }}>
          <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300, margin: 0, lineHeight: 1.1 }}>{contractor.full_name}</h1>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span>{roleLabel}</span>
            {monthYear(contractor.created_at) && <span style={{ color: 'var(--ink-4)' }}>· since {monthYear(contractor.created_at)}</span>}
          </div>
          {subline && (
            <p style={{ fontSize: 14, color: 'var(--ink-3)', margin: '6px 0 0' }}>{subline}</p>
          )}
        </div>
      </div>
      {/* Show the score from the first review on. `rated` (>= MIN_RATED) gates
          the competitive tier on the roster, not her own surfaces — the review
          count renders right beside the number, so it qualifies itself. */}
      {rating && rating.count > 0 && rating.avg != null && (
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ color: GOLD, fontSize: 17, letterSpacing: 2 }}>{stars(rating.avg)}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, justifyContent: 'flex-end', marginTop: 3 }}>
            <span className="font-mono" style={{ fontSize: 27, color: GOLD, fontWeight: 500, lineHeight: 1 }}>{rating.avg.toFixed(2)}</span>
            <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>/ 5</span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 3 }}>{rating.count} {rating.count === 1 ? 'review' : 'reviews'}</div>
        </div>
      )}
    </div>
  );
}
