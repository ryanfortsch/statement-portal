/** Stay-length and arrival/departure sandbox. Never writes booking quotes or channel rates. */
import {z} from 'zod';
import {isIsoDay,nightsBetween,shiftIsoDay} from './sca-quotes-types.ts';
import {evidenceFresh} from './dynamic-pricing-evidence.ts';
import type {PricingPolicy,PricingPreview,PricingSnapshot} from './dynamic-pricing.ts';
export const pricingLengthOfStaySchema=z.array(z.object({nights:z.number().int().min(2).max(365),adjustmentPct:z.number().finite().min(-80).max(200)}).strict()).max(8).refine(v=>new Set(v.map(r=>r.nights)).size===v.length,'Stay-length thresholds must be unique');
const weekdays=z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(v=>new Set(v).size===v.length,'Duplicate weekdays');
export const pricingArrivalDepartureSchema=z.object({arrival:weekdays,departure:weekdays}).strict();
export type PricingStayRules={lengthOfStay:z.infer<typeof pricingLengthOfStaySchema>;arrivalDeparture:z.infer<typeof pricingArrivalDepartureSchema>};
export const defaultPricingStayRules=():PricingStayRules=>({lengthOfStay:[],arrivalDeparture:{arrival:[0,1,2,3,4,5,6],departure:[0,1,2,3,4,5,6]}});
export function previewPricingStay(snapshot:PricingSnapshot,preview:PricingPreview,policy:PricingPolicy,rules:PricingStayRules,arrival:string,departure:string){
  pricingLengthOfStaySchema.parse(rules.lengthOfStay);pricingArrivalDepartureSchema.parse(rules.arrivalDeparture);
  const valid=(s:string)=>isIsoDay(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
  if(!valid(arrival)||!valid(departure))throw Error('Choose valid arrival and departure dates');
  const nights=nightsBetween(arrival,departure);if(nights<1||nights>365)throw Error('Choose a stay of 1 to 365 nights');
  if(arrival<snapshot.today)throw Error('Arrival must be today or later');
  const errors:string[]=[],source=new Map(snapshot.days.map(d=>[d.date,d])),prices=new Map(preview.days.map(d=>[d.date,d])),now=new Date(snapshot.observedAt);
  const weekday=(s:string)=>new Date(s+'T12:00:00Z').getUTCDay();
  if(!rules.arrivalDeparture.arrival.includes(weekday(arrival)))errors.push('Arrival is not allowed on this weekday');
  if(!rules.arrivalDeparture.departure.includes(weekday(departure)))errors.push('Departure is not allowed on this weekday');
  const minNights=prices.get(arrival)?.minNights;
  if(minNights===null||minNights===undefined)errors.push('Arrival-night minimum stay is unavailable');
  else if(nights<minNights)errors.push(`Arrival requires at least ${minNights} nights`);
  const selected=rules.lengthOfStay.filter(r=>r.nights<=nights).sort((a,b)=>b.nights-a.nights)[0];
  let subtotalCents=0,totalCents=0,limitedNights=0,incomplete=0,reviewNights=0;
  for(let i=0;i<nights;i++){
    const date=shiftIsoDay(arrival,i),s=source.get(date),p=prices.get(date);
    if(!s||s.state!=='open'||s.protected||!evidenceFresh(s.observedAt,now)||p?.recommendedCents==null){incomplete++;continue;}
    if(!p.eligible)reviewNights++;
    const raw=Math.round(p.recommendedCents*(1+(selected?.adjustmentPct??0)/100));
    const net=Math.max(policy.floorCents,Math.min(policy.ceilingCents,raw));
    if(net!==raw)limitedNights++;subtotalCents+=p.recommendedCents;totalCents+=net;
  }
  if(reviewNights)errors.push(`${reviewNights} nightly recommendations need review in the calendar`);
  if(incomplete)errors.push(`${incomplete} ${incomplete===1?'night is':'nights are'} booked, blocked, protected or missing a fresh rate`);
  if(!incomplete&&totalCents<policy.minimumBookingCents)errors.push('Stay total is below your minimum booking value');
  return {nights,minNights,adjustmentPct:selected?.adjustmentPct??0,threshold:selected?.nights??null,limitedNights,subtotalCents:incomplete?null:subtotalCents,totalCents:incomplete?null:totalCents,errors,passes:errors.length===0};
}
