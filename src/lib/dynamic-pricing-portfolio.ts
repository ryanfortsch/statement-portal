/** Read-only portfolio metrics. Never infer bookings from blocks or missing dates. */
import type {PricingPolicy, PricingSnapshot} from './dynamic-pricing.ts';
import {evidenceFresh} from './dynamic-pricing-evidence.ts';
import {shiftIsoDay} from './sca-quotes-types.ts';

export const PRICING_WINDOWS = [7,30,60,90] as const;
export type PricingWindowDays = typeof PRICING_WINDOWS[number];
export type PricingPortfolioView = {window:PricingWindowDays;query:string;filter:'all'|'below'|'data';sort:'name'|'occupancy'|'gap'|'open';connection:'all'|'shadow'|'helm_direct'};
export function pricingPortfolioView(params:Record<string,string|string[]|undefined>={}):PricingPortfolioView {
  const period=Number(params.period);
  return {window:PRICING_WINDOWS.includes(period as PricingWindowDays)?period as PricingWindowDays:30,
    query:typeof params.q==='string'?params.q.slice(0,120):'',
    filter:params.filter==='below'||params.filter==='data'?params.filter:'all',
    sort:params.sort==='occupancy'||params.sort==='gap'||params.sort==='open'?params.sort:'name',
    connection:params.connection==='shadow'||params.connection==='helm_direct'?params.connection:'all'};
}
/** Only local pricing links; preserve the dashboard view when opening and leaving a home. */
export function pricingPortfolioHref(view:PricingPortfolioView,property?:string):string {
  const params=new URLSearchParams();
  if(property)params.set('property',property);
  if(view.window!==30)params.set('period',String(view.window));
  if(view.query)params.set('q',view.query);
  if(view.filter!=='all')params.set('filter',view.filter);
  if(view.sort!=='name')params.set('sort',view.sort);
  if(view.connection!=='all')params.set('connection',view.connection);
  return '/channels/pricing'+(params.size?'?'+params.toString():'');
}
export type PricingWindow = {
  start:string; end:string; nights:number; booked:number; open:number; blocked:number; unknown:number;
  bookable:number; occupancyPct:number|null; marketPct:number|null; gapPp:number|null;
  marketIssue:'missing'|'stale'|'partial'|null;
};
export type PricingPortfolioHome = {
  id:string; name:string; city:string; bedrooms:number|null; authority:'helm'|'guesty';
};
export type PricingPortfolioRow = PricingPortfolioHome & {
  mode:'shadow'|'helm_direct'; configured:boolean; baseCents:number|null; floorCents:number|null; ceilingCents:number|null;
  observedAt:string|null; marketObservedAt:string|null; marketSource:string; lastAppliedAt:string|null;
  error:string|null; windows:Record<PricingWindowDays,PricingWindow>;
};
export type PortfolioPricingInput = {
  snapshot:PricingSnapshot; policy:PricingPolicy;
  profile:{mode:'shadow'|'helm_direct'}|null;
  runs:{status:string; applied_at:string|null}[];
};

export function pricingOccupancyWindow(snapshot:PricingSnapshot|null,start:string,nights:PricingWindowDays,now:Date):PricingWindow {
  const result:PricingWindow={start,end:shiftIsoDay(start,nights-1),nights,booked:0,open:0,blocked:0,unknown:0,
    bookable:0,occupancyPct:null,marketPct:null,gapPp:null,marketIssue:'missing'};
  const days=new Map(snapshot?.days.map(d=>[d.date,d]));
  if(snapshot&&days.size!==snapshot.days.length)throw Error('Duplicate calendar date');
  const evidence=snapshot?.evidence,market=new Map(evidence?.market.map(d=>[d.date,d]));
  if(evidence&&market.size!==evidence.market.length)throw Error('Duplicate market date');
  let marketTotal=0,marketCount=0;
  for(let offset=0;offset<nights;offset++) {
    const date=shiftIsoDay(start,offset),day=days.get(date);
    if(!day||day.state==='unknown'||!evidenceFresh(snapshot?.observedAt??null,now)||!evidenceFresh(day.observedAt,now)) {result.unknown++;continue;}
    if(day.state==='blocked'){result.blocked++;continue;}
    result.bookable++;
    if(day.state==='booked')result.booked++;else result.open++;
    const pct=market.get(date)?.occupancyPct;
    if(pct!=null&&Number.isFinite(pct)&&pct>=0&&pct<=100){marketTotal+=pct;marketCount++;}
  }
  // A partial calendar cannot turn into a reassuring percentage. Closed homes have no denominator.
  if(!result.unknown&&result.bookable)result.occupancyPct=100*result.booked/result.bookable;
  if(!result.unknown&&!result.bookable){result.marketIssue=null;return result;}
  result.marketIssue=!evidence?.market.length||!evidence.marketSource?'missing':
    !evidenceFresh(evidence.marketObservedAt,now)?'stale':marketCount!==result.bookable||!result.bookable?'partial':null;
  if(result.occupancyPct!==null&&!result.marketIssue) {
    // Compare the same dates the home offers for sale. Deliberate blocks weight neither side.
    result.marketPct=marketTotal/marketCount;
    result.gapPp=result.occupancyPct-result.marketPct;
  }
  return result;
}

export function pricingPortfolioRow(home:PricingPortfolioHome,input:PortfolioPricingInput|null,start:string,now:Date):PricingPortfolioRow {
  if(input?.snapshot.evidence&&input.snapshot.evidence.propertyId!==home.id)throw Error('Market evidence belongs to another property');
  const windows=Object.fromEntries(PRICING_WINDOWS.map(n=>[n,pricingOccupancyWindow(input?.snapshot??null,start,n,now)])) as PricingPortfolioRow['windows'];
  return {id:home.id,name:home.name,city:home.city,bedrooms:home.bedrooms,authority:home.authority,
    mode:home.authority==='helm'&&input?.profile?.mode==='helm_direct'?'helm_direct':'shadow',configured:!!input?.profile,
    baseCents:input?.policy.baseCents??null,floorCents:input?.policy.floorCents??null,ceilingCents:input?.policy.ceilingCents??null,
    observedAt:input?.snapshot.observedAt??null,marketObservedAt:input?.snapshot.evidence?.marketObservedAt??null,
    marketSource:input?.snapshot.evidence?.marketSource??'',lastAppliedAt:input?.runs.find(r=>r.status==='applied')?.applied_at??null,
    error:input?null:'Pricing data unavailable',windows};
}

/** Weighted by bookable home-nights, with the exact same homes/dates on both sides of a comparison. */
export function pricingPortfolioTotals(rows:PricingPortfolioRow[],window:PricingWindowDays) {
  const available=rows.map(r=>r.windows[window]).filter(w=>!w.unknown),
    comparable=available.filter(w=>w.occupancyPct!==null&&w.marketPct!==null),
    bookable=available.reduce((n,w)=>n+w.bookable,0),booked=available.reduce((n,w)=>n+w.booked,0),
    comparedNights=comparable.reduce((n,w)=>n+w.bookable,0);
  const comparedOccupancyPct=comparedNights?100*comparable.reduce((n,w)=>n+w.booked,0)/comparedNights:null;
  const marketPct=comparedNights?comparable.reduce((n,w)=>n+w.marketPct!*w.bookable,0)/comparedNights:null;
  return {homes:rows.length,currentHomes:available.length,comparableHomes:comparable.length,bookable,booked,
    open:available.reduce((n,w)=>n+w.open,0),blocked:available.reduce((n,w)=>n+w.blocked,0),
    occupancyPct:bookable?100*booked/bookable:null,comparedOccupancyPct,marketPct,
    gapPp:comparedOccupancyPct!==null&&marketPct!==null?comparedOccupancyPct-marketPct:null,
    belowMarket:comparable.filter(w=>w.gapPp!==null&&w.gapPp<0).length};
}
