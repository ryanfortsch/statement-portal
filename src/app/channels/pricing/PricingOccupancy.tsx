import type {PricingWindow} from '@/lib/dynamic-pricing-portfolio';

const percent=(value:number|null)=>value===null?'–':`${Math.round(value)}%`;

/** The bar and benchmark use the same 0–100 scale. Missing data never becomes zero. */
export default function PricingOccupancy({window:w}:{window:PricingWindow}) {
  const issue=w.unknown?'Calendar incomplete':!w.bookable?'No bookable nights':w.marketIssue==='stale'?'Market data out of date':w.marketIssue==='missing'?'No market data':w.marketIssue==='partial'?'Market data incomplete':null;
  const label=`Next ${w.nights} days: listing ${w.occupancyPct===null?'unavailable':percent(w.occupancyPct)}, market ${w.marketPct===null?'unavailable':percent(w.marketPct)}. ${issue??`${w.booked} booked, ${w.open} open, ${w.blocked} blocked.`}`;
  return <div className="pricing-occupancy" role="img" aria-label={label} title={label}>
    <div className="pricing-occupancy-values" aria-hidden="true"><b>{percent(w.occupancyPct)}</b><span>{percent(w.marketPct)}</span></div>
    <div className="pricing-occupancy-track" data-missing={w.occupancyPct===null||undefined} aria-hidden="true">
      {w.occupancyPct!==null&&<i style={{width:`${w.occupancyPct}%`}}/>}
      {w.marketPct!==null&&<span style={{left:`${w.marketPct}%`}}/>}
    </div>
  </div>;
}

export function PricingOccupancyKey() {
  return <span className="pricing-occupancy-key"><span><i/>Listing</span><span><i/>Market</span></span>;
}
