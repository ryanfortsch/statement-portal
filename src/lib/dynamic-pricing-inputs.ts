import { buildAvailability, type AvailabilityBooking } from './availability.ts';
import type { RateDayRow, RatePlanRow } from './rate-plan.ts';
import { shiftIsoDay } from './sca-quotes-types.ts';
import { pricingEvidenceSchema, type PricingEvidence } from './dynamic-pricing-evidence.ts';
import type { PricingSnapshot } from './dynamic-pricing.ts';

/** Only operational calendar fields; no guest identities or booking financials. */
export type PricingContext = {
  property: { id: string; calendar_authority: string; is_active: boolean; timezone: string | null };
  evidence?:{data:PricingEvidence;version:number}|null;
  plan: RatePlanRow | null;
  rateDays: RateDayRow[];
  periods: { start_month: number; start_day: number; end_month: number; end_day: number }[];
  bookings: (AvailabilityBooking & { booked_at: string | null })[];
  mirror: { date: string; status: string; price: number | null; currency: string | null; min_nights: number | null; synced_at: string }[];
};
export function dateInZone(now: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function pricingSnapshot(context: PricingContext, start: string, count: number, now: Date): PricingSnapshot {
  if (!Number.isInteger(count) || count < 60 || count > 500) throw Error('Choose 60–500 nights');
  const observedAt=now.toISOString(), end=shiftIsoDay(start,count-1), days=new Map(context.rateDays.map(d=>[d.date,d]));
  // booked_at on imported stays has historically been backfilled from first_seen_at.
  // Do not misrepresent import timestamps as booking demand. Recency remains unknown.
  const snapshot:PricingSnapshot={ today:start,observedAt,lastBookedOn:null,market:[],days:[] };
  if(context.property.calendar_authority==='helm') {
    snapshot.days=buildAvailability({bookings:context.bookings,plan:context.plan,rateDays:days,
      rentalPeriods:context.periods.map(p=>({startMonth:p.start_month,startDay:p.start_day,endMonth:p.end_month,endDay:p.end_day})),
      start,end,now,timeZone:context.property.timezone??'America/New_York'}).map(d=>({date:d.date,
      state:d.reserved?'booked':d.available?'open':'blocked',currentCents:d.price && d.price>0 ? Math.round(d.price*100):null,
      minNights:d.minNights??null,protected:days.get(d.date)?.source==='operator',observedAt}));
  } else {
    const mirror=new Map(context.mirror.map(d=>[d.date,d]));
    snapshot.days=Array.from({length:count},(_,i)=>{
      const date=shiftIsoDay(start,i), d=mirror.get(date), usd=d?.currency==='USD';
      return {date,state:!d?'unknown':d.status==='booked'?'booked':d.status==='available'?'open':d.status==='unavailable'?'blocked':'unknown',
        currentCents:usd && d?.price && Number(d.price)>0?Math.round(Number(d.price)*100):null,
        minNights:d?.min_nights??null,protected:false,observedAt:d?.synced_at?new Date(d.synced_at).toISOString():observedAt};
    });
  }
  if(context.evidence) {
    const evidence=pricingEvidenceSchema.parse(context.evidence.data);
    if(evidence.propertyId!==context.property.id)throw Error('Evidence belongs to another property');
    snapshot.evidence=evidence;
  }
  return snapshot;
}
