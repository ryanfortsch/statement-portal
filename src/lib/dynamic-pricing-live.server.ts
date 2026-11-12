import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import {selectAllPaged} from './paged-select.ts';
import {dateInZone,pricingSnapshot,type PricingContext} from './dynamic-pricing-inputs.ts';
import {shiftIsoDay} from './sca-quotes-types.ts';
import {currentPricingSnapshot,pricingLiveRow,type PricingLiveHome,type PricingLiveCalendar,type PricingLivePortfolio} from './dynamic-pricing-live.ts';
import type {RatePlanRow,RateDayRow} from './rate-plan.ts';
import {pricingBookingActivity,type PricingActivityBooking,type PricingActivityTimestamp} from './dynamic-pricing-activity.ts';

const registryColumns='id,name,city,bedrooms,timezone,calendar_authority';
type RegistryHome={id:string;name:string;city:string;bedrooms:number|null;timezone:string|null;calendar_authority:'helm'|'guesty'};
const homeFrom=(r:RegistryHome):PricingLiveHome=>({id:r.id,name:r.name,city:r.city,bedrooms:r.bedrooms,timezone:r.timezone??'America/New_York',authority:r.calendar_authority});

/** Original booking dates only. No guest identities, financials or event payloads. */
export async function readPricingBookingActivity(db:SupabaseClient,home:PricingLiveHome,now=new Date()) {
  const floor=shiftIsoDay(dateInZone(now,home.timezone),-44);
  const bookings=await selectAllPaged<PricingActivityBooking>((from,to)=>db.from('bookings')
    .select('id,status,duplicate_of,source,external_confirmation_code,check_in,check_out,booked_at')
    .eq('property_id',home.id).is('duplicate_of',null).in('status',['confirmed','completed']).gt('check_out',floor)
    .order('id').range(from,to),{label:'Pricing booking dates',maxRows:10000});
  // Read timestamp evidence on this property only. Never let stale Guesty status
  // resurrect a cancelled booking, and never match on guest name or dates alone.
  const timestamps=bookings.some(b=>b.source!=='direct_booking'&&b.external_confirmation_code)?
    await selectAllPaged<PricingActivityTimestamp>((from,to)=>db.from('guesty_reservations')
      .select('confirmation_code,check_in,check_out,booked_at').eq('property_id',home.id).gt('check_out',floor)
      .order('guesty_reservation_id').range(from,to),{label:'Pricing original dates',maxRows:10000}):[];
  return pricingBookingActivity(bookings,timestamps,home.timezone,now);
}

/** Caller must be an owner route or the explicitly authorized, authenticated localhost preview. SELECT only. */
export async function readPricingLiveHomes(db:SupabaseClient):Promise<PricingLiveHome[]> {
  const rows=await selectAllPaged<RegistryHome>((from,to)=>db.from('properties').select(registryColumns)
    .eq('is_active',true).eq('kind','managed').order('id').range(from,to),{label:'Pricing registry',maxRows:1000});
  return rows.map(homeFrom).sort((a,b)=>a.name.localeCompare(b.name,'en',{numeric:true,sensitivity:'base'}));
}

export async function readPricingLiveCalendar(db:SupabaseClient,home:PricingLiveHome,now=new Date()):Promise<PricingLiveCalendar> {
  const start=dateInZone(now,home.timezone),end=shiftIsoDay(start,179);
  const context:PricingContext={property:{id:home.id,is_active:true,calendar_authority:home.authority,timezone:home.timezone},plan:null,rateDays:[],periods:[],bookings:[],mirror:[]};
  if(home.authority==='guesty') {
    context.mirror=await selectAllPaged<PricingContext['mirror'][number]>((from,to)=>db.from('property_calendar_days')
      .select('date,status,price,currency,min_nights,synced_at').eq('property_id',home.id).gte('date',start).lte('date',end).order('date').range(from,to),{label:'Pricing calendar',maxRows:1000});
  } else {
    const [plan,days,periods,bookings]=await Promise.all([
      db.from('property_rate_plans').select('property_id,currency,base_nightly_cents,weekend_nightly_cents,weekend_days,min_nights_default,advance_notice_hours,booking_window_days,turnover_buffer_days,checkin_time').eq('property_id',home.id).maybeSingle(),
      selectAllPaged<Omit<RateDayRow,'note'>>((from,to)=>db.from('property_rate_days').select('property_id,date,nightly_cents,min_nights,cta,ctd,closed,source')
        .eq('property_id',home.id).gte('date',start).lte('date',end).order('date').range(from,to),{label:'Pricing nights',maxRows:1000}),
      selectAllPaged<PricingContext['periods'][number]>((from,to)=>db.from('property_rental_periods').select('start_month,start_day,end_month,end_day')
        .eq('property_id',home.id).order('id').range(from,to),{label:'Pricing seasons',maxRows:1000}),
      selectAllPaged<Omit<PricingContext['bookings'][number],'booked_at'>>((from,to)=>db.from('bookings').select('status,check_in,check_out,duplicate_of,hold_kind,source,channel')
        .eq('property_id',home.id).in('status',['confirmed','completed','block']).lte('check_in',shiftIsoDay(end,30)).gt('check_out',shiftIsoDay(start,-30)).order('id').range(from,to),{label:'Pricing availability',maxRows:10000}),
    ]);
    if(plan.error||!plan.data||plan.data.currency!=='USD')throw Error('Current pricing is unavailable');
    // Availability only consumes this explicitly selected subset. No guest identities, notes or money ledger fields are read.
    context.plan=plan.data as RatePlanRow;context.rateDays=days.map(d=>({...d,note:null}));context.periods=periods;context.bookings=bookings.map(b=>({...b,booked_at:null}));
  }
  const raw=pricingSnapshot(context,start,180,now),snapshot=currentPricingSnapshot(raw,now);
  const stamps=(home.authority==='guesty'?context.mirror.map(d=>d.synced_at):[now.toISOString()]).filter(Boolean).sort();
  // A missing timestamp column or ambiguous stay must not erase a usable calendar.
  const activity=await readPricingBookingActivity(db,home,now).catch(()=>undefined);
  return {home,snapshot,source:home.authority==='helm'?'Helm calendar':'Guesty calendar mirror',sourceObservedAt:stamps[0]??null,activity};
}

export async function readPricingLivePortfolio(db:SupabaseClient,now=new Date()):Promise<PricingLivePortfolio> {
  const homes=await readPricingLiveHomes(db),rows:PricingLivePortfolio['rows']=new Array(homes.length);
  let next=0;
  await Promise.all(Array.from({length:Math.min(4,homes.length)},async()=>{
    while(next<homes.length) {
      const index=next++,home=homes[index],start=dateInZone(now,home.timezone);
      try {const calendar=await readPricingLiveCalendar(db,home,now);rows[index]={...pricingLiveRow(home,calendar.snapshot,now,start),observedAt:calendar.sourceObservedAt,activity:calendar.activity};}
      catch {rows[index]={...pricingLiveRow(home,null,now,start),activity:await readPricingBookingActivity(db,home,now).catch(()=>undefined)};}
    }
  }));
  return {readAt:now.toISOString(),rows};
}
