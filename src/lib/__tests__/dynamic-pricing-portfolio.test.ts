import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pricingOccupancyWindow,pricingPortfolioRow,pricingPortfolioTotals,pricingPortfolioView,pricingPortfolioHref,sortPricingPortfolioRows,type PricingPortfolioHome,type PricingPortfolioSort} from '../dynamic-pricing-portfolio.ts';
import {createPricingDemo,createPricingPortfolioDemo,createPricingDemoServices} from '../dynamic-pricing-demo.ts';
import {shiftIsoDay} from '../sca-quotes-types.ts';

const now=new Date('2026-11-10T12:00:00Z');
const home:PricingPortfolioHome={id:'demo_home',name:'Sample home',city:'Gloucester',bedrooms:3,authority:'helm'};
function fixture(states:('booked'|'open'|'blocked'|'unknown')[]) {
  const f=createPricingDemo(now);
  f.snapshot.days=states.map((state,i)=>({...f.snapshot.days[i],state}));
  f.snapshot.evidence!.market=f.snapshot.evidence!.market.map(m=>({...m,occupancyPct:50}));
  return {...f,profile:null,runs:[]};
}

test('dashboard links round-trip the selected view without permitting external destinations or invalid filters',()=>{
  const view=pricingPortfolioView({period:'60',q:'Harbor & beach',filter:'below',sort:'base',direction:'desc',connection:'helm_direct'});
  const homeLink=pricingPortfolioHref(view,'sample/home'),url=new URL(homeLink,'https://helm.example');
  assert.equal(url.pathname,'/channels/pricing');assert.equal(url.searchParams.get('property'),'sample/home');
  const back=pricingPortfolioHref(pricingPortfolioView(Object.fromEntries(url.searchParams)));
  assert.equal(new URL(back,'https://helm.example').searchParams.has('property'),false);
  assert.deepEqual(pricingPortfolioView(Object.fromEntries(new URL(back,'https://helm.example').searchParams)),view);
  assert.deepEqual(pricingPortfolioView({period:'300',filter:'https://elsewhere',sort:['gap'],q:['ignored'],connection:'other'}),pricingPortfolioView());
  assert.equal(pricingPortfolioHref(pricingPortfolioView()),'/channels/pricing');
  assert.equal(pricingPortfolioView({sort:'open'}).direction,'desc');
  assert.equal(pricingPortfolioView({sort:'base',direction:'invalid'}).direction,'asc');
});

test('numeric column sorts toggle direction, preserve zero, and keep missing values last without mutating rows',()=>{
  const f=fixture(Array(90).fill('open'));
  const make=(id:string,value:number|null)=>{
    const row={...pricingPortfolioRow(home,f,f.snapshot.today,now),id,name:id};
    row.baseCents=value;row.floorCents=value;row.ceilingCents=value;
    Object.assign(row.windows[30],{occupancyPct:value,marketPct:value,gapPp:value,open:value??0,unknown:value===null?1:0});
    return row;
  };
  const rows=[make('Missing',null),make('High',70),make('Zero',0),make('Low',20)],original=structuredClone(rows);
  for(const sort of ['base','floor','ceiling','occupancy','market','gap','open'] as PricingPortfolioSort[]) {
    assert.deepEqual(sortPricingPortfolioRows(rows,{sort,direction:'asc',window:30}).map(r=>r.id),['Zero','Low','High','Missing'],sort);
    assert.deepEqual(sortPricingPortfolioRows(rows,{sort,direction:'desc',window:30}).map(r=>r.id),['High','Low','Zero','Missing'],sort);
  }
  assert.deepEqual(rows,original);
});

test('occupancy sorting uses the selected horizon, and ties keep a deterministic natural-name order',()=>{
  const f=fixture(Array(90).fill('open'));
  const rows=['Home 10','Home 2','Home 1'].map((name,i)=>{
    const row={...pricingPortfolioRow(home,f,f.snapshot.today,now),id:`row-${i}`,name};
    row.windows[30].occupancyPct=[80,20,50][i];row.windows[60].occupancyPct=[10,90,60][i];
    row.baseCents=10000;return row;
  });
  const names=(sort:PricingPortfolioSort,direction:'asc'|'desc',window:30|60=30)=>sortPricingPortfolioRows(rows,{sort,direction,window}).map(r=>r.name);
  assert.deepEqual(names('occupancy','asc'),['Home 2','Home 1','Home 10']);
  assert.deepEqual(names('occupancy','asc',60),['Home 10','Home 1','Home 2']);
  assert.deepEqual(names('name','asc'),['Home 1','Home 2','Home 10']);
  assert.deepEqual(names('name','desc'),['Home 10','Home 2','Home 1']);
  assert.deepEqual(names('base','desc'),['Home 1','Home 2','Home 10']);
  rows[0].mode='helm_direct';rows[2].mode='helm_direct';
  assert.deepEqual(names('connection','asc'),['Home 2','Home 1','Home 10']);
  assert.deepEqual(names('connection','desc'),['Home 1','Home 10','Home 2']);
});

test('forward occupancy excludes deliberate blocks and compares the same bookable dates',()=>{
  const f=fixture(['booked','booked','booked','open','open','blocked','blocked']);
  f.snapshot.evidence!.market[5].occupancyPct=100;
  f.snapshot.evidence!.market[6].occupancyPct=null;
  const w=pricingOccupancyWindow(f.snapshot,f.snapshot.today,7,now);
  assert.deepEqual([w.booked,w.open,w.blocked,w.bookable,w.unknown],[3,2,2,5,0]);
  assert.equal(w.occupancyPct,60);assert.equal(w.marketPct,50);assert.equal(w.gapPp,10);
  assert.equal(w.start,'2026-11-10');assert.equal(w.end,'2026-11-16');
});

test('missing, unknown, stale and future-dated calendar nights cannot become vacancy',()=>{
  for(const failure of ['missing','unknown','stale','future','snapshot'] as const) {
    const f=fixture(['booked','booked','booked','open','open','open','open']);
    if(failure==='missing')f.snapshot.days.pop();
    if(failure==='unknown')f.snapshot.days[6].state='unknown';
    if(failure==='stale')f.snapshot.days[6].observedAt='2026-11-01T12:00:00Z';
    if(failure==='future')f.snapshot.days[6].observedAt='2026-11-11T12:00:00Z';
    if(failure==='snapshot')f.snapshot.observedAt='2026-11-01T12:00:00Z';
    const w=pricingOccupancyWindow(f.snapshot,f.snapshot.today,7,now);
    assert.equal(w.occupancyPct,null,failure);assert.equal(w.marketPct,null,failure);assert.ok(w.unknown>0,failure);
  }
});

test('zero market occupancy is valid; missing, stale and partial market coverage withholds the comparison',()=>{
  const f=fixture(Array(7).fill('open'));
  f.snapshot.evidence!.market.forEach(m=>m.occupancyPct=0);
  const zero=pricingOccupancyWindow(f.snapshot,f.snapshot.today,7,now);
  assert.equal(zero.occupancyPct,0);assert.equal(zero.marketPct,0);assert.equal(zero.gapPp,0);
  f.snapshot.evidence!.market[2].occupancyPct=null;
  assert.equal(pricingOccupancyWindow(f.snapshot,f.snapshot.today,7,now).marketIssue,'partial');
  f.snapshot.evidence!.marketObservedAt='2026-11-01T12:00:00Z';
  assert.equal(pricingOccupancyWindow(f.snapshot,f.snapshot.today,7,now).marketIssue,'stale');
  f.snapshot.evidence!.market=[];
  assert.equal(pricingOccupancyWindow(f.snapshot,f.snapshot.today,7,now).marketIssue,'missing');
});

test('closed homes have no occupancy denominator, and empty portfolios have no fabricated percentages',()=>{
  const f=fixture(Array(7).fill('blocked')),w=pricingOccupancyWindow(f.snapshot,f.snapshot.today,7,now);
  assert.equal(w.bookable,0);assert.equal(w.occupancyPct,null);assert.equal(w.marketPct,null);assert.equal(w.marketIssue,null);
  const totals=pricingPortfolioTotals([],30);
  assert.equal(totals.occupancyPct,null);assert.equal(totals.marketPct,null);assert.equal(totals.gapPp,null);
});

test('portfolio weights home-nights and matches both sides of the market comparison',()=>{
  const a=fixture(['booked','blocked','blocked','blocked','blocked','blocked','blocked']);
  const b=fixture(Array(7).fill('open'));
  b.snapshot.evidence!.market.forEach(m=>m.occupancyPct=20);
  const c=fixture(Array(7).fill('booked'));c.snapshot.evidence!.market=[];
  const rows=[a,b,c].map(f=>pricingPortfolioRow(home,f,f.snapshot.today,now));
  const totals=pricingPortfolioTotals(rows,7);
  assert.equal(totals.bookable,15);assert.equal(totals.booked,8);assert.equal(totals.open,7);
  assert.equal(totals.occupancyPct,100*8/15);
  assert.equal(totals.comparedOccupancyPct,12.5);assert.equal(totals.marketPct,23.75);assert.equal(totals.gapPp,-11.25);
  assert.equal(totals.comparableHomes,2);assert.equal(totals.belowMarket,1);
});

test('row summaries reject cross-home evidence and keep unavailable data distinct from zero',()=>{
  const f=fixture(Array(7).fill('booked'));
  assert.throws(()=>pricingPortfolioRow({...home,id:'another_home'},f,f.snapshot.today,now),/another property/);
  const unavailable=pricingPortfolioRow(home,null,'2026-11-30',now);
  assert.equal(unavailable.windows[30].end,'2026-12-29');assert.equal(unavailable.windows[90].unknown,90);
  assert.equal(unavailable.baseCents,null);assert.equal(unavailable.windows[30].occupancyPct,null);assert.ok(unavailable.error);
  f.snapshot.days.push(f.snapshot.days[0]);
  assert.throws(()=>pricingPortfolioRow(home,f,f.snapshot.today,now),/Duplicate calendar/);
  const privateHome={...home,ical_export_token:'private-token',owner_email:'private@example.test'};
  const summary=pricingPortfolioRow(privateHome,null,'2026-11-10',now);
  assert.equal('ical_export_token' in summary,false);assert.equal('owner_email' in summary,false);
});

test('portfolio sample uses the property calendar day and independently represents missing/stale data',()=>{
  assert.equal(createPricingDemo(new Date('2026-11-11T00:30:00Z')).snapshot.today,'2026-11-10');
  const f=createPricingPortfolioDemo(now);
  assert.equal(f.length,24);assert.equal(new Set(f.map(v=>v.home.id)).size,24);
  const rows=f.map(v=>pricingPortfolioRow(v.home,{...v.fixture,profile:null,runs:[]},v.fixture.snapshot.today,now));
  assert.equal(rows[4].windows[30].marketIssue,'stale');assert.equal(rows[5].windows[30].occupancyPct,null);
  assert.equal(rows[0].windows[30].end,shiftIsoDay('2026-11-10',29));
  assert.ok(rows[0].windows[30].gapPp!<0);assert.ok(rows[1].windows[30].gapPp!>0);
  assert.equal(rows[18].windows[30].marketIssue,'missing');
  assert.equal(rows[23].windows[30].bookable,0);assert.equal(rows[23].windows[30].occupancyPct,null);
  for(const direction of ['asc','desc'] as const) {
    const sorted=sortPricingPortfolioRows(rows,{sort:'occupancy',window:30,direction});
    assert.equal(sorted.length,24);assert.equal(new Set(sorted.map(r=>r.id)).size,24);
    assert.ok(sorted.slice(-2).every(r=>r.windows[30].occupancyPct===null));
  }
});

test('multi-home demo saves and publishes only the selected home, with Guesty remaining comparison-only',async()=>{
  const f=createPricingPortfolioDemo(),a=f[0],b=f[1],sa=createPricingDemoServices(a.fixture,a.home.authority),sb=createPricingDemoServices(b.fixture,b.home.authority);
  const originalB=structuredClone((await sb.refresh()).value);
  assert.equal((await sb.save({propertyId:b.home.id,policy:b.fixture.policy,mode:'helm_direct',version:0})).ok,false);
  await assert.rejects(()=>sa.save({propertyId:b.home.id,policy:a.fixture.policy,mode:'shadow',version:0}));
  assert.equal((await sa.save({propertyId:a.home.id,policy:{...a.fixture.policy,baseCents:46000},mode:'helm_direct',version:0})).ok,true);
  const review=await sa.review();assert.ok(review.ok);if(!review.ok)return;
  const applied=await sa.publish(review.value.id);assert.ok(applied.ok);if(!applied.ok)return;assert.ok(applied.value>0);
  const state=(await sa.refresh()).value;
  assert.equal(state.profile?.property_id,a.home.id);
  const row=pricingPortfolioRow(a.home,state,state.snapshot.today,new Date());
  assert.equal(row.baseCents,46000);assert.equal(row.mode,'helm_direct');assert.ok(row.lastAppliedAt);
  assert.deepEqual((await sb.refresh()).value,originalB);
  const undo=await sa.undo(review.value.id);assert.ok(undo.ok);
  assert.deepEqual((await sa.refresh()).value.snapshot.days,a.fixture.snapshot.days);
});
