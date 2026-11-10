import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pricingSnapshot, dateInZone, type PricingContext } from '../dynamic-pricing-inputs.ts';
import type { RatePlanRow, RateDayRow } from '../rate-plan.ts';
import { previewPricing, defaultPricingPolicy } from '../dynamic-pricing.ts';
const now=new Date('2026-11-08T12:00:00Z');
function context():PricingContext {return {property:{id:'test',calendar_authority:'helm',is_active:true,timezone:'America/New_York'},
  plan:{property_id:'test',currency:'USD',base_nightly_cents:30000,weekend_nightly_cents:40000,weekend_days:[5,6],
    min_nights_default:2,advance_notice_hours:0,turnover_buffer_days:0,booking_window_days:365,checkin_time:'16:00'} as RatePlanRow,
  rateDays:[],periods:[],bookings:[],mirror:[]};}
test('native inputs use the authoritative rate calendar, real holds, and manual override protection',()=>{
  const c=context();c.rateDays=[{property_id:'test',date:'2026-11-08',nightly_cents:34500,source:'operator',min_nights:4} as RateDayRow];
  c.bookings=[{status:'confirmed',check_in:'2026-11-09',check_out:'2026-11-11',booked_at:null},
    {status:'block',check_in:'2026-11-12',check_out:'2026-11-13',hold_kind:'owner',booked_at:null}];
  const s=pricingSnapshot(c,'2026-11-08',60,now);
  assert.equal(s.days[0].currentCents,34500);assert.equal(s.days[0].protected,true);assert.equal(s.days[0].minNights,4);
  assert.equal(s.days[1].state,'booked');assert.equal(s.days[3].state,'open');assert.equal(s.days[4].state,'blocked');
  assert.equal(s.days[5].currentCents,40000);
});
test('never loses OTA duplicate closures and does not turn seasonal closures into vacancy',()=>{
  const c=context();c.bookings=[{status:'block',check_in:'2026-11-09',check_out:'2026-11-11',duplicate_of:'other',source:'ical_import',hold_kind:'ota',channel:'booking_com',booked_at:null}];
  c.periods=[{start_month:5,start_day:1,end_month:10,end_day:31}];
  const s=pricingSnapshot(c,'2026-11-08',60,now);
  assert.equal(s.days[0].state,'blocked');assert.equal(s.days[1].state,'blocked');
  c.bookings.push({status:'confirmed',check_in:'2026-11-09',check_out:'2026-11-10',booked_at:null});
  const withStay=pricingSnapshot(c,'2026-11-08',60,now);
  assert.equal(withStay.days[1].state,'booked');assert.equal(withStay.days[2].state,'blocked');
});
test('Guesty mirror preserves missing and stale data, and never treats another currency as USD',()=>{
  const c=context();c.property.calendar_authority='guesty';c.mirror=[{date:'2026-11-08',status:'available',price:500,currency:'EUR',min_nights:3,synced_at:now.toISOString()},
    {date:'2026-11-09',status:'available',price:300,currency:'USD',min_nights:2,synced_at:'2026-11-01T12:00:00Z'}];
  const s=pricingSnapshot(c,'2026-11-08',60,now);
  assert.equal(s.days[0].currentCents,null);assert.equal(s.days[1].currentCents,30000);assert.equal(s.days[2].state,'unknown');
  assert.ok(previewPricing(defaultPricingPolicy(30000,15000,90000),s,now).days.every(d=>!d.eligible));
});
test('does not present potentially backfilled booking timestamps as booking recency',()=>{
  const c=context();c.bookings=[{status:'confirmed',check_in:'2026-11-20',check_out:'2026-11-22',booked_at:'2026-11-07T12:00:00Z'}];
  assert.equal(pricingSnapshot(c,'2026-11-08',60,now).lastBookedOn,null);
});
test('property date respects its timezone across midnight and DST',()=>{
  assert.equal(dateInZone(new Date('2026-11-08T04:30:00Z'),'America/New_York'),'2026-11-07');
  assert.equal(dateInZone(new Date('2026-11-08T04:30:00Z'),'Europe/London'),'2026-11-08');
  assert.throws(()=>pricingSnapshot(context(),'2026-11-08',501,now));
});
