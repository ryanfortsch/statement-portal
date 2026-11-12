import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadPricingMultiCalendars,pricingMultiDates,pricingMultiDraft,preparePricingBulkOverride} from '../dynamic-pricing-multicalendar.ts';
import {emptyPricingDrafts,neutralPricingDraft,type PricingDrafts,type PricingOverride} from '../dynamic-pricing-drafts.ts';
import {createPricingDemo} from '../dynamic-pricing-demo.ts';
import type {PricingLiveCalendar} from '../dynamic-pricing-live.ts';

const now=new Date('2026-11-11T16:00:00Z');
function calendar(id='test-a'):PricingLiveCalendar {
  const snapshot=createPricingDemo(now).snapshot;delete snapshot.evidence;snapshot.market=[];
  snapshot.days=snapshot.days.map(d=>({...d,state:'open',protected:false,currentCents:20000,minNights:2}));
  return {home:{id,name:id,city:'Example',bedrooms:3,authority:'guesty',timezone:'America/New_York'},snapshot,source:'Synthetic mirror',sourceObservedAt:now.toISOString()};
}
function drafts(ids=['test-a','test-b']):PricingDrafts {
  return {...emptyPricingDrafts(),homes:Object.fromEntries(ids.map(id=>[id,{policy:neutralPricingDraft(20000,10000,40000),version:1,groupId:null,inheritRules:false,overrides:[]}]))};
}
const override:PricingOverride={id:'test-override',label:'Test override',start:'2026-11-11',end:'2026-11-24',kind:'fixed',value:30000,minNights:3,weekdays:[0,1,2,3,4,5,6]};

test('calendar loading limits concurrency to four, retains failed rows and rejects crossed listing responses',async()=>{
  let pending=0,max=0;
  const ids=Array.from({length:26},(_,i)=>`test-${i}`),result=await loadPricingMultiCalendars([...ids,ids[0]],async id=>{
    pending++;max=Math.max(max,pending);await new Promise(r=>setTimeout(r,1));pending--;
    if(id==='test-2')throw Error('synthetic failure');if(id==='test-3')return {ok:false,error:'unavailable'};
    return {ok:true,value:calendar(id==='test-4'?'wrong-id':id)};
  });
  assert.equal(max,4);assert.equal(result.length,26);assert.deepEqual(result.map(r=>r.id),ids);assert.equal(result.filter(r=>!r.calendar).length,3);
});
test('cancelled calendar loads stop queued work',async()=>{
  let cancelled=false,calls=0;
  const result=await loadPricingMultiCalendars(Array.from({length:26},(_,i)=>String(i)),async id=>{calls++;await Promise.resolve();cancelled=true;return {ok:true,value:calendar(id)};},()=>cancelled);
  assert.equal(calls,4);assert.equal(result.length,4);
});
test('date columns are civil dates through leap days and month/year boundaries',()=>{
  assert.deepEqual(pricingMultiDates('2028-02-27',7),['2028-02-27','2028-02-28','2028-02-29','2028-03-01','2028-03-02','2028-03-03','2028-03-04']);
  assert.equal(pricingMultiDates('2026-12-29',14).at(-1),'2027-01-11');
  for(const [date,count] of [['2027-02-29',7],['bad',14],['2026-11-11',90]] as const)assert.throws(()=>pricingMultiDates(date,count));
});
test('multi-calendar does not invent drafts and does not display stale calendars as current',()=>{
  const c=calendar();assert.equal(pricingMultiDraft(c,emptyPricingDrafts(),now).preview,null);
  c.snapshot.days[0].observedAt='2026-11-01T00:00:00Z';
  const result=pricingMultiDraft(c,drafts(),now);assert.equal(result.snapshot.days[0].state,'unknown');assert.equal(result.snapshot.days[0].currentCents,null);assert.equal(result.preview?.days[0].recommendedCents,null);
  assert.equal(c.snapshot.days[0].state,'open');
});
test('bulk overrides prepare all selected listings atomically and leave unselected homes unchanged',()=>{
  const state=drafts(['test-a','test-b','test-c']),before=JSON.stringify(state),result=preparePricingBulkOverride(state,['test-a','test-b','test-a'],[calendar('test-a'),calendar('test-b')],override,now);
  assert.equal(JSON.stringify(state),before);assert.equal(result.changes.length,2);assert.equal(result.next.homes['test-a'].version,2);assert.equal(result.next.homes['test-c'].version,1);
  assert.equal(result.next.homes['test-a'].overrides.length,1);assert.equal(result.changes[0].changed,14);assert.equal(result.changes[0].minimumCents,30000);
});
test('multi-calendar keeps the listing’s session evidence and refuses evidence from another home',()=>{
  const c=calendar(),evidence=createPricingDemo(now).snapshot.evidence!;
  c.snapshot.evidence={...evidence,propertyId:c.home.id};
  const matched=pricingMultiDraft(c,drafts(),now);
  assert.ok(matched.preview);assert.equal(matched.snapshot.evidence?.propertyId,c.home.id);
  c.snapshot.evidence.propertyId='another-home';
  const crossed=pricingMultiDraft(c,drafts(),now);
  assert.equal(crossed.preview,null);assert.equal(crossed.error,'Draft rules need review');
});
test('bulk summaries distinguish protected inventory, limited prices and review-required drafts',()=>{
  const c=calendar(),state=drafts();c.snapshot.days[0].state='booked';c.snapshot.days[1].state='blocked';c.snapshot.days[2].protected=true;
  const result=preparePricingBulkOverride(state,['test-a'],[c],{...override,value:50000},now),summary=result.changes[0];
  assert.equal(summary.changed,11);assert.equal(summary.skipped,3);assert.equal(summary.limited,11);assert.equal(summary.minimumCents,40000);assert.equal(summary.review,11);
  const model=pricingMultiDraft(c,result.next,now);assert.equal(model.preview?.days[0].recommendedCents,null);assert.equal(model.preview?.days[2].recommendedCents,20000);
});
test('any overlapping listing override rejects the whole batch without replacing earlier edits',()=>{
  const state=drafts();state.homes['test-b'].overrides=[{...override,id:'existing'}];const before=JSON.stringify(state);
  assert.throws(()=>preparePricingBulkOverride(state,['test-a','test-b'],[calendar('test-a'),calendar('test-b')],override,now),/test-b: conflicts/);assert.equal(JSON.stringify(state),before);
});
test('bulk listing overrides take priority over group rules without compounding inherited percentages',()=>{
  const state=drafts();state.groups=[{id:'g',name:'Synthetic group',policy:neutralPricingDraft(20000,10000,40000),overrides:[{...override,id:'group',kind:'percent',value:10}],parentId:null}];state.homes['test-a'].groupId='g';
  const result=preparePricingBulkOverride(state,['test-a'],[calendar()],{...override,kind:'percent',value:-10},now);
  assert.equal(result.changes[0].minimumCents,18000);assert.equal(result.next.groups[0].overrides[0].value,10);
});
test('bulk limits use each night’s inherited seasonal bounds',()=>{
  const state=drafts();state.account={policy:neutralPricingDraft(20000,10000,40000),ruleCategories:[],overrides:[],seasonalPrices:[{id:'season',name:'Synthetic season',start:override.start,end:override.end,repeat:false,kind:'percent',base:0,min:0,max:25,weekdayMin:null,weekendMin:null}]};
  const result=preparePricingBulkOverride(state,['test-a'],[calendar()],{...override,value:60000},now);assert.equal(result.changes[0].maximumCents,50000);
});
test('bulk overrides reject missing, unknown, stale and out-of-horizon evidence rather than saving partial work',()=>{
  for(const mutation of [(c:PricingLiveCalendar)=>{c.snapshot.days[3].state='unknown';},(c:PricingLiveCalendar)=>{c.snapshot.days[3].observedAt='2026-11-01T00:00:00Z';},(c:PricingLiveCalendar)=>{c.snapshot.days=c.snapshot.days.slice(0,7);}]){
    const c=calendar('test-b');mutation(c);assert.throws(()=>preparePricingBulkOverride(drafts(),['test-a','test-b'],[calendar(),c],override,now),/test-b: refresh/);
  }
  assert.throws(()=>preparePricingBulkOverride(drafts(),['test-b'],[],override,now),/load the calendar/);
  assert.throws(()=>preparePricingBulkOverride(emptyPricingDrafts(),['test-a'],[calendar()],override,now),/configure prices/);
});
test('weekday selection and minimum-stay-only edits preserve rates and exclude nonmatching dates',()=>{
  const result=preparePricingBulkOverride(drafts(),['test-a'],[calendar()],{...override,kind:'stay',value:0,weekdays:[5,6]},now);
  assert.equal(result.changes[0].changed,4);assert.equal(result.changes[0].minimumCents,20000);
  const preview=pricingMultiDraft(calendar(),result.next,now).preview!;assert.equal(preview.days[0].minNights,2);assert.equal(preview.days[2].minNights,3);
});
test('empty selections, invalid override amounts, and zero available changes do not produce a saved draft',()=>{
  assert.throws(()=>preparePricingBulkOverride(drafts(),[],[],override,now),/Select at least/);
  assert.throws(()=>preparePricingBulkOverride(drafts(),['test-a'],[calendar()],{...override,value:-100},now));
  const c=calendar();c.snapshot.days=c.snapshot.days.map(d=>({...d,state:'booked'}));assert.throws(()=>preparePricingBulkOverride(drafts(),['test-a'],[c],override,now),/No available nights/);
});
