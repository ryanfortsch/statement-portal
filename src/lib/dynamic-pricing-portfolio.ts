/** Read-only portfolio metrics. Never infer bookings from blocks or missing dates. */
import type {PricingPolicy, PricingSnapshot} from './dynamic-pricing.ts';
import {evidenceFresh} from './dynamic-pricing-evidence.ts';
import {shiftIsoDay} from './sca-quotes-types.ts';
import type {PricingBookingActivity} from './dynamic-pricing-activity.ts';

export const PRICING_WINDOWS = [7,30,60,90] as const;
export type PricingWindowDays = typeof PRICING_WINDOWS[number];
export const PRICING_SORTS = ['name','occupancy','occupancy30','occupancy60','occupancy90','market','gap','open','rate','base','floor','ceiling','connection','booked7','booked45'] as const;
export type PricingPortfolioSort = typeof PRICING_SORTS[number];
export type PricingPortfolioView = {window:PricingWindowDays;query:string;filter:'all'|'below'|'data';sort:PricingPortfolioSort;direction:'asc'|'desc';connection:'all'|'shadow'|'helm_direct'};
export function pricingPortfolioView(params:Record<string,string|string[]|undefined>={}):PricingPortfolioView {
  const period=Number(params.period);
  const sort=PRICING_SORTS.includes(params.sort as PricingPortfolioSort)?params.sort as PricingPortfolioSort:'name';
  return {window:PRICING_WINDOWS.includes(period as PricingWindowDays)?period as PricingWindowDays:30,
    query:typeof params.q==='string'?params.q.slice(0,120):'',
    filter:params.filter==='below'||params.filter==='data'?params.filter:'all',
    sort,direction:params.direction==='asc'||params.direction==='desc'?params.direction:sort==='open'?'desc':'asc',
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
  if(view.direction!==(view.sort==='open'?'desc':'asc'))params.set('direction',view.direction);
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
  guestyListingId?:string|null;
};
export type PricingPortfolioRow = PricingPortfolioHome & {
  mode:'shadow'|'helm_direct'; configured:boolean; baseCents:number|null; floorCents:number|null; ceilingCents:number|null;
  observedAt:string|null; marketObservedAt:string|null; marketSource:string; lastAppliedAt:string|null;
  currentRateCents?:Record<PricingWindowDays,number|null>;
  activity?:PricingBookingActivity;
  error:string|null; windows:Record<PricingWindowDays,PricingWindow>;
};

/** An open dashboard cannot keep an expired benchmark looking current. */
export function expirePricingMarketRows(rows:PricingPortfolioRow[],now:Date):PricingPortfolioRow[] {
  return rows.map(row=>!row.marketSource||evidenceFresh(row.marketObservedAt,now)?row:{...row,
    windows:Object.fromEntries(PRICING_WINDOWS.map(n=>[n,{...row.windows[n],marketPct:null,gapPp:null,marketIssue:'stale'}])) as PricingPortfolioRow['windows'],
  });
}

/** Missing measurements stay last in either direction; ties have a stable natural-name order. */
export function sortPricingPortfolioRows(rows:PricingPortfolioRow[],view:Pick<PricingPortfolioView,'sort'|'direction'|'window'>):PricingPortfolioRow[] {
  const text=(a:string,b:string)=>a.localeCompare(b,'en',{numeric:true,sensitivity:'base'});
  const value=(row:PricingPortfolioRow):string|number|null=>{
    const w=row.windows[view.window];
    switch(view.sort) {
      case 'name':return row.name;
      case 'occupancy30':return row.windows[30].occupancyPct;
      case 'occupancy60':return row.windows[60].occupancyPct;
      case 'occupancy90':return row.windows[90].occupancyPct;
      case 'connection':return row.mode==='helm_direct'?'Helm direct':'Compare only';
      case 'rate':return row.currentRateCents?.[view.window]??null;
      case 'booked7':case 'booked45':{
        const activity=row.activity,n=view.sort==='booked7'?7:45;
        // Incomplete counts are not comparable with complete counts.
        return activity&&!activity.undatedStays?activity.windows[n].nights:null;
      }
      case 'base':return row.baseCents;
      case 'floor':return row.floorCents;
      case 'ceiling':return row.ceilingCents;
      case 'market':return w.marketPct;
      case 'gap':return w.gapPp;
      case 'open':return w.unknown?null:w.open;
      default:return w.occupancyPct;
    }
  };
  return [...rows].sort((a,b)=>{
    const av=value(a),bv=value(b),tie=text(a.name,b.name)||text(a.id,b.id);
    if(av===null||bv===null)return av===bv?tie:av===null?1:-1;
    const order=typeof av==='string'&&typeof bv==='string'?text(av,bv):Number(av)-Number(bv);
    return order*(view.direction==='desc'?-1:1)||tie;
  });
}
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
