import {pricingActivityValue,pricingActivityDescription,type PricingBookingActivity as Activity} from '@/lib/dynamic-pricing-activity';
import {etStamp} from '@/lib/stable-time';

export default function PricingBookingActivity({activity}:{activity?:Activity}) {
  return <section className="pricing-booking-activity" aria-label="Recent booking activity">
    <h3>Nights booked</h3>
    <div className="pricing-activity-values">{([7,45] as const).map(n=><div key={n} title={pricingActivityDescription(activity,n)}><span>Past {n} days</span><strong>{pricingActivityValue(activity,n)}</strong></div>)}</div>
    <details className="pricing-activity-details"><summary>{!activity?'Booking dates unavailable':activity.undatedStays?`${activity.verifiedStays} / ${activity.verifiedStays+activity.undatedStays} stays verified`:'Booking details'}</summary>
      {activity?<><p>{pricingActivityDescription(activity,7)}</p><p>{pricingActivityDescription(activity,45)}</p>{activity.lastVerifiedBookedOn&&<p>Most recent verified booking: {activity.lastVerifiedBookedOn}.</p>}<p>Booking windows include today in the property’s time zone. Counts cover whole stays, regardless of the calendar month selected. Coverage includes stays ending after {activity.windows[45].start}. No import timestamps are used.</p><p>Read {etStamp(activity.observedAt)}. Use Refresh to update.</p></>:<p>Original reservation dates could not be verified. Calendar occupancy can still be available.</p>}
    </details>
  </section>;
}
