import 'server-only';
import {randomUUID} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createClient} from '@supabase/supabase-js';
import {readPricingLiveHomes} from './dynamic-pricing-live.server.ts';
import {readPricingResearch,savePricingResearch} from './dynamic-pricing-research.server.ts';
import {dateInZone} from './dynamic-pricing-inputs.ts';
import {importPriceLabsMcpMarket,matchPriceLabsMarketHomes,PriceLabsMarketUnavailable} from './dynamic-pricing-pricelabs-market.ts';
import {createPriceLabsMarketClient} from './pricelabs-market-client.server.ts';
import {openPriceLabsCredentials,sealPriceLabsCredentials,renewPriceLabsCredentials,type PriceLabsCredentials} from './pricelabs-credentials.server.ts';

type Lease={ciphertext:string;cursor:string|null};
type Report={status:'complete'|'partial'|'failed';matched:number;unmatched:number;missing:number;fresh:number;saved:number;unavailable:number;failed:number;conflicts:number;deferred:number;nights:number};
type Dependencies={
  claim:(id:string)=>Promise<Lease|null>;
  open:(ciphertext:string)=>PriceLabsCredentials;
  renew:(value:PriceLabsCredentials)=>Promise<PriceLabsCredentials>;
  rotate:(id:string,value:PriceLabsCredentials)=>Promise<void>;
  finish:(id:string,report:Report,cursor:string|null)=>Promise<void>;
  client:(value:PriceLabsCredentials)=>Promise<Awaited<ReturnType<typeof createPriceLabsMarketClient>>>;
  homes:()=>ReturnType<typeof readPricingLiveHomes>;
  read:(id:string)=>ReturnType<typeof readPricingResearch>;
  save:(input:unknown)=>ReturnType<typeof savePricingResearch>;
  now:()=>Date;
};

/** Only research writes. A failed or interrupted read never refreshes its timestamp. */
export async function refreshPriceLabsMarkets(deps:Dependencies,signal:AbortSignal):Promise<Report|{status:'skipped'}> {
  const leaseId=randomUUID(),lease=await deps.claim(leaseId);
  if(!lease)return {status:'skipped'};
  const report:Report={status:'complete',matched:0,unmatched:0,missing:0,fresh:0,saved:0,unavailable:0,failed:0,conflicts:0,deferred:0,nights:0};
  let cursor=lease.cursor;
  try {
    signal.throwIfAborted();
    const initial=deps.open(lease.ciphertext),credentials=await deps.renew(initial);
    // Persist a rotated refresh token before making any market requests. A lost
    // rotation response fails closed; never continue using unconfirmed secrets.
    if(JSON.stringify(credentials)!==JSON.stringify(initial))await deps.rotate(leaseId,credentials);
    signal.throwIfAborted();
    const client=await deps.client(credentials),homes=await deps.homes();
    const matches=matchPriceLabsMarketHomes(await client.listings(),homes);
    const sorted=matches.filter(m=>m.home!==null).sort((a,b)=>a.home!.id.localeCompare(b.home!.id));
    report.matched=sorted.length;report.unmatched=matches.length-sorted.length;report.missing=homes.length-sorted.length;
    const after=sorted.findIndex(m=>m.home!.id===cursor)+1,ordered=[...sorted.slice(after),...sorted.slice(0,after)];
    let next=0;
    await Promise.all(Array.from({length:Math.min(2,ordered.length)},async()=>{
      while(next<ordered.length&&!signal.aborted){
        const match=ordered[next++],home=match.home!;cursor=home.id;
        try {
          const previous=await deps.read(home.id);if(!previous.ok)throw Error('Research unavailable');
          const now=deps.now(),observed=Date.parse(previous.value?.data.marketObservedAt??'');
          // Refresh roughly daily; six-hour ticks also retry transient failures.
          // Fresh manually imported evidence is protected by the same threshold.
          if(previous.value?.data.market.length&&Number.isFinite(observed)&&now.getTime()-observed<18*3600000){report.fresh++;continue;}
          signal.throwIfAborted();
          const observedAt=now.toISOString(),payload=await client.market(match.listing_id,match.pms_name);
          signal.throwIfAborted();
          const data=importPriceLabsMcpMarket(payload,{listingId:match.listing_id,pms:match.pms_name,observedAt,today:dateInZone(now,home.timezone)},home.id,previous.value?.data);
          const saved=await deps.save({propertyId:home.id,version:previous.value?.version??0,requestId:randomUUID(),data});
          if(!saved.ok){if(saved.conflict)report.conflicts++;else report.failed++;}
          else{report.saved++;report.nights+=data.market.length;}
        }catch(error){
          if(signal.aborted)report.deferred++;
          else if(error instanceof PriceLabsMarketUnavailable)report.unavailable++;
          else report.failed++;
        }
      }
    }));
    report.deferred+=ordered.length-next;
    if(report.failed||report.conflicts||report.deferred)report.status='partial';
  }catch{report.status='failed';report.failed++;}
  // A separate short database timeout leaves room to release the lease after
  // the import deadline. A killed function instead recovers at lease expiry.
  await deps.finish(leaseId,report,cursor);
  return report;
}

export function marketDatabaseFetch(signal?:AbortSignal):typeof fetch {
  return (input,init)=>fetch(input,{...init,signal:AbortSignal.any([AbortSignal.timeout(10000),...(signal?[signal]:[]),...(init?.signal?[init.signal]:[])])});
}
export function marketDatabase(signal?:AbortSignal):SupabaseClient {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw Error('Market database is unavailable');
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:marketDatabaseFetch(signal)}});
}
export async function runScheduledPriceLabsRefresh(environment=process.env.VERCEL_ENV) {
  if(environment!=='production')return {status:'disabled' as const};
  const signal=AbortSignal.timeout(240000),db=marketDatabase(signal),control=marketDatabase();
  const material=process.env.SUPABASE_SERVICE_ROLE_KEY!;
  async function rpc(name:string,args:Record<string,unknown>){
    const {data,error}=await control.rpc(name,args);if(error)throw Error('Market connection update failed');return data;
  }
  return refreshPriceLabsMarkets({
    claim:async id=>{
      const value=await rpc('helm_claim_pricing_market',{p_lease:id});if(value===null)return null;
      if(typeof value?.ciphertext!=='string'||!(value.cursor===null||typeof value.cursor==='string'))throw Error('Invalid connection lease');
      return value as Lease;
    },
    open:ciphertext=>openPriceLabsCredentials(ciphertext,material),
    renew:value=>renewPriceLabsCredentials(value),
    rotate:async(id,value)=>{await rpc('helm_rotate_pricing_market',{p_lease:id,p_ciphertext:sealPriceLabsCredentials(value,material)});},
    finish:async(id,report,cursor)=>{await rpc('helm_finish_pricing_market',{p_lease:id,p_report:report,p_cursor:cursor});},
    client:value=>createPriceLabsMarketClient(value.token,fetch,{signal,timeoutMs:60000}),
    homes:()=>readPricingLiveHomes(db),read:id=>readPricingResearch(db,id),
    save:input=>savePricingResearch(db,input,'PriceLabs scheduled read-only market import'),now:()=>new Date(),
  },signal);
}

export async function priceLabsCronResponse(request:Request,deps:{secret:string|undefined;run:typeof runScheduledPriceLabsRefresh}={secret:process.env.CRON_SECRET,run:runScheduledPriceLabsRefresh}) {
  const headers={'Cache-Control':'no-store'};
  if(!deps.secret||request.headers.get('authorization')!==`Bearer ${deps.secret}`)return Response.json({error:'Unauthorized'},{status:401,headers});
  try {
    const result=await deps.run();
    return Response.json(result,{status:['failed','partial'].includes(result.status)?503:200,headers});
  }catch{return Response.json({error:'Market refresh was not confirmed'},{status:503,headers});}
}
