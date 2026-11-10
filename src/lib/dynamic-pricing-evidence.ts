/** Portable, property-scoped evidence. No credentials, guest names or payout fields. */
import { z } from 'zod';
import Papa from 'papaparse';
const day=z.string().refine(s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s,'Invalid date');
const price=z.number().int().min(100).max(10000000).nullable();
const percent=z.number().min(0).max(100).nullable();
export const historicalNightSchema=z.object({date:day,state:z.enum(['open','booked','blocked','unknown']),bookedOn:day.nullable(),rentCents:price}).strict()
  .refine(n=>n.bookedOn===null||(n.state==='booked'&&n.bookedOn<=n.date),'Booking date must precede a booked night');
export const marketNightSchema=z.object({date:day,occupancyPct:percent,sameTimeLastYearPct:percent,lastYearFinalPct:percent,
  pickup7Pct:z.number().min(-100).max(100).nullable(),lastYearPickup7Pct:z.number().min(-100).max(100).nullable(),
  p25Cents:price,p50Cents:price,p75Cents:price,p90Cents:price,bookedMedianCents:price,bookings:z.number().int().nonnegative().nullable(),
  vendorCents:price,event:z.string().max(200),lastYearAdrCents:price,
}).strict().refine(m=>[m.p25Cents,m.p50Cents,m.p75Cents,m.p90Cents].filter((v):v is number=>v!==null).every((v,i,a)=>i===0||v>=a[i-1]),'Market percentiles must be ordered');
export const pricingEvidenceSchema=z.object({version:z.literal(1),propertyId:z.string().min(1).max(100),currency:z.literal('USD'),
  marketSource:z.string().max(160),marketObservedAt:z.string().datetime().nullable(),
  historySource:z.string().max(160),historyObservedAt:z.string().datetime().nullable(),
  history:z.array(historicalNightSchema).max(1500),market:z.array(marketNightSchema).max(500),
}).strict().superRefine((e,c)=>{
  for(const key of ['history','market'] as const) if(new Set(e[key].map(n=>n.date)).size!==e[key].length)c.addIssue({code:'custom',message:`Duplicate ${key} date`});
  if(e.market.length&&(!e.marketSource||!e.marketObservedAt))c.addIssue({code:'custom',message:'Market source and observation time required'});
  if(e.history.length&&(!e.historySource||!e.historyObservedAt))c.addIssue({code:'custom',message:'History source and observation time required'});
});
export type PricingEvidence=z.infer<typeof pricingEvidenceSchema>;
export type HistoricalNight=z.infer<typeof historicalNightSchema>;
export type MarketNight=z.infer<typeof marketNightSchema>;
export const emptyPricingEvidence=(propertyId:string):PricingEvidence=>({version:1,propertyId,currency:'USD',marketSource:'',marketObservedAt:null,historySource:'',historyObservedAt:null,history:[],market:[]});
function records(csv:string,required:string[]) {
  if(csv.length>1500000)throw Error('Choose a CSV smaller than 1.5 MB');
  const parsed=Papa.parse<Record<string,string>>(csv,{header:true,skipEmptyLines:'greedy',transformHeader:h=>h.trim()});
  if(parsed.errors.length)throw Error('CSV is malformed; check columns and quoting');
  if(!required.every(h=>parsed.meta.fields?.includes(h)))throw Error(`CSV must contain: ${required.join(', ')}. Choose a daily export, not monthly totals.`);
  return parsed.data;
}
function numeric(value:string|undefined):number|null {
  if(value==null||value.trim()===''||value==='NA'||value==='N/A')return null;
  const n=Number(value);if(!Number.isFinite(n))throw Error('CSV contains an invalid numeric value');return n;
}
const dollars=(s:string|undefined)=>{const n=numeric(s);return n===null||n===0?null:Math.round(n*100);};
/** Observed PriceLabs daily Neighborhood Data export, not their proprietary model. */
export function importPriceLabsMarket(csv:string):MarketNight[] {
  const rows=records(csv,['Date','Market Occupancy','Market 50th Percentile Price']);
  if(rows.length>500)throw Error('At most 500 daily market rows are supported');
  return rows.map(r=>marketNightSchema.parse({date:r.Date,occupancyPct:numeric(r['Market Occupancy']),sameTimeLastYearPct:numeric(r['Market occupancy (last year today)']),lastYearFinalPct:numeric(r['Market occupancy (last year final)']),
    pickup7Pct:numeric(r['7-day market pickup']),lastYearPickup7Pct:numeric(r['7-day market pickup (last year today)']),
    p25Cents:dollars(r['Market 25th Percentile Price']),p50Cents:dollars(r['Market 50th Percentile Price']),p75Cents:dollars(r['Market 75th Percentile Price']),p90Cents:dollars(r['Market 90th Percentile Price']),
    bookedMedianCents:dollars(r['Median Booked Price']),bookings:numeric(r['Number of Bookings']),vendorCents:dollars(r['Final Price']),event:r['Holiday/Event']??'',lastYearAdrCents:dollars(r['Last Year Booking'])}));
}
export function importPricingHistory(csv:string):HistoricalNight[] {
  const rows=records(csv,['date','state','booked_on','rent_cents']);
  if(rows.length>1500)throw Error('At most 1,500 historical nights are supported');
  return rows.map(r=>historicalNightSchema.parse({date:r.date,state:r.state,bookedOn:r.booked_on||null,rentCents:numeric(r.rent_cents)}));
}
export function evidenceFresh(stamp:string|null,now:Date,hours=36) {
  if(!stamp)return false;const age=now.getTime()-Date.parse(stamp);return Number.isFinite(age)&&age>=0&&age<=hours*3600000;
}
