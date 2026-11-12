import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importPriceLabsMcpMarket,matchPriceLabsMarketHomes,priceLabsMarketCatalog} from '../dynamic-pricing-pricelabs-market.ts';
import {emptyPricingEvidence} from '../dynamic-pricing-evidence.ts';
import {createPriceLabsMarketClient} from '../pricelabs-market-client.server.ts';
import type {PricingLiveHome} from '../dynamic-pricing-live.ts';

const context={listingId:'vendor-a',pms:'guesty',observedAt:'2026-11-12T22:00:00.000Z',today:'2026-11-12'};
function fixture(){return {success:true,status_code:200,data:{data:{
  compset_settings:{selected_source:'NL',selected_source_label:'Nearby Listings',compset_size:100,br_range_selected:{selected:[2,3,4]}},
  initialize_detail:{currency:'USD',listing_id:'vendor-a',pms:'guesty',nd_source:'airbnb',session_token:'discard-me'},
  future_prices:{stay_dates:['2026-11-11','2026-11-12','2026-11-13'],market_price:[null,300.125,350],market_25_percentile_prices:[null,250,275],market_75_percentile_prices:[null,350,400],market_90_percentile_prices:[null,400,450],booked_50_percentile_price:[null,290,320],num_bookings:[null,4,5],final_price:[null,320,330],events:[[['2026-11-13']],[['Synthetic festival']]],past_bookings:[{guest:'must not escape',adr:999}]},
  // Deliberately different order: dates, not positions, join the two series.
  occupancy:{daily:{period:['2026-11-13','2026-11-11','2026-11-12'],market_occupancy:[60,20,40],market_occupancy_stly:[55,15,35],market_occupancy_ly:[80,75,70],pickup_7_days:[3,1,2],pickup_7_days_stly:[1,0,1]}},
},meta:{listing:{listing_id:'vendor-a',pms_name:'guesty'},initialize:{http_status:200,error:null}}}};}
const home=(id:string,vendor:string):PricingLiveHome=>({id,name:`Home ${id}`,city:'Synthetic',bedrooms:3,authority:'guesty',timezone:'America/New_York',guestyListingId:vendor});
test('market reads join dates, convert currency once, retain source and exclude past nights and private payloads',()=>{
  const result=importPriceLabsMcpMarket(fixture(),context,'a');
  assert.equal(result.market.length,2);assert.equal(result.market[0].occupancyPct,40);assert.equal(result.market[1].occupancyPct,60);
  assert.equal(result.market[0].p50Cents,30013);assert.equal(result.market[1].pickup7Pct,3);assert.equal(result.market[1].event,'Synthetic festival');
  assert.equal(result.marketObservedAt,context.observedAt);assert.match(result.marketSource,/100 Nearby Listings · 2,3,4 BR · airbnb/);
  assert.doesNotMatch(JSON.stringify(result),/discard-me|must not escape|past_bookings|session_token/);
});
test('catalog matches 24 listings by exact PMS identifier; never guesses by name or fills other homes',()=>{
  const listings=Array.from({length:24},(_,i)=>({listing_id:`vendor-${i}`,pms_name:'guesty'}));
  const homes=Array.from({length:26},(_,i)=>home(`home-${i}`,`vendor-${i}`));
  const catalog={success:true,status_code:200,data:{listings,total_listings:24}};
  const matched=matchPriceLabsMarketHomes(catalog,homes);assert.equal(matched.filter(m=>m.home).length,24);
  assert.deepEqual(matched.map(m=>m.home?.id),homes.slice(0,24).map(h=>h.id));
  assert.equal(matchPriceLabsMarketHomes({...catalog,data:{listings:[{listing_id:'vendor-0',pms_name:'other'}],total_listings:1}},homes)[0].home,null);
  assert.throws(()=>matchPriceLabsMarketHomes(catalog,[...homes,home('duplicate','vendor-0')]),/multiple/);
  assert.throws(()=>priceLabsMarketCatalog({...catalog,data:{...catalog.data,total_listings:25}}),/Incomplete/);
  assert.throws(()=>priceLabsMarketCatalog({...catalog,data:{listings:[listings[0],listings[0]],total_listings:2}}),/duplicate/);
});
test('market refresh preserves separate history and refuses cross-property or older replacements',()=>{
  const previous={...emptyPricingEvidence('a'),historySource:'Synthetic ledger',historyObservedAt:context.observedAt,history:[{date:'2026-11-01',state:'booked' as const,bookedOn:'2026-10-01',rentCents:20000}]};
  const result=importPriceLabsMcpMarket(fixture(),context,'a',previous);
  assert.deepEqual(result.history,previous.history);assert.equal(result.historyObservedAt,previous.historyObservedAt);assert.deepEqual(previous.market,[]);
  assert.throws(()=>importPriceLabsMcpMarket(fixture(),context,'b',previous),/another home/);
  assert.throws(()=>importPriceLabsMcpMarket(fixture(),context,'a',{...previous,marketObservedAt:'2026-11-12T23:00:00Z'}),/newer/);
});
test('reject wrong identity, currency, failed initialization, duplicate dates and mismatched series',()=>{
  for(const mutate of [
    (r:ReturnType<typeof fixture>)=>{r.data.meta.listing.listing_id='other';},
    (r:ReturnType<typeof fixture>)=>{r.data.data.initialize_detail.pms='other';},
    (r:ReturnType<typeof fixture>)=>{r.data.data.initialize_detail.currency='EUR';},
    (r:ReturnType<typeof fixture>)=>{r.data.meta.initialize.http_status=500;},
    (r:ReturnType<typeof fixture>)=>{r.data.data.future_prices.stay_dates[2]='2026-11-12';},
    (r:ReturnType<typeof fixture>)=>{r.data.data.occupancy.daily.market_occupancy.pop();},
    (r:ReturnType<typeof fixture>)=>{r.data.data.future_prices.market_price.pop();},
    (r:ReturnType<typeof fixture>)=>{r.data.data.occupancy.daily.period[0]='2026-11-14';},
    (r:ReturnType<typeof fixture>)=>{r.data.data.occupancy.daily.market_occupancy[0]=101;},
    (r:ReturnType<typeof fixture>)=>{r.data.data.future_prices.market_price[2]=900;},
    (r:ReturnType<typeof fixture>)=>{r.data.data.compset_settings.br_range_selected.selected=[];},
  ]){const input=fixture();mutate(input);assert.throws(()=>importPriceLabsMcpMarket(input,context,'a'));}
});
test('zero occupancy remains zero; missing prices remain missing, never inferred',()=>{
  const input=fixture();input.data.data.occupancy.daily.market_occupancy[2]=0;input.data.data.future_prices.market_price[1]=null;
  const result=importPriceLabsMcpMarket(input,context,'a');assert.equal(result.market[0].occupancyPct,0);assert.equal(result.market[0].p50Cents,null);
});
function transportFixture(mode:'json'|'sse'='json',fail=false){
  const requests:{method:string;params:{name?:string;arguments?:unknown};id:number}[]=[];
  const fetcher=(async(url:URL|string|Request,options?:RequestInit)=>{
    assert.equal(url,'https://mcp.pricelabs.co/mcp');assert.equal(options?.redirect,'error');
    const request=JSON.parse(options?.body as string);requests.push(request);
    if(request.method==='notifications/initialized')return new Response(null,{status:202});
    const result=request.method==='initialize'?{protocolVersion:'2025-06-18'}:{content:[{type:'text',text:JSON.stringify({success:true,synthetic:true})}],...(fail?{isError:true}:{})};
    const message={jsonrpc:'2.0',id:request.id,result};
    if(mode==='json')return Response.json(message);
    const text=`event: message\ndata: ${JSON.stringify({jsonrpc:'2.0',method:'notification'})}\n\nevent: message\ndata: ${JSON.stringify(message)}\n\n`;
    const bytes=new TextEncoder().encode(text);return new Response(new ReadableStream({start(c){c.enqueue(bytes.slice(0,17));c.enqueue(bytes.slice(17));c.close();}}),{headers:{'content-type':'text/event-stream','mcp-session-id':'synthetic-session'}});
  }) as typeof fetch;
  return {fetcher,requests};
}
test('MCP reads support JSON and chunked SSE and expose only catalog and market read methods',async()=>{
  for(const mode of ['json','sse'] as const){
    const fixture=transportFixture(mode),client=await createPriceLabsMarketClient({access_token:'synthetic-token',scope:'read'},fixture.fetcher);
    assert.deepEqual(Object.keys(client).sort(),['listings','market']);
    assert.deepEqual(await client.listings(),{success:true,synthetic:true});await client.market('vendor-a','guesty');
    assert.deepEqual(fixture.requests.filter(r=>r.method==='tools/call').map(r=>r.params.name),['get_listings','get_neighbourhood_data']);
  }
});
test('MCP refuses write-capable tokens and propagates failed tool reads without exposing payloads',async()=>{
  const f=transportFixture('json',true);await assert.rejects(()=>createPriceLabsMarketClient({access_token:'synthetic-token',scope:'read write'},f.fetcher),/read-only/);assert.equal(f.requests.length,0);
  const client=await createPriceLabsMarketClient({access_token:'synthetic-token',scope:'read'},f.fetcher);await assert.rejects(()=>client.market('vendor-a','guesty'),/could not read/);
});
