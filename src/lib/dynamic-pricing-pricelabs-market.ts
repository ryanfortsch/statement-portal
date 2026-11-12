/** PriceLabs' read-only MCP daily data. Never interpret narrative insights as measurements. */
import {z} from 'zod';
import {emptyPricingEvidence,marketNightSchema,pricingEvidenceSchema,type PricingEvidence} from './dynamic-pricing-evidence.ts';
import type {PricingLiveHome} from './dynamic-pricing-live.ts';

const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s);
const dates=z.array(date).min(1).max(800).refine(a=>new Set(a).size===a.length,'Duplicate market date');
const numbers=z.array(z.number().finite().nullable()).max(800);
const catalogSchema=z.object({success:z.literal(true),status_code:z.literal(200),data:z.object({listings:z.array(z.object({listing_id:z.string().min(1),pms_name:z.string().min(1)})).max(1000),total_listings:z.number().int().nonnegative()})});
export function priceLabsMarketCatalog(input:unknown){
  const {data}=catalogSchema.parse(input),keys=data.listings.map(l=>`${l.pms_name}:${l.listing_id}`);
  if(data.total_listings!==keys.length||new Set(keys).size!==keys.length)throw Error('Incomplete or duplicate PriceLabs listing catalog');
  return data.listings;
}
/** Exact PMS identifiers only; names and geography are never identity evidence. */
export function matchPriceLabsMarketHomes(input:unknown,homes:PricingLiveHome[]){
  const listings=priceLabsMarketCatalog(input);
  return listings.map(listing=>{
    const matches=listing.pms_name==='guesty'?homes.filter(h=>h.guestyListingId===listing.listing_id):[];
    if(matches.length>1)throw Error('PriceLabs listing maps to multiple Helm homes');
    return {...listing,home:matches[0]??null};
  });
}
const payloadSchema=z.object({success:z.literal(true),status_code:z.literal(200),data:z.object({
  data:z.object({
    compset_settings:z.object({selected_source:z.enum(['NL','MD','CCC']),selected_source_label:z.string().min(1).max(100),compset_size:z.number().int().positive(),br_range_selected:z.object({selected:z.array(z.number().int().nonnegative()).max(30)}).optional()}),
    initialize_detail:z.object({currency:z.literal('USD'),listing_id:z.string(),pms:z.string(),nd_source:z.string().min(1).max(30)}),
    future_prices:z.object({stay_dates:dates,market_price:numbers,market_25_percentile_prices:numbers,market_75_percentile_prices:numbers,market_90_percentile_prices:numbers,
      booked_50_percentile_price:numbers,num_bookings:numbers,final_price:numbers,
      events:z.tuple([z.array(z.array(date)),z.array(z.array(z.string().max(200)))]).optional(),
    }),
    occupancy:z.object({daily:z.object({period:dates,market_occupancy:numbers,market_occupancy_stly:numbers,market_occupancy_ly:numbers,pickup_7_days:numbers,pickup_7_days_stly:numbers})}),
  }),
  meta:z.object({listing:z.object({listing_id:z.string(),pms_name:z.string()}),initialize:z.object({http_status:z.literal(200),error:z.null()})}),
})});
export type PriceLabsMarketRead={listingId:string;pms:string;observedAt:string;today:string};
export function importPriceLabsMcpMarket(input:unknown,context:PriceLabsMarketRead,propertyId:string,previous?:PricingEvidence):PricingEvidence {
  const {data:{data,meta}}=payloadSchema.parse(input);
  if(meta.listing.listing_id!==context.listingId||meta.listing.pms_name!==context.pms||data.initialize_detail.listing_id!==context.listingId||data.initialize_detail.pms!==context.pms)throw Error('PriceLabs returned another listing');
  date.parse(context.today);z.string().datetime().parse(context.observedAt);
  if(previous&&previous.propertyId!==propertyId)throw Error('Previous research belongs to another home');
  if(previous?.marketObservedAt&&Date.parse(previous.marketObservedAt)>Date.parse(context.observedAt))throw Error('A newer market snapshot is already saved');
  const prices=data.future_prices,occupancy=data.occupancy.daily;
  for(const [key,values] of Object.entries(prices))if(key!=='events'&&values?.length!==prices.stay_dates.length)throw Error('Incomplete daily market price series');
  for(const values of Object.values(occupancy))if(values.length!==occupancy.period.length)throw Error('Incomplete daily occupancy series');
  const occupancyIndex=new Map(occupancy.period.map((d,i)=>[d,i])),events=new Map<string,string[]>();
  if(prices.events){
    const [days,names]=prices.events;
    if(days.length!==names.length)throw Error('Incomplete market events');
    days.forEach((group,i)=>group.forEach(day=>events.set(day,[...(events.get(day)??[]),...names[i]])));
  }
  const cents=(n:number|null)=>n===null||n===0?null:Math.round(n*100);
  const market=prices.stay_dates.flatMap((day,i)=>{
    if(day<context.today)return [];
    const j=occupancyIndex.get(day);if(j===undefined)throw Error('Occupancy dates do not cover daily market prices');
    return [marketNightSchema.parse({date:day,occupancyPct:occupancy.market_occupancy[j],sameTimeLastYearPct:occupancy.market_occupancy_stly[j],lastYearFinalPct:occupancy.market_occupancy_ly[j],
      pickup7Pct:occupancy.pickup_7_days[j],lastYearPickup7Pct:occupancy.pickup_7_days_stly[j],p25Cents:cents(prices.market_25_percentile_prices[i]),p50Cents:cents(prices.market_price[i]),p75Cents:cents(prices.market_75_percentile_prices[i]),p90Cents:cents(prices.market_90_percentile_prices[i]),
      bookedMedianCents:cents(prices.booked_50_percentile_price[i]),bookings:prices.num_bookings[i],vendorCents:cents(prices.final_price[i]),event:[...new Set(events.get(day)??[])].join('; '),lastYearAdrCents:null})];
  }).sort((a,b)=>a.date.localeCompare(b.date));
  if(!market.length||!market.some(d=>d.occupancyPct!==null)||!market.some(d=>d.p50Cents!==null))throw Error('No usable forward market data');
  const set=data.compset_settings,bedrooms=set.selected_source==='NL'?set.br_range_selected?.selected:undefined;
  if(set.selected_source==='NL'&&!bedrooms?.length)throw Error('Missing market bedroom selection');
  const source=`PriceLabs MCP · ${set.compset_size} ${set.selected_source_label}${bedrooms?.length?` · ${[...bedrooms].sort((a,b)=>a-b).join(',')} BR`:''} · ${data.initialize_detail.nd_source}`;
  return pricingEvidenceSchema.parse({...previous??emptyPricingEvidence(propertyId),marketSource:source,marketObservedAt:context.observedAt,market});
}
