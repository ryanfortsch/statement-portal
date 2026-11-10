/** Independent, inspectable estimates. Observational patterns are not causal elasticity. */
import { nightsBetween,shiftIsoDay } from './sca-quotes-types.ts';
import { pricingEvidenceSchema,evidenceFresh,type PricingEvidence,type HistoricalNight,type MarketNight } from './dynamic-pricing-evidence.ts';
export const MODEL_DATA_VERSION='helm-demand-1';
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const mean=(a:number[])=>a.reduce((s,n)=>s+n,0)/a.length;
export function median(a:number[]) { if(!a.length)return null;const s=[...a].sort((a,b)=>a-b),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2; }
const dow=(d:string)=>new Date(d+'T12:00:00Z').getUTCDay();
const month=(d:string)=>Number(d.slice(5,7))-1;
export function learnPriceShape(history:HistoricalNight[],asOf:string) {
  const valid=history.filter(h=>h.date<asOf&&h.date>=shiftIsoDay(asOf,-1095)&&h.state==='booked'&&h.rentCents!==null);
  const baseline=median(valid.map(n=>n.rentCents!));
  const monthCount=Array.from({length:12},(_,i)=>valid.filter(n=>month(n.date)===i).length);
  const monthsCovered=new Set(valid.map(n=>n.date.slice(0,7))).size;
  const qualified=valid.length>=90&&monthsCovered>=6;
  // Geometric shrinkage toward neutral protects sparse months; no extrapolated summer spike.
  const monthlyFactors=monthCount.map((count,i)=>{
    if(!qualified||count<7)return 1;
    const center=median(valid.filter(n=>month(n.date)===i).map(n=>n.rentCents!))!;
    return clamp(Math.exp(Math.log(center/baseline!)*count/(count+30)),0.5,2);
  });
  const weekdayFactors=Array.from({length:7},(_,i)=>{
    const residual=valid.filter(n=>dow(n.date)===i).map(n=>n.rentCents!/monthlyFactors[month(n.date)]/baseline!);
    return !qualified||residual.length<12?1:clamp(Math.exp(Math.log(median(residual)!)*residual.length/(residual.length+40)),0.7,1.4);
  });
  return {baseCents:qualified?Math.round(baseline!):null,monthlyFactors,weekdayFactors,monthCount,nights:valid.length,monthsCovered,qualified};
}
export type NightForecast={probability:number|null,low:number|null,high:number|null,samples:number,basis:string};
/** Historical chance of a currently unsold night selling AFTER this lead time.
 * Blocks/unknowns/undated bookings never become vacancies. No future stays in training.
 * This reconstructs net surviving bookings; cancelled stays/exposure changes remain a limitation.
 */
export function historicalPickup(history:HistoricalNight[],date:string,asOf:string):NightForecast {
  const lead=nightsBetween(asOf,date);
  const known=history.filter(n=>n.date<asOf&&n.date>=shiftIsoDay(asOf,-1095));
  const start=known.reduce((a,n)=>n.date<a?n.date:a,asOf),byDate=new Map(known.map(n=>[n.date,n]));
  const seasonalMatch=(d:string)=>{const delta=Math.abs(month(d)-month(date));return dow(d)===dow(date)&&Math.min(delta,12-delta)<=1;};
  const weekdayMatch=(d:string)=>dow(d)===dow(date);
  const cohort=(match:(d:string)=>boolean,basis:string)=>{
    let expected=0,missing=0;
    for(let d=start;d<asOf;d=shiftIsoDay(d,1))if(match(d)){expected++;if(!byDate.has(d)||byDate.get(d)!.state==='unknown')missing++;}
    const eligible=known.filter(n=>match(n.date)&&(n.state==='open'||n.state==='booked'));
    const booked=eligible.filter(n=>n.state==='booked'),undated=booked.filter(n=>n.bookedOn===null).length;
    if(!expected||missing/expected>0.1||booked.length&&undated/booked.length>0.05)return {rows:[],basis};
    return {rows:eligible.filter(n=>n.state==='open'||n.bookedOn!==null&&n.bookedOn>shiftIsoDay(n.date,-lead)),basis};
  };
  const options=[cohort(seasonalMatch,'seasonal weekday (±1 month)'),cohort(weekdayMatch,'pooled weekday')];
  const chosen=options.find(o=>o.rows.length>=20&&new Set(o.rows.map(n=>n.date.slice(0,7))).size>=3);
  if(!chosen)return {probability:null,low:null,high:null,samples:0,basis:'insufficient historical inventory'};
  const n=chosen.rows.length,k=chosen.rows.filter(n=>n.state==='booked').length,p=k/n;
  // Wilson interval describes sampling uncertainty only, not market/regime uncertainty.
  const z=1.96,denom=1+z*z/n,center=(p+z*z/(2*n))/denom,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/denom;
  return {probability:(k+1)/(n+2),low:Math.max(0,center-half),high:Math.min(1,center+half),samples:n,basis:chosen.basis};
}
export function marketForecast(m:MarketNight):NightForecast {
  if(m.occupancyPct===null||m.sameTimeLastYearPct===null||m.lastYearFinalPct===null||m.lastYearFinalPct<m.sameTimeLastYearPct)return {probability:null,low:null,high:null,samples:0,basis:'incomplete market baseline'};
  const booked=m.occupancyPct/100;
  if(booked>=1)return {probability:null,low:null,high:null,samples:0,basis:'market fully booked; no remaining-inventory estimate'};
  const final=clamp(m.lastYearFinalPct/100+0.5*(booked-m.sameTimeLastYearPct/100),booked,1);
  const conditional=(p:number)=>clamp((p-booked)/(1-booked),0,1);
  return {probability:conditional(final),low:conditional(final-0.1),high:conditional(final+0.1),samples:0,basis:'market pace scenario (±10-point final occupancy sensitivity)'};
}
export function marketPaceAdjustment(m:MarketNight) {
  const pace=m.occupancyPct!==null&&m.sameTimeLastYearPct!==null?m.occupancyPct-m.sameTimeLastYearPct:0;
  const pickup=m.pickup7Pct!==null&&m.lastYearPickup7Pct!==null?m.pickup7Pct-m.lastYearPickup7Pct:0;
  return clamp(0.5*pace+0.25*pickup,-20,15);
}
export function analyzePricingEvidence(input:PricingEvidence,today:string,now:Date) {
  const evidence=pricingEvidenceSchema.parse(input);
  const future=Date.parse(evidence.historyObservedAt??'')>now.getTime()||Date.parse(evidence.marketObservedAt??'')>now.getTime();
  if(future)throw Error('Evidence observation time cannot be in the future');
  const shape=learnPriceShape(evidence.history,today),marketFresh=evidenceFresh(evidence.marketObservedAt,now);
  const priced=evidence.market.filter(m=>m.date>=today&&m.p50Cents!==null);
  const marketCenter=priced.length>=180?median(priced.map(m=>m.p50Cents!)):null;
  return {shape,marketFresh,marketCenter,historyNights:evidence.history.length,marketNights:evidence.market.length,
    warnings:[...(!marketFresh&&evidence.market.length?['Market export is older than 36 hours. Market forecasts and pricing adjustments are disabled.']:[]),
      ...(!shape.qualified?['Learning a price shape needs 90 booked nights across at least six months with accommodation-only rates.']:[]),
      'Historical booking patterns are net of surviving reservations. They do not establish price elasticity or incremental revenue.']};
}
export function forecastNight(e:PricingEvidence,date:string,today:string,now:Date):NightForecast {
  const market=e.market.find(m=>m.date===date);
  if(market&&evidenceFresh(e.marketObservedAt,now)) {const f=marketForecast(market);if(f.probability!==null)return f;}
  return historicalPickup(e.history,date,today);
}
export function historicalSafetyFloor(e:PricingEvidence,date:string,asOf:string) {
  const anchor=shiftIsoDay(date,-364);
  const samples=e.history.filter(n=>n.date<asOf&&n.state==='booked'&&n.rentCents!==null&&dow(n.date)===dow(date)&&Math.abs(nightsBetween(anchor,n.date))<=7);
  return samples.length>=2?Math.round(mean(samples.map(n=>n.rentCents!))*1.1):null;
}
/** Walk-forward retrospective diagnostic: training dates strictly precede each cutoff.
 * Scores occupancy on OPEN-at-cutoff nights, not hypothetical revenue uplift.
 */
export function backtestOccupancy(history:HistoricalNight[],today:string) {
  return [7,30,90].map(lead=>{
    let squared=0,baselineSquared=0,predicted=0,actual=0,count=0;
    const tests=history.filter(n=>n.date<today&&n.date>=shiftIsoDay(today,-90)&&(n.state==='open'||n.state==='booked'&&n.bookedOn!==null));
    for(const n of tests) {
      const asOf=shiftIsoDay(n.date,-lead);
      if(n.bookedOn&&n.bookedOn<=asOf)continue;
      const f=historicalPickup(history,n.date,asOf);if(f.probability===null)continue;
      const y=n.state==='booked'?1:0;
      squared+=(f.probability-y)**2;baselineSquared+=y;predicted+=f.probability;actual+=y;count++;
    }
    return {lead,count,brier:count?squared/count:null,noPickupBrier:count?baselineSquared/count:null,predictedPct:count?100*predicted/count:null,actualPct:count?100*actual/count:null};
  });
}
/** Explicit elasticity SCENARIO. Not fitted from asking prices or surviving bookings. */
export function priceResponseScenario(referenceCents:number,probability:number,elasticity:number,floor:number,ceiling:number) {
  if(!(referenceCents>0&&probability>=0&&probability<=1&&elasticity>=0.2&&elasticity<=8&&floor>0&&ceiling>=floor))throw Error('Invalid scenario assumptions');
  const odds=clamp(probability,0.001,0.999)/(1-clamp(probability,0.001,0.999));
  const points=Array.from({length:41},(_,i)=>{const cents=Math.round(floor+(ceiling-floor)*i/40),adjustedOdds=odds*(cents/referenceCents)**(-elasticity),p=probability===0?0:probability===1?1:adjustedOdds/(1+adjustedOdds);return {cents,probability:p,expectedCents:Math.round(cents*p)};});
  return {points,best:points.reduce((a,b)=>b.expectedCents>a.expectedCents?b:a)};
}

/** Bellman recursion over explicit conditional booking opportunities. The model does
 * not learn elasticity from this calculation; these are labeled scenario inputs. */
export function optimizeRatePath(referenceCents:number,floor:number,ceiling:number,windows:{leadDays:number;probability:number;elasticity:number}[]) {
  if(!windows.length||windows.length>30||windows.some((w,i)=>!Number.isInteger(w.leadDays)||w.leadDays<0||i>0&&w.leadDays>=windows[i-1].leadDays))throw Error('Booking windows must be unique and descend toward arrival');
  let continuation=0;
  const path=[];
  for(const window of [...windows].reverse()) {
    const points=priceResponseScenario(referenceCents,window.probability,window.elasticity,floor,ceiling).points;
    const scored=points.map(p=>({...p,value:p.cents*p.probability+(1-p.probability)*continuation}));
    const best=scored.reduce((a,b)=>b.value>a.value?b:a);
    continuation=best.value;path.unshift({leadDays:window.leadDays,cents:best.cents,saleProbability:best.probability,expectedCents:Math.round(continuation)});
  }
  return {path,expectedCents:Math.round(continuation)};
}
