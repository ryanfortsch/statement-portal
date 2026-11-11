import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {currentPricingSnapshot,pricingLiveRow,type PricingLiveHome} from '../dynamic-pricing-live.ts';
import {readPricingLivePortfolio,readPricingLiveCalendar} from '../dynamic-pricing-live.server.ts';
import {sortPricingPortfolioRows} from '../dynamic-pricing-portfolio.ts';
import {pricingCalendarMonth} from '../dynamic-pricing-view.ts';
import {createPricingDemo} from '../dynamic-pricing-demo.ts';
import {pricingPreviewRequest} from '../../../scripts/lib/pricing-preview-http.mjs';

const now=new Date('2026-11-11T14:00:00Z');
const home:PricingLiveHome={id:'test_home',name:'12 Sample',city:'Example',bedrooms:3,authority:'guesty',timezone:'America/New_York'};
function snapshot() {const s=createPricingDemo(now).snapshot;delete s.evidence;s.market=[];s.days=s.days.map(d=>({...d,state:'open',currentCents:20000}));return s;}

test('live summaries keep only the internal name and never manufacture a base, market rate or connected state',()=>{
  const s=snapshot(),r=pricingLiveRow({...home,title:'Public marketing title',secret:'private'} as PricingLiveHome,s,now,s.today);
  assert.equal(r.name,'12 Sample');assert.equal(r.baseCents,null);assert.equal(r.floorCents,null);assert.equal(r.ceilingCents,null);
  assert.equal(r.mode,'shadow');assert.equal(r.configured,false);assert.equal(r.windows[30].marketPct,null);
  assert.equal('title' in r,false);assert.equal('secret' in r,false);assert.equal('snapshot' in r,false);
});

test('current open-rate averages exclude booked/blocked nights and withhold partial pricing',()=>{
  const s=snapshot();s.days[0].state='booked';s.days[0].currentCents=99900;s.days[1].state='blocked';s.days[1].currentCents=88800;s.days[2].currentCents=30000;
  let r=pricingLiveRow(home,s,now,s.today);
  assert.equal(r.currentRateCents?.[7],22000);assert.equal(r.windows[7].open,5);assert.equal(r.windows[7].booked,1);
  s.days[3].currentCents=null;r=pricingLiveRow(home,s,now,s.today);assert.equal(r.currentRateCents?.[7],null);
  assert.notEqual(r.windows[7].occupancyPct,null); // Missing price does not erase a known booking status.
  s.days.forEach(d=>{d.state='blocked';});r=pricingLiveRow(home,s,now,s.today);assert.equal(r.currentRateCents?.[7],null);assert.equal(r.windows[7].occupancyPct,null);
});

test('stale dates disappear from current calendar prices and cannot become open inventory',()=>{
  const s=snapshot();s.days[2].observedAt='2026-11-01T00:00:00Z';
  const clean=currentPricingSnapshot(s,now),r=pricingLiveRow(home,clean,now,s.today);
  assert.deepEqual([clean.days[2].state,clean.days[2].currentCents,clean.days[2].minNights],['unknown',null,null]);
  assert.equal(r.windows[7].occupancyPct,null);assert.equal(r.currentRateCents?.[7],null);
  assert.equal(s.days[2].state,'open');
});

test('open-rate sort follows the selected period and keeps unknown rates last',()=>{
  const s=snapshot(),a=pricingLiveRow(home,s,now,s.today),b={...a,id:'b',name:'2 Sample',currentRateCents:{7:40000,30:10000,60:null,90:null}},c={...a,id:'c',currentRateCents:undefined};
  assert.deepEqual(sortPricingPortfolioRows([a,b,c],{sort:'rate',direction:'asc',window:7}).map(r=>r.id),[a.id,b.id,c.id]);
  assert.deepEqual(sortPricingPortfolioRows([a,b,c],{sort:'rate',direction:'asc',window:30}).map(r=>r.id),[b.id,a.id,c.id]);
  assert.deepEqual(sortPricingPortfolioRows([a,b,c],{sort:'rate',direction:'desc',window:30}).map(r=>r.id),[a.id,b.id,c.id]);
});

test('current-only calendar exposes existing prices without generating recommendations or review warnings',()=>{
  const s=snapshot(),cells=pricingCalendarMonth('2026-11',s,null,true);
  const d=cells.find(c=>c?.date===s.today)!;assert.equal(d.status,'ready');assert.equal(d.recommendation,undefined);assert.equal(d.day?.currentCents,20000);
  assert.equal(pricingCalendarMonth('2026-11',s,null).find(c=>c?.date===s.today)?.status,'review');
});

test('live reader uses existing tables with explicit projections and preserves failed homes',async()=>{
  const selects:{table:string;fields:string}[]=[];
  const registry=[{...home,calendar_authority:'guesty'},{...home,id:'not_ready',name:'14 Sample',calendar_authority:'helm'}];
  const db={from(table:string){
    const q={select(fields:string){selects.push({table,fields});return q;},eq(){return q;},in(){return q;},gte(){return q;},lte(){return q;},gt(){return q;},order(){return q;},range(){return q;},maybeSingle(){return q;},
      then(resolve:(r:unknown)=>unknown){return Promise.resolve(resolve({error:null,data:table==='properties'?registry:table==='property_rate_plans'?null:table==='property_calendar_days'?snapshot().days.map(d=>({date:d.date,status:'available',price:200,currency:'USD',min_nights:2,synced_at:now.toISOString()})):[]}));}};
    return q;
  }} as unknown as SupabaseClient;
  const result=await readPricingLivePortfolio(db,now);
  assert.equal(result.rows.length,2);assert.equal(result.rows[0].windows[30].occupancyPct,0);assert.equal(result.rows[1].windows[30].occupancyPct,null);assert.equal(result.rows[1].error,'Calendar unavailable');
  assert.ok(selects.every(s=>!s.fields.includes('*')&&!/guest_name|email|phone|notes|title|ical_export_token/.test(s.fields)));
  assert.ok(selects.every(s=>!s.table.startsWith('property_pricing_')));
});

test('private localhost preview rejects unauthenticated, cross-origin and write requests before reading data',async()=>{
  let reads=0;
  const options={port:12345,token:'synthetic-token',portfolio:async()=>{reads++;return {rows:[]};},calendar:async()=>{reads++;return {};},asset:async()=>null};
  async function request(overrides:Record<string,unknown>={}) {
    const req={method:'GET',url:'/portfolio',headers:{host:'127.0.0.1:12345',cookie:'helm_pricing_preview=synthetic-token'},...overrides};
    const res={status:200,headers:{} as Record<string,string>,body:'',setHeader(k:string,v:string){this.headers[k]=v;},writeHead(code:number,headers={}){this.status=code;Object.assign(this.headers,headers);return this;},end(body=''){this.body=body;return this;}};
    await pricingPreviewRequest(req,res,options);return res;
  }
  assert.equal((await request({headers:{host:'127.0.0.1:12345'}})).status,401);
  assert.equal((await request({method:'POST'})).status,405);
  assert.equal((await request({headers:{host:'malicious.example',cookie:'helm_pricing_preview=synthetic-token'}})).status,403);
  assert.equal((await request({headers:{host:'127.0.0.1:12345',cookie:'helm_pricing_preview=synthetic-token',origin:'https://elsewhere.example'}})).status,403);
  assert.equal(reads,0);assert.equal((await request()).status,200);assert.equal(reads,1);
  const login=await request({url:'/open?key=synthetic-token',headers:{host:'127.0.0.1:12345'}});assert.equal(login.status,303);assert.match(login.headers['Set-Cookie'],/HttpOnly; SameSite=Strict/);
});

test('native live calendar respects canonical bookings and closures and uses actual rate overrides',async()=>{
  const start='2026-11-11';
  const plan={property_id:home.id,currency:'USD',base_nightly_cents:22000,weekend_nightly_cents:28000,weekend_days:[5,6],min_nights_default:2,advance_notice_hours:0,booking_window_days:365,turnover_buffer_days:0,checkin_time:'16:00'};
  const records={property_rate_plans:plan,property_rate_days:[{property_id:home.id,date:'2026-11-14',nightly_cents:33000,min_nights:3,cta:false,ctd:false,closed:false,source:'operator'}],property_rental_periods:[],bookings:[
    {status:'confirmed',check_in:start,check_out:'2026-11-12',duplicate_of:null},
    {status:'confirmed',check_in:'2026-11-14',check_out:'2026-11-15',duplicate_of:'canonical'},
    {status:'block',check_in:'2026-11-12',check_out:'2026-11-13',duplicate_of:null,hold_kind:'ota',source:'ical_import',channel:'booking_com'},
  ]};
  const db={from(table:keyof typeof records){const q={select(){return q;},eq(){return q;},in(){return q;},gte(){return q;},lte(){return q;},gt(){return q;},order(){return q;},range(){return q;},maybeSingle(){return q;},then(resolve:(r:unknown)=>unknown){return Promise.resolve(resolve({data:records[table],error:null}));}};return q;}} as unknown as SupabaseClient;
  const result=await readPricingLiveCalendar(db,{...home,authority:'helm'},now);
  assert.equal(result.snapshot.days[0].state,'booked');assert.equal(result.snapshot.days[1].state,'blocked');
  const night=result.snapshot.days[3];assert.deepEqual([night.state,night.currentCents,night.minNights,night.protected],['open',33000,3,true]);
  assert.equal(result.snapshot.days[2].currentCents,28000);assert.equal(result.source,'Helm calendar');
  assert.equal(JSON.stringify(result).includes('duplicate_of'),false);
});
