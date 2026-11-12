import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {pricingBookingActivity,pricingActivityValue,type PricingActivityBooking as Booking,type PricingActivityTimestamp as Timestamp} from '../dynamic-pricing-activity.ts';
import {readPricingBookingActivity} from '../dynamic-pricing-live.server.ts';
import {pricingLiveRow} from '../dynamic-pricing-live.ts';
import {sortPricingPortfolioRows} from '../dynamic-pricing-portfolio.ts';

const now=new Date('2026-11-11T02:00:00Z'),zone='America/New_York'; // Nov 10 locally, across DST change.
const stay:Booking={id:'synthetic-1',source:'ical_import',status:'confirmed',duplicate_of:null,external_confirmation_code:'TEST-1',check_in:'2027-10-01',check_out:'2027-10-06',booked_at:now.toISOString()};
const stamp:Timestamp={confirmation_code:'test-1',check_in:stay.check_in,check_out:stay.check_out,booked_at:'2026-11-04T05:00:00Z'};
const activity=(b:Booking[]=[stay],t:Timestamp[]=[stamp])=>pricingBookingActivity(b,t,zone,now);

test('recent booking windows use local dates across DST and count whole stays beyond the pricing horizon',()=>{
  const a=activity();assert.equal(a.today,'2026-11-10');assert.deepEqual(a.windows[7],{start:'2026-11-04',end:'2026-11-10',bookings:1,nights:5});
  assert.equal(a.windows[45].start,'2026-09-27');assert.equal(a.lastVerifiedBookedOn,'2026-11-04');assert.equal(pricingActivityValue(a,7),'5');
});
test('booking at the exclusive lower boundary is outside seven days but inside 45',()=>{
  const a=activity([stay],[{...stamp,booked_at:'2026-11-04T04:59:59Z'}]);assert.equal(a.windows[7].nights,0);assert.equal(a.windows[45].nights,5);
});
test('an import timestamp or manual entry never establishes a new booking',()=>{
  for(const source of ['ical_import','guesty_legacy','manual']){const a=activity([{...stay,source}],[]);assert.equal(a.undatedStays,1);assert.equal(a.verifiedStays,0);assert.equal(pricingActivityValue(a,7),'–');}
  const native=activity([{...stay,source:'direct_booking'}],[]);assert.equal(native.windows[7].nights,5);assert.equal(native.undatedStays,0);
});
test('original timestamps require matching code and dates, not dates alone',()=>{
  for(const candidate of [{...stamp,confirmation_code:'different'}, {...stamp,check_out:'2027-10-07'}, {...stamp,confirmation_code:null}])assert.equal(activity([stay],[candidate]).undatedStays,1);
});
test('cancelled, duplicate, blocked and inquiry rows never add demand even with a timestamp',()=>{
  const a=activity([stay,{...stay,id:'duplicate',duplicate_of:stay.id},...['cancelled','block','inquiry'].map(status=>({...stay,id:status,status}))]);
  assert.equal(a.windows[7].bookings,1);assert.equal(a.windows[7].nights,5);assert.equal(a.undatedStays,0);
});
test('matching mirror copies cannot double count and conflicting or missing dates stay unknown',()=>{
  assert.equal(activity([stay,stay],[stamp,stamp]).windows[7].nights,5);
  for(const booked_at of [null,'2026-11-05T12:00:00Z'])assert.equal(activity([stay],[stamp,{...stamp,booked_at}]).undatedStays,1);
  assert.throws(()=>activity([stay,{...stay,check_out:'2027-10-08'}]),/Ambiguous/);
});
test('invalid, future, offsetless and after-checkout timestamps cannot create demand',()=>{
  for(const booked_at of ['nonsense','2026-11-11T03:00:00Z','2026-02-30T12:00:00Z','2026-11-10T12:00:00'])assert.equal(activity([stay],[{...stamp,booked_at}]).undatedStays,1);
  const old={...stay,check_in:'2026-11-02',check_out:'2026-11-03'};
  assert.equal(activity([old],[{...stamp,check_in:old.check_in,check_out:old.check_out}]).undatedStays,1);
  assert.throws(()=>activity([{...stay,check_out:'2027-02-30'}]),/Invalid/);
});
test('completed recent stays count, but already-ended stays before the activity window do not affect coverage',()=>{
  const b={...stay,status:'completed',check_in:'2026-11-05',check_out:'2026-11-07'},a=activity([b,{...stay,id:'old',check_in:'2026-09-01',check_out:'2026-09-27'}],[{...stamp,check_in:b.check_in,check_out:b.check_out}]);
  assert.equal(a.windows[7].nights,2);assert.equal(a.verifiedStays,1);assert.equal(a.undatedStays,0);
});
test('partial positives are explicit minimums while complete zero and unavailable remain distinct',()=>{
  const a=activity([stay,{...stay,id:'unknown',external_confirmation_code:null}], [stamp]);
  assert.equal(pricingActivityValue(a,7),'≥5');assert.equal(pricingActivityValue(a,7,'bookings'),'≥1');
  assert.equal(pricingActivityValue(activity([],[]),7),'0');assert.equal(pricingActivityValue(undefined,7),'–');
  const json=JSON.stringify(a);assert.ok(!/TEST-1|synthetic-1|check_in|confirmation_code|booked_at/.test(json));
});
test('activity sorting keeps partial measurements last in both directions and ignores the occupancy period',()=>{
  const home={id:'a',name:'1 Test',authority:'guesty' as const,city:'Example',bedrooms:2,timezone:zone};
  const a={...pricingLiveRow(home,null,now,'2026-11-10'),activity:activity()},b={...a,id:'b',name:'2 Test',activity:activity([],[])},c={...a,id:'c',name:'3 Test',activity:{...activity(),undatedStays:1}};
  assert.deepEqual(sortPricingPortfolioRows([c,b,a],{sort:'booked7',direction:'desc',window:90}).map(r=>r.id),['a','b','c']);
  assert.deepEqual(sortPricingPortfolioRows([c,b,a],{sort:'booked45',direction:'asc',window:7}).map(r=>r.id),['b','a','c']);
});
test('reader scopes both sources to one home, uses canonical status and sends only aggregate activity',async()=>{
  const calls:{table:string;method:string;args:unknown[]}[]=[];
  const db={from(table:string){const q:Record<string,unknown>={then(resolve:(r:unknown)=>unknown){return Promise.resolve(resolve({error:null,data:table==='bookings'?[stay]:[stamp]}));}};
    for(const method of ['select','eq','is','in','gt','order','range'])q[method]=(...args:unknown[])=>{calls.push({table,method,args});return q;};return q;
  }} as unknown as SupabaseClient;
  const result=await readPricingBookingActivity(db,{id:'test_home',name:'Test',city:'Example',bedrooms:2,authority:'guesty',timezone:zone},now);
  assert.equal(result.windows[7].nights,5);
  assert.deepEqual(calls.filter(c=>c.method==='eq').map(c=>c.args),[['property_id','test_home'],['property_id','test_home']]);
  assert.ok(calls.some(c=>c.method==='is'&&c.args[0]==='duplicate_of'&&c.args[1]===null));
  assert.ok(calls.some(c=>c.method==='in'&&JSON.stringify(c.args)===JSON.stringify(['status',['confirmed','completed']])));
  assert.ok(calls.filter(c=>c.method==='select').every(c=>!/(\*|guest_name|email|phone|money|payout|folio|created_at|first_seen_at)/.test(String(c.args[0]))));
  assert.equal('bookings' in result,false);
});
