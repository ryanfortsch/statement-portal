import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CALDERWOOD_PRODUCTION as m } from '../channex-production-preflight.ts';
import { auditCalderwoodChannels, auditProductionChannelEnvironment, ChannelAuditError } from '../channex-channel-audit.ts';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const now = Date.parse('2026-11-11T03:00:00Z');
const key = 'synthetic-key';
const expected = { channelId:id(1), listingId:'123456789', minStayType:'Arrival' as const };
function channel() { return { id:id(1), type:'channel', attributes:{ id:id(1), channel:'ABB', is_active:true, currency:null,
  properties:[m.propertyId], expected_removal_date:null as string|null,
  settings:{ min_stay_type:'Arrival', derived_option:null, access_token:'PRIVATE_SENTINEL' } as Record<string,unknown>,
  rate_plans:[{ id:id(2), rate_plan_id:m.ratePlanId, settings:{ listing_id:'123456789', los_enabled:false } as Record<string,unknown> }],
}, relationships:{ properties:{ data:[{ id:m.propertyId, type:'property' }] } } }; }
function list(rows=[channel()]) { return { data:rows, meta:{ page:1,limit:100,total:rows.length } }; }
function rate() { return { data:{ id:m.ratePlanId, type:'rate_plan', attributes:{ currency:'USD',sell_mode:'per_room',rate_mode:'manual' },
  relationships:{ property:{ data:{ id:m.propertyId } }, room_type:{ data:{ id:m.roomTypeId } } } } }; }
function harness(rows: unknown[] = [list(),{data:channel()},rate(),{data:channel()},list()]) {
  const calls: { url:string; init:RequestInit|undefined }[]=[];
  const fetcher: typeof fetch = async (input,init) => { calls.push({url:String(input),init}); return Response.json(rows[calls.length-1]); };
  return { calls,fetcher };
}
const code = (expectedCode:string) => (e:unknown) => e instanceof ChannelAuditError && e.code === expectedCode;
test('reviewed mapping uses only bounded fixed-host GETs and produces no secret, write or delivery permission',async()=>{
  const h=harness(); const r=await auditCalderwoodChannels(key,expected,h.fetcher,()=>now);
  assert.equal(r.status,'mapping-verified'); assert.equal(r.mappingVerified,true); assert.equal(r.readyForCutover,false);
  assert.equal(r.priceLabsDeliveryVerified,false); assert.equal(r.providerWrites,0); assert.ok(r.checks.every(c=>c.passed));
  assert.equal(h.calls.length,5); assert.ok(!JSON.stringify(r).includes('PRIVATE_SENTINEL'));
  assert.ok(!JSON.stringify(r).includes(expected.listingId)); assert.ok(!JSON.stringify(r).includes(expected.channelId));
  for(const c of h.calls) {
    assert.equal(new URL(c.url).origin,'https://app.channex.io'); assert.equal(c.init?.method,'GET'); assert.equal(c.init?.redirect,'error');
    assert.equal(c.init?.cache,'no-store'); assert.equal(c.init?.body,undefined); assert.ok(c.init?.signal); assert.ok(!c.url.includes(key));
  }
  assert.equal(new URL(h.calls[0].url).searchParams.get('filter[property_id]'),m.propertyId);
  assert.equal(new URL(h.calls[0].url).searchParams.get('pagination[limit]'),'100');
  assert.ok(h.calls.every(c=>c.init?.signal===h.calls[0].init?.signal));
});
test('no connection is reported only from two complete matching empty collections',async()=>{
  const h=harness([list([]),list([])]);const r=await auditCalderwoodChannels(key,null,h.fetcher,()=>now);
  assert.equal(r.status,'not-connected');assert.equal(r.channelCount,0);assert.equal(h.calls.length,2);
  assert.equal(r.mappingVerified,false);
  for(const invalid of [{data:[]}, {data:[],meta:{page:1,limit:100,total:1}}, {data:[],meta:{page:2,limit:100,total:0}},
    {data:[],meta:{page:1,limit:1,total:0}}, {data:[],meta:{page:1,limit:100,total:101}}, {data:null,meta:{page:1,limit:100,total:0}}]) {
    await assert.rejects(auditCalderwoodChannels(key,null,harness([invalid]).fetcher,()=>now),code('INVALID_RESPONSE'));
  }
});
test('identity is never approved from observed data; malformed explicit review makes no request',async()=>{
  const r=await auditCalderwoodChannels(key,null,harness().fetcher,()=>now);
  assert.equal(r.status,'needs-review');assert.equal(r.checks.find(c=>c.key==='review')?.passed,false);
  for(const e of [{...expected,extra:'x'},{...expected,listingId:123456789},{...expected,channelId:'../other'}, {...expected,minStayType:'anything'}]) {
    const h=harness();await assert.rejects(auditCalderwoodChannels(key,e as typeof expected,h.fetcher,()=>now),code('CONFIGURATION_REQUIRED'));assert.equal(h.calls.length,0);
  }
});
test('wrong channel, listing, scope, active state, rate or pricing mode never verifies',async()=>{
  const edits: ((c:ReturnType<typeof channel>)=>void)[] = [
    c=>{c.attributes.channel='BDC';}, c=>{c.attributes.properties.push(id(9));}, c=>{c.relationships.properties.data.push({id:id(9),type:'property'});},
    c=>{c.attributes.is_active=false;}, c=>{c.attributes.expected_removal_date='2026-11-30';}, c=>{c.attributes.currency='EUR';},
    c=>{c.attributes.settings.min_stay_type='Through';}, c=>{c.attributes.settings.los_enabled=true;},
    c=>{c.attributes.rate_plans[0].settings.listing_id='999';}, c=>{c.attributes.rate_plans[0].settings.listing_id=123456789;},
    c=>{c.attributes.rate_plans[0].settings.parent_listing_id='123456789';}, c=>{c.attributes.rate_plans[0].settings.los_enabled=true;},
    c=>{c.attributes.rate_plans.push({...c.attributes.rate_plans[0],id:id(3)});},
    c=>{c.attributes.settings.derived_option={min_stay_arrival:[['set',1]]};},
    c=>{c.attributes.rate_plans[0].settings.derived_option={rate:[['increase_by_percent','10']]};},
    c=>{c.attributes.settings.derived_option='malformed';},
  ];
  for(const edit of edits) { const c=channel();edit(c);const h=harness([list([c]),{data:c},rate(),{data:c},list([c])]);
    assert.equal((await auditCalderwoodChannels(key,expected,h.fetcher,()=>now)).mappingVerified,false); }
  const wrong=rate();wrong.data.relationships.room_type.data.id=id(5);
  assert.equal((await auditCalderwoodChannels(key,expected,harness([list(),{data:channel()},wrong,{data:channel()},list()]).fetcher,()=>now)).mappingVerified,false);
  assert.equal((await auditCalderwoodChannels(key,{...expected,channelId:id(9)},harness().fetcher,()=>now)).mappingVerified,false);
});
test('multiple, missing and foreign mappings are review findings; foreign IDs are never fetched',async()=>{
  const foreign=channel();foreign.id=id(8);foreign.attributes.id=id(8);
  const multi=list([channel(),foreign]);const h=harness([multi,multi]);const r=await auditCalderwoodChannels(key,expected,h.fetcher,()=>now);
  assert.equal(r.status,'needs-review');assert.equal(r.channelCount,2);assert.equal(h.calls.length,2);
  const missing=channel();missing.attributes.rate_plans=[];
  assert.equal((await auditCalderwoodChannels(key,expected,harness([list([missing]),{data:missing},{data:missing},list([missing])]).fetcher,()=>now)).mappingVerified,false);
  foreign.attributes.properties=[id(9)];foreign.relationships.properties.data=[{id:id(9),type:'property'}];
  const f=harness([list([foreign]),list([foreign])]);assert.equal((await auditCalderwoodChannels(key,expected,f.fetcher,()=>now)).mappingVerified,false);assert.equal(f.calls.length,2);
  await assert.rejects(auditCalderwoodChannels(key,expected,harness([list([channel(),channel()])]).fetcher,()=>now),code('INVALID_RESPONSE'));
});
test('connection/mapping drift or a channel added during review invalidates the entire observation',async()=>{
  const c=channel();c.attributes.is_active=false;
  for(const rows of [[list(),{data:c}], [list(),{data:channel()},rate(),{data:c}], [list(),{data:channel()},rate(),{data:channel()},list([])], [list([]),list()]]) {
    await assert.rejects(auditCalderwoodChannels(key,expected,harness(rows).fetcher,()=>now),code('CHANGED_DURING_CHECK'));
  }
});
test('unknown secret fields do not leave server or trigger false drift; supported empty overrides pass',async()=>{
  const c=channel();c.attributes.settings.access_token='ROTATED_PRIVATE';
  c.attributes.settings.derived_option={rate:[],min_stay_arrival:null};
  c.attributes.rate_plans[0].settings.derived_option=[];
  const h=harness([list([c]),{data:c},rate(),{data:{...c,attributes:{...c.attributes,settings:{...c.attributes.settings,access_token:'OTHER_PRIVATE'}}}},list([c])]);
  assert.equal((await auditCalderwoodChannels(key,expected,h.fetcher,()=>now)).mappingVerified,true);
});
test('malformed provider replies, errors, warnings, oversized bodies and HTTP failures stay sanitized',async()=>{
  for(const response of [new Response('PRIVATE_SENTINEL',{status:401}),new Response('PRIVATE_SENTINEL',{status:429}),new Response('PRIVATE_SENTINEL',{status:500}),
    new Response('',{status:302,headers:{location:'https://example.invalid'}}),new Response('PRIVATE_SENTINEL'),
    new Response('x'.repeat(512*1024+1)),Response.json({...list(),errors:{secret:'PRIVATE_SENTINEL'}}),
    Response.json({...list(),meta:{...list().meta,warnings:['PRIVATE_SENTINEL']}}),Response.json({data:[{id:'not-a-uuid'}],meta:list().meta})]) {
    await assert.rejects(auditCalderwoodChannels(key,expected,async()=>response,()=>now),e=>{assert.ok(e instanceof ChannelAuditError);assert.ok(!String(e).includes('PRIVATE_SENTINEL'));return true;});
  }
  await assert.rejects(auditCalderwoodChannels(key,expected,async()=>{throw Error('PRIVATE_SENTINEL');},()=>now),code('PROVIDER_UNAVAILABLE'));
});
test('review is immutable across IO and refuses stale or backwards clocks',async()=>{
  const review={...expected};const h=harness();const fetcher:typeof fetch=async(...args)=>{review.listingId='999';return h.fetcher(...args);};
  assert.equal((await auditCalderwoodChannels(key,review,fetcher,()=>now)).mappingVerified,true);
  for(const end of [now-1,now+20_000]) {let i=0;await assert.rejects(auditCalderwoodChannels(key,expected,harness().fetcher,()=>i++ ? end : now),code('PROVIDER_UNAVAILABLE'));}
  for(const k of ['', ' key', 'key\n','a'.repeat(4097)]) {const h=harness();await assert.rejects(auditCalderwoodChannels(k,expected,h.fetcher,()=>now),code('CONFIGURATION_REQUIRED'));assert.equal(h.calls.length,0);}
});
test('production inspection environment is required; UI is owner-gated and contains no mutation path',async()=>{
  const env={VERCEL_ENV:'production',CHANNEX_PRODUCTION_MODE:'inspect',NEXT_PUBLIC_SUPABASE_URL:'https://qjueexujiuticjrtqdyj.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY:'synthetic-db',CHANNEX_PRODUCTION_API_KEY:key};
  assert.equal((await auditProductionChannelEnvironment(env,harness([list([]),list([])]).fetcher,()=>now)).status,'not-connected');
  for(const patch of [{VERCEL_ENV:'preview'},{CHANNEX_PRODUCTION_MODE:'consume'},{HELM_ISOLATED_CALENDAR_ENABLED:'true'},
    {CHANNEX_CALDERWOOD_CHANNEL_REVIEW:'{}'},{CHANNEX_CALDERWOOD_CHANNEL_REVIEW:'not json'},{NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid'}]) {
    const h=harness();await assert.rejects(auditProductionChannelEnvironment({...env,...patch},h.fetcher,()=>now),code('CONFIGURATION_REQUIRED'));assert.equal(h.calls.length,0);
  }
  const page=readFileSync(new URL('../../app/channels/65_calderwood/sync-status/page.tsx',import.meta.url),'utf8');
  assert.ok(page.indexOf('if (!await isOwnerSession())')<page.indexOf('<ChannelAuditSection'));
  const panel=readFileSync(new URL('../../app/channels/65_calderwood/sync-status/ChannelAuditPanel.tsx',import.meta.url),'utf8');
  assert.match(panel,/does not establish that there are no connections/);assert.match(panel,/does not prove Airbnb delivery/);
  assert.doesNotMatch(panel,/use server|onClick|<button|<form|\.insert\(|\.update\(/);
});
