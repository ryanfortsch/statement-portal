import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sealPriceLabsCredentials,openPriceLabsCredentials,renewPriceLabsCredentials} from '../pricelabs-credentials.server.ts';
import {refreshPriceLabsMarkets,runScheduledPriceLabsRefresh,priceLabsCronResponse} from '../pricelabs-market-refresh.server.ts';
import {importPriceLabsMcpMarket} from '../dynamic-pricing-pricelabs-market.ts';
import type {PricingResearchSave} from '../dynamic-pricing-research.ts';

const now=new Date('2026-11-13T12:00:00Z'),material='synthetic-key-material-for-test-only-1234';
const credentials={clientId:'synthetic-client',clientSecret:'synthetic-secret',token:{scope:'read' as const,access_token:'synthetic-access',refresh_token:'synthetic-refresh',obtained_at:'2026-11-13T11:59:00.000Z',expires_in:7200}};
test('credentials use randomized authenticated encryption and reject tampering, wrong keys and broader scopes',()=>{
  const sealed=sealPriceLabsCredentials(credentials,material);
  assert.deepEqual(openPriceLabsCredentials(sealed,material),credentials);
  assert.notEqual(sealed,sealPriceLabsCredentials(credentials,material));assert.doesNotMatch(sealed,/synthetic/);
  assert.throws(()=>openPriceLabsCredentials(sealed,material+'x'),/could not be opened/);
  const parts=sealed.split('.');parts[3]=(parts[3][0]==='A'?'B':'A')+parts[3].slice(1);
  assert.throws(()=>openPriceLabsCredentials(parts.join('.'),material),/could not be opened/);
  assert.throws(()=>sealPriceLabsCredentials({...credentials,token:{...credentials.token,scope:'read write'}},material));
  assert.throws(()=>sealPriceLabsCredentials(credentials,''),/unavailable/);
});
test('OAuth renewal never broadens scope and retains an omitted refresh token without logging a failed body',async()=>{
  let calls=0;
  const fetcher=(async(url,init)=>{
    calls++;assert.equal(url,'https://pricelabs.co/oauth/token');assert.equal(init?.redirect,'error');
    assert.equal(new URLSearchParams(init?.body as URLSearchParams).get('grant_type'),'refresh_token');
    return Response.json({access_token:'new-synthetic-access',scope:'read',expires_in:7200});
  }) as typeof fetch;
  assert.deepEqual(await renewPriceLabsCredentials(credentials,fetcher,now),credentials);assert.equal(calls,0);
  const expired={...credentials,token:{...credentials.token,expires_in:1}};
  const renewed=await renewPriceLabsCredentials(expired,fetcher,now);assert.equal(calls,1);assert.equal(renewed.token.refresh_token,credentials.token.refresh_token);
  assert.equal(renewed.token.access_token,'new-synthetic-access');assert.equal(renewed.token.obtained_at,now.toISOString());
  for(const body of [{access_token:'secret-must-not-log',scope:'read write',expires_in:7200},{access_token:'secret-must-not-log',scope:'read',expires_in:-1}]){
    await assert.rejects(()=>renewPriceLabsCredentials(expired,(async()=>Response.json(body)) as typeof fetch,now),error=>{assert.doesNotMatch(String(error),/secret-must-not-log/);return true;});
  }
  await assert.rejects(()=>renewPriceLabsCredentials(expired,(async()=>new Response('secret-must-not-log',{status:400})) as typeof fetch,now),/authorization needs attention/);
});
function market(id:string){return {success:true,status_code:200,data:{data:{
  compset_settings:{selected_source:'NL',selected_source_label:'Nearby Listings',compset_size:100,br_range_selected:{selected:[3]}},
  initialize_detail:{currency:'USD',listing_id:id,pms:'guesty',nd_source:'airbnb'},
  future_prices:{stay_dates:['2026-11-14'],market_price:[300],market_25_percentile_prices:[200],market_75_percentile_prices:[400],market_90_percentile_prices:[500],booked_50_percentile_price:[280],num_bookings:[4],final_price:[310]},
  occupancy:{daily:{period:['2026-11-14'],market_occupancy:[40],market_occupancy_stly:[30],market_occupancy_ly:[70],pickup_7_days:[2],pickup_7_days_stly:[1]}},
},meta:{listing:{listing_id:id,pms_name:'guesty'},initialize:{http_status:200,error:null}}}};}
function harness(count=26){
  const homes=Array.from({length:count},(_,i)=>({id:String(i).padStart(2,'0'),name:`Synthetic ${i}`,city:'Test',bedrooms:3,authority:'guesty' as const,timezone:'America/New_York',guestyListingId:`vendor-${i}`}));
  const saved:PricingResearchSave[]=[],requested:string[]=[],events:string[]=[];
  const deps:Parameters<typeof refreshPriceLabsMarkets>[0]={
    claim:async()=>({ciphertext:'synthetic',cursor:null}),open:()=>credentials,renew:async c=>c,
    rotate:async()=>{events.push('rotate');},finish:async()=>{events.push('finish');},
    client:async()=>({listings:async()=>({success:true,status_code:200,data:{listings:homes.map(h=>({listing_id:h.guestyListingId,pms_name:'guesty'})),total_listings:homes.length}}),market:async id=>{requested.push(id);events.push('market');return market(id);}}),
    homes:async()=>homes,read:async()=>({ok:true,value:null}),save:async raw=>{const input=raw as PricingResearchSave;saved.push(input);return {ok:true,value:{version:input.version+1,data:input.data,updated_at:now.toISOString()}};},now:()=>now,
  };
  return {deps,homes,saved,requested,events};
}
test('a 26-home run uses exact IDs, retains versioned research and rotates credentials before reading',async()=>{
  const h=harness();h.deps.renew=async c=>({...c,token:{...c.token,access_token:'renewed'}});
  const report=await refreshPriceLabsMarkets(h.deps,new AbortController().signal);
  assert.equal(report.status,'complete');assert.equal(h.saved.length,26);assert.equal(h.events[0],'rotate');assert.equal(h.events.at(-1),'finish');
  assert.equal(new Set(h.saved.map(s=>s.requestId)).size,26);assert.equal(h.saved[0].data.marketObservedAt,now.toISOString());
  assert.doesNotMatch(JSON.stringify(report),/synthetic|token|vendor/);
});
test('fresh manual imports and all history are preserved; concurrent saves never retry over an edit',async()=>{
  const h=harness(3),before=importPriceLabsMcpMarket(market('vendor-0'),{listingId:'vendor-0',pms:'guesty',today:'2026-11-13',observedAt:now.toISOString()},'00');
  before.marketSource='Manual CSV';before.historySource='Synthetic ledger';before.historyObservedAt='2026-11-01T00:00:00.000Z';before.history=[{date:'2026-10-01',state:'booked',bookedOn:'2026-09-01',rentCents:20000}];
  h.deps.read=async id=>({ok:true,value:{version:7,updated_at:now.toISOString(),data:{...before,propertyId:id,marketObservedAt:id==='00'?now.toISOString():'2026-11-10T00:00:00.000Z'}}});
  const save=h.deps.save;h.deps.save=async input=>(input as PricingResearchSave).propertyId==='02'?{ok:false,conflict:true,error:'synthetic'}:save(input);
  const report=await refreshPriceLabsMarkets(h.deps,new AbortController().signal);
  assert.equal(report.status,'partial');assert.ok('fresh' in report);assert.equal(report.fresh,1);assert.equal(report.conflicts,1);
  assert.equal(h.saved.length,1);assert.equal(h.saved[0].version,7);assert.deepEqual(h.saved[0].data.history,before.history);assert.equal(h.saved[0].data.historyObservedAt,before.historyObservedAt);
  assert.ok(!h.requested.includes('vendor-0'));
});
test('failed reads and inactive listings do not create a fresh stamp or a research write',async()=>{
  const h=harness(2),factory=h.deps.client;
  h.deps.client=async c=>({...await factory(c),market:async id=>{if(id==='vendor-0')throw Error('private-provider-payload');return {success:false,status_code:422,data:{error_code:'ERR-MCP-LISTING-NOT-SYNCING'}};}});
  const report=await refreshPriceLabsMarkets(h.deps,new AbortController().signal);assert.ok('failed' in report);assert.equal(report.failed,1);assert.equal(report.unavailable,1);assert.equal(h.saved.length,0);assert.doesNotMatch(JSON.stringify(report),/private-provider/);
});
test('lease contention and unconfirmed token rotation fail closed before provider reads',async()=>{
  const h=harness();h.deps.claim=async()=>null;
  assert.deepEqual(await refreshPriceLabsMarkets(h.deps,new AbortController().signal),{status:'skipped'});assert.deepEqual(h.events,[]);
  const broken=harness();broken.deps.renew=async c=>({...c,token:{...c.token,access_token:'new'}});broken.deps.rotate=async()=>{throw Error('database unavailable');};
  const result=await refreshPriceLabsMarkets(broken.deps,new AbortController().signal);assert.equal(result.status,'failed');assert.deepEqual(broken.requested,[]);assert.deepEqual(broken.events,['finish']);
});
test('deadline prevents writes from late provider replies and rotates the next starting point',async()=>{
  const h=harness(),controller=new AbortController(),factory=h.deps.client;
  h.deps.claim=async()=>({ciphertext:'synthetic',cursor:'10'});
  let finalCursor:string|null=null;h.deps.finish=async(_id,_report,cursor)=>{finalCursor=cursor;};
  h.deps.client=async c=>({...await factory(c),market:async id=>{h.requested.push(id);controller.abort();return market(id);}});
  const report=await refreshPriceLabsMarkets(h.deps,controller.signal);assert.ok('deferred' in report);assert.equal(report.status,'partial');assert.equal(report.deferred,26);assert.equal(h.saved.length,0);assert.equal(h.requested[0],'vendor-11');assert.equal(finalCursor,'12');
});
test('preview and local scheduled runs cannot read production credentials',async()=>{
  assert.deepEqual(await runScheduledPriceLabsRefresh('preview'),{status:'disabled'});assert.deepEqual(await runScheduledPriceLabsRefresh('development'),{status:'disabled'});
});
test('cron rejects missing/mismatched secrets before running and sanitizes runtime failures',async()=>{
  let calls=0;const run=async()=>{calls++;return {status:'skipped' as const};};
  for(const [secret,bearer] of [[undefined,'Bearer undefined'],['synthetic',''],['synthetic','Bearer other']]){
    const response=await priceLabsCronResponse(new Request('https://synthetic.test',{headers:{authorization:bearer??''}}),{secret,run});
    assert.equal(response.status,401);assert.equal(response.headers.get('cache-control'),'no-store');
  }
  assert.equal(calls,0);
  const request=new Request('https://synthetic.test',{headers:{authorization:'Bearer synthetic'}});
  const success=await priceLabsCronResponse(request,{secret:'synthetic',run});assert.equal(success.status,200);assert.equal(calls,1);
  const failure=await priceLabsCronResponse(request,{secret:'synthetic',run:async()=>{throw Error('private token must not appear');}});
  assert.equal(failure.status,503);assert.doesNotMatch(await failure.text(),/private token/);
});
