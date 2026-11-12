/** Recent booking activity, reduced to aggregates before it leaves the server. */
import {dateInZone} from './dynamic-pricing-inputs.ts';
import {shiftIsoDay} from './sca-quotes-types.ts';

export const PRICING_ACTIVITY_WINDOWS=[7,45] as const;
export type PricingActivityWindow=typeof PRICING_ACTIVITY_WINDOWS[number];
export type PricingBookingActivity={
  observedAt:string;today:string;source:'Helm bookings';
  verifiedStays:number;undatedStays:number;lastVerifiedBookedOn:string|null;
  windows:Record<PricingActivityWindow,{start:string;end:string;bookings:number;nights:number}>;
};
export type PricingActivityBooking={
  id:string;status:string;duplicate_of:string|null;source:string;external_confirmation_code:string|null;
  check_in:string;check_out:string;booked_at:string|null;
};
export type PricingActivityTimestamp={confirmation_code:string|null;check_in:string|null;check_out:string|null;booked_at:string|null};
const code=(s:string|null)=>s?.trim().toUpperCase()||null;
function validDay(s:string|null):s is string {
  return !!s&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
}
function bookingDay(stamp:string|null,zone:string,now:Date):string|null {
  // Offset-bearing timestamps only. Local/invalid/future stamps cannot imply demand.
  if(!stamp||!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(stamp)||!validDay(stamp.slice(0,10)))return null;
  const date=new Date(stamp);return Number.isFinite(date.getTime())&&date<=now?dateInZone(date,zone):null;
}

/**
 * Canonical confirmed/completed stays govern status; Guesty supplies only the
 * original confirmation/creation date, joined by exact code AND stay dates.
 * Never use iCal booked_at: it can be first-import time minus 25 hours.
 * Manual entry time is also not proof of when a guest made a reservation.
 * This is surviving bookings received recently, not net pickup or STLY pace.
 */
export function pricingBookingActivity(bookings:PricingActivityBooking[],timestamps:PricingActivityTimestamp[],zone:string,now:Date):PricingBookingActivity {
  const today=dateInZone(now,zone),start=shiftIsoDay(today,-44);
  const result:PricingBookingActivity={observedAt:now.toISOString(),today,source:'Helm bookings',verifiedStays:0,undatedStays:0,lastVerifiedBookedOn:null,
    windows:{7:{start:shiftIsoDay(today,-6),end:today,bookings:0,nights:0},45:{start,end:today,bookings:0,nights:0}}};
  const lookup=new Map<string,PricingActivityTimestamp[]>();
  for(const t of timestamps){const c=code(t.confirmation_code);if(c){const key=JSON.stringify([c,t.check_in,t.check_out]);lookup.set(key,[...(lookup.get(key)??[]),t]);}}
  const seen=new Map<string,PricingActivityBooking>();
  for(const b of bookings){
    if(b.duplicate_of||!['confirmed','completed'].includes(b.status.toLowerCase()))continue;
    if(!validDay(b.check_in)||!validDay(b.check_out)||b.check_out<=b.check_in)throw Error('Invalid booking dates');
    if(b.check_out<=start)continue;
    const c=code(b.external_confirmation_code),identity=c??b.id,prior=seen.get(identity);
    if(prior){
      if(prior.check_in!==b.check_in||prior.check_out!==b.check_out||prior.source!==b.source||prior.booked_at!==b.booked_at)throw Error('Ambiguous canonical stay');
      continue;
    }
    seen.set(identity,b);
    const matching=c?lookup.get(JSON.stringify([c,b.check_in,b.check_out]))??[]:[];
    const days=new Set(matching.map(t=>bookingDay(t.booked_at,zone,now)));
    // Conflicting or absent original dates stay unknown, even when another copy is dated.
    const bookedOn=b.source==='direct_booking'?bookingDay(b.booked_at,zone,now):days.size===1?[...days][0]:null;
    if(!bookedOn||bookedOn>=b.check_out){result.undatedStays++;continue;}
    result.verifiedStays++;
    if(!result.lastVerifiedBookedOn||bookedOn>result.lastVerifiedBookedOn)result.lastVerifiedBookedOn=bookedOn;
    const nights=Math.round((Date.parse(b.check_out)-Date.parse(b.check_in))/86400000);
    for(const n of PRICING_ACTIVITY_WINDOWS)if(bookedOn>=result.windows[n].start){result.windows[n].bookings++;result.windows[n].nights+=nights;}
  }
  return result;
}

/** A partial positive count is a lower bound; partial zero is unknown, never zero demand. */
export function pricingActivityValue(activity:PricingBookingActivity|undefined,window:PricingActivityWindow,metric:'nights'|'bookings'='nights'):string {
  if(!activity)return '–';const value=activity.windows[window][metric];
  return activity.undatedStays?value?`≥${value}`:'–':String(value);
}
export function pricingActivityDescription(activity:PricingBookingActivity|undefined,window:PricingActivityWindow):string {
  if(!activity)return 'Booking dates unavailable.';
  const w=activity.windows[window];
  return `${w.start}–${w.end}: ${w.nights} nights across ${w.bookings} verified bookings, for any stay dates. ${activity.undatedStays?`${activity.undatedStays} stays have no verified booking date; shown counts are minimums.`:'All scoped stays have verified booking dates.'} Cancelled bookings and blocks excluded. Based on current Helm records; not net pickup.`;
}
