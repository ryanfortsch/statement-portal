import Link from 'next/link';
import { inquiryDraftState, inquiryQuoteHref, type RentalInquiry } from '@/lib/rental-inquiry';

const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);

/** Small evidence beside the reply, never a second workflow above the email. */
export function RentalInquiryPanel({ inquiry, first, email, source }: { inquiry: RentalInquiry; first: string; email?: string; source: string }) {
  const budget = [...new Set(inquiry.budget_mentions || [])].sort((a, b) => a - b);
  return <div style={{ fontSize: 14, lineHeight: 1.55 }}>
    {(inquiry.decision || inquiry.draft_issue) && <p style={{ margin: '0 0 14px' }}>{inquiryDraftState(inquiry).message}</p>}
    {!!(inquiry.needs?.length || inquiry.operator_checks?.length) && <ul style={{ margin: '0 0 14px', paddingLeft: 20 }}>
      {[...new Set([...(inquiry.operator_checks || []), ...(inquiry.needs || [])])].map(need => <li key={need}>{need}</li>)}
    </ul>}
    {budget.length > 0 && <p style={{ margin: '0 0 12px' }}>Budget mentioned earlier: <strong>{budget.map(money).join(' / ')}</strong></p>}
    {inquiry.homes.some(home => home.estimate || home.quote) && <div className="eyebrow" style={{ color: 'var(--ink-3)', marginBottom: 6 }}>Current site estimates for this stay</div>}
    {inquiry.homes.map(home => <div key={home.listing_id} style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '2px 12px', marginBottom: 6 }}>
      {home.property_id ? <Link href={inquiryQuoteHref(inquiry, home.property_id, { first, email, source })} style={{ color: 'var(--ink)', textUnderlineOffset: 3 }}>{home.title.replace(/^Stay (at|in) /, '')}</Link> : <span>{home.title}</span>}
      <span>{home.estimate || home.quote ? money((home.estimate || home.quote)!.total) : 'Price not verified'}</span>
    </div>)}
  </div>;
}
