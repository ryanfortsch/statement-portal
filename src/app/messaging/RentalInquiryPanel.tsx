import Link from 'next/link';
import { inquiryAvailability, inquiryQuoteHref, type RentalInquiry } from '@/lib/rental-inquiry';

export function RentalInquiryPanel({ inquiry, first, email, source }: { inquiry: RentalInquiry; first: string; email?: string; source: string }) {
  return <section aria-label="Rental inquiry assessment" style={{ border: '1px solid var(--rule)', background: 'var(--paper)', padding: 14, marginBottom: 18 }}>
    <div className="eyebrow" style={{ color: 'var(--ink-2)', marginBottom: 10 }}>
      {inquiry.needs.length ? 'Quote preparation needed' : 'Availability and pricing checked'}
      {inquiry.guests ? ` · ${inquiry.guests} guests` : ''}{inquiry.flexible ? ' · flexible dates' : ''}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 12 }}>
      {inquiry.homes.map(home => <div key={home.listing_id} style={{ border: '1px solid var(--rule)', padding: 12 }}>
        <div className="font-serif" style={{ fontSize: 17 }}>{home.title}</div>
        <p style={{ margin: '6px 0', fontSize: 13 }}>{inquiryAvailability(home.availability)}</p>
        {home.quote && <p style={{ fontSize: 13 }}>Current reference: {new Intl.NumberFormat('en-US', { style: 'currency', currency: home.quote.currency }).format(home.quote.total)} total</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 10 }}>
          {home.property_id ? <Link className="eyebrow" href={inquiryQuoteHref(inquiry, home.property_id, { first, email, source })} style={{ color: 'var(--ink)', border: '1px solid var(--ink-3)', padding: '9px 12px', textDecoration: 'none' }}>Prepare quote</Link> : <span style={{ fontSize: 12 }}>Property mapping needs review</span>}
          {home.work_slip_id && <Link href={`/work/${encodeURIComponent(home.work_slip_id)}`} style={{ color: 'var(--ink-3)', fontSize: 12 }}>Quote task</Link>}
          {home.work_error && <span style={{ color: 'var(--signal)', fontSize: 12 }}>Task not confirmed · retrying</span>}
        </div>
      </div>)}
    </div>
    {inquiry.needs.length > 0 && <ul style={{ fontSize: 13, lineHeight: 1.5, paddingLeft: 18, marginBottom: 8 }}>{inquiry.needs.map(need => <li key={need}>{need}</li>)}</ul>}
    <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>
      {inquiry.history_checked ? 'Prior correspondence reviewed. ' : ''}Dates and prices are checked again in the quote form. Sending a guest update leaves the quote tasks open.
    </p>
  </section>;
}
