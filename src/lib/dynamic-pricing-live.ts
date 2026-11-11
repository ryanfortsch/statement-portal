import type {PricingSnapshot} from './dynamic-pricing.ts';
import {pricingOccupancyWindow,PRICING_WINDOWS,type PricingPortfolioHome,type PricingPortfolioRow} from './dynamic-pricing-portfolio.ts';
import {evidenceFresh} from './dynamic-pricing-evidence.ts';

export type PricingLiveHome=PricingPortfolioHome & {timezone:string};
export type PricingLiveCalendar={home:PricingLiveHome;snapshot:PricingSnapshot;source:string;sourceObservedAt:string|null};
export type PricingLivePortfolio={readAt:string;rows:PricingPortfolioRow[]};

/** Current asking rates, never fabricated base prices or booked ADR. Require every open night to be priced. */
export function pricingLiveRow(home:PricingLiveHome,snapshot:PricingSnapshot|null,now:Date,start:string):PricingPortfolioRow {
  const windows=Object.fromEntries(PRICING_WINDOWS.map(n=>[n,pricingOccupancyWindow(snapshot,start,n,now)])) as PricingPortfolioRow['windows'];
  const rates=Object.fromEntries(PRICING_WINDOWS.map(n=>{
    const w=windows[n],days=snapshot?.days.filter(d=>d.date>=w.start&&d.date<=w.end&&d.state==='open')??[];
    const complete=!w.unknown&&days.length>0&&days.every(d=>d.currentCents!==null&&Number.isFinite(d.currentCents)&&d.currentCents>0&&evidenceFresh(d.observedAt,now));
    return [n,complete?Math.round(days.reduce((sum,d)=>sum+d.currentCents!,0)/days.length):null];
  })) as NonNullable<PricingPortfolioRow['currentRateCents']>;
  // Explicit projection: registry names only, no public title, IDs from other systems, guest data or draft defaults.
  const stamps=snapshot?.days.map(d=>d.observedAt).filter(Boolean).sort()??[];
  return {id:home.id,name:home.name,city:home.city,bedrooms:home.bedrooms,authority:home.authority,
    mode:'shadow',configured:false,baseCents:null,floorCents:null,ceilingCents:null,currentRateCents:rates,
    observedAt:stamps[0]??null,marketObservedAt:null,marketSource:'',lastAppliedAt:null,
    error:snapshot?null:'Calendar unavailable',windows};
}

/** Never show a stale price as current, even in the property calendar. */
export function currentPricingSnapshot(snapshot:PricingSnapshot,now:Date):PricingSnapshot {
  return {today:snapshot.today,observedAt:snapshot.observedAt,lastBookedOn:null,market:[],days:snapshot.days.map(d=>
    evidenceFresh(snapshot.observedAt,now)&&evidenceFresh(d.observedAt,now)?d:{...d,state:'unknown',currentCents:null,minNights:null})};
}
