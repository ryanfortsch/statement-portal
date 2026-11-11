'use client';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { previewPricing, pricingPolicySchema, type PricingPolicy, type PricingSnapshot } from '@/lib/dynamic-pricing';
import type { PricingProfile, PricingRunSummary } from '@/lib/dynamic-pricing-store';
import PricingInsights from './PricingInsights';
import PricingHistory from './PricingHistory';
import PricingCalendar from './PricingCalendar';
import PricingIcon from './PricingIcon';
import PricingOccupancy,{PricingOccupancyKey} from './PricingOccupancy';
import './pricing.css';
import {etStamp} from '@/lib/stable-time';
import {pricingOccupancyWindow} from '@/lib/dynamic-pricing-portfolio';
import type {PricingObservationRecord,PricingTracking} from '@/lib/dynamic-pricing-observations';
import { capturePricingObservationAction,setPricingTrackingAction,savePricingEvidenceAction, publishPricingAction, refreshPricingAction, reviewPricingAction, savePricingAction, undoPricingAction } from './actions';

export const livePricingServices={save:savePricingAction,refresh:refreshPricingAction,review:reviewPricingAction,publish:publishPricingAction,undo:undoPricingAction,evidence:savePricingEvidenceAction,observe:capturePricingObservationAction,tracking:setPricingTrackingAction};
export type PricingServices=typeof livePricingServices;
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const weekdays=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const inputClass='mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
function NumberField({label,value,onChange,step=1}:{label:string;value:number;onChange:(n:number)=>void;step?:number}) {
  return <label className="block text-sm text-slate-700">{label}<input type="number" step={step} value={Number.isFinite(value)?value:''}
    onChange={e=>onChange(e.target.value===''?NaN:Number(e.target.value))} className={inputClass}/></label>;
}
export default function PricingWorkbench({propertyId,name,authority,navigation,initialPolicy,initialSnapshot,initialProfile,initialRuns,initialEvidenceVersion=0,initialObservations=[],initialTracking={enabled:false,version:0},scheduledCaptureEnabled=false,services=livePricingServices}:{
  propertyId:string;name:string;authority:'helm'|'guesty';navigation?:ReactNode;initialPolicy:PricingPolicy;initialSnapshot:PricingSnapshot;
  initialProfile:PricingProfile|null;initialRuns:PricingRunSummary[];initialEvidenceVersion?:number;services?:PricingServices;
  initialObservations?:PricingObservationRecord[];initialTracking?:PricingTracking;scheduledCaptureEnabled?:boolean;
}) {
  const [policy,setPolicy]=useState(initialPolicy),[snapshot,setSnapshot]=useState(initialSnapshot),[profile,setProfile]=useState(initialProfile);
  const [runs,setRuns]=useState(initialRuns),[mode,setMode]=useState<'shadow'|'helm_direct'>(initialProfile?.mode??'shadow');
  const [review,setReview]=useState<{id:string;createdAt:string}|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const [evidenceVersion,setEvidenceVersion]=useState(initialEvidenceVersion);
  const [observations,setObservations]=useState(initialObservations),[tracking,setTracking]=useState(initialTracking),[collectorEnabled,setCollectorEnabled]=useState(scheduledCaptureEnabled);
  const captureRequest=useRef<string|null>(null);
  const [section,setSection]=useState<'prices'|'market'|'occupancy'|'history'|'data'>('prices');const {ask}=useConfirm();
  const customizations=useRef<HTMLDialogElement>(null),moreMenu=useRef<HTMLDetailsElement>(null);
  const openCustomizations=()=>customizations.current?.showModal();
  function showSection(next:typeof section){setSection(next);if(moreMenu.current)moreMenu.current.open=false;}
  const listingMetrics=useMemo(()=>[30,60,90].map(n=>pricingOccupancyWindow(snapshot,snapshot.today,n as 30|60|90,new Date(snapshot.observedAt))),[snapshot]);
  const changed=JSON.stringify(policy)!==JSON.stringify(profile?.policy??initialPolicy)||mode!==(profile?.mode??'shadow');
  const dirty=!profile||changed;
  useUnsavedWorkGuard(changed);
  const computed=useMemo(()=>{const parsed=pricingPolicySchema.safeParse(policy);
    return parsed.success?{preview:previewPricing(parsed.data,snapshot,new Date(snapshot.observedAt)),errors:[]}:
      {preview:null,errors:parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`)};
  },[policy,snapshot]);
  const preview=computed.preview,eligible=preview?.days.filter(d=>d.eligible)??[];
  const dateRange=[snapshot.days[0]?.date,snapshot.days.at(-1)?.date].filter(Boolean).map(date=>new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})).join(' – ');
  const modify=<K extends keyof PricingPolicy>(key:K,value:PricingPolicy[K])=>{setPolicy(p=>({...p,[key]:value}));setReview(null);};
  async function perform(work:()=>Promise<void>) {
    if(busy)return false;setBusy(true);setError('');setMessage('');
    let timer:ReturnType<typeof setTimeout>|undefined;
    try { await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('The response took too long. Refresh saved state before trying again; the request may have completed.')),30000);})]); return true; }
    catch(e){setError(e instanceof Error?e.message:'Request failed');setReview(null);return false;}
    finally{if(timer)clearTimeout(timer);setBusy(false);}
  }
  async function refresh() { const r=await services.refresh(propertyId);if(!r.ok)throw Error(r.error);
    setObservations(r.value.observations);setTracking(r.value.tracking);setCollectorEnabled(r.value.scheduledCaptureEnabled);
    setEvidenceVersion(r.value.evidenceVersion);setSnapshot(r.value.snapshot);setProfile(r.value.profile);setPolicy(r.value.policy);setMode(r.value.profile?.mode??'shadow');setRuns(r.value.runs);setReview(null);
  }
  async function saveRules() {return perform(async()=>{
    const r=await services.save({propertyId,policy,mode,version:profile?.version??0});if(!r.ok)throw Error(r.error);
    setProfile(r.value);setReview(null);
    await refresh();setMessage('');
  });}
  return <div className="helm-pricing">
    <header className="pricing-workbench-header">
      <div className="pricing-title-block" title={`${authority==='helm'?'Helm':'Guesty'} · Updated ${etStamp(snapshot.observedAt)}`}>{navigation}<h2 className={navigation?'sr-only':'pricing-property-title'}>{name}</h2></div>
      <div className="pricing-header-actions"><Button variant="quiet" className="pricing-connection" data-connected={profile?.mode==='helm_direct'||undefined} onClick={openCustomizations}>{profile?.mode==='helm_direct'?'Helm direct':'Compare only'}</Button>
        {changed&&!busy&&<span className="pricing-unsaved">Unsaved</span>}{busy&&<span role="status">Updating…</span>}
      </div>
    </header>
    <div className="pricing-navigation"><div role="group" aria-label="Pricing views" className="pricing-tabs">{([
      ['prices','Calendar'],['market','Market'],['occupancy','Performance'],
    ] as const).map(([id,label])=><Button key={id} variant="quiet" className="pricing-tab" aria-pressed={section===id} onClick={()=>setSection(id)}>{label}</Button>)}</div>
      <details ref={moreMenu} className="pricing-menu pricing-more"><summary className="pricing-columns-toggle" aria-label="More pricing tools" title="More pricing tools"><PricingIcon name="more"/></summary><div className="pricing-menu-panel">
        <Button variant="quiet" onClick={()=>showSection('history')}>History</Button><Button variant="quiet" onClick={()=>showSection('data')}>Data & model</Button>
        <Button variant="quiet" disabled={busy} onClick={()=>void perform(async()=>{if(changed&&!await ask({title:'Discard unsaved rules?',body:'Reload the saved rules and current calendar.',confirmLabel:'Discard and refresh'}))return;await refresh();if(moreMenu.current)moreMenu.current.open=false;})}>Reload saved prices</Button>
      </div></details>
    </div>
    {error&&<p role="alert" className="pricing-feedback">{error}</p>}
    {message&&<p role="status" className="pricing-feedback text-slate-600">{message}</p>}

    {computed.errors.length>0&&<div role="alert" className="text-sm text-red-700"><p>{computed.errors.join(' · ')}</p><Button variant="quiet" size="sm" onClick={openCustomizations}>Fix rules</Button></div>}
    <div hidden={section!=='prices'} className="pricing-property-layout">
      <aside className="pricing-sidebar" aria-label="Configure prices">
        <fieldset disabled={busy} className="pricing-configure">
          <div className="pricing-base-fields">
            <div className="pricing-base-primary"><NumberField label="Base price · $" value={policy.baseCents/100} step={0.01} onChange={n=>modify('baseCents',Math.round(n*100))}/></div>
            <NumberField label="Min · $" value={policy.floorCents/100} step={0.01} onChange={n=>modify('floorCents',Math.round(n*100))}/>
            <NumberField label="Max · $" value={policy.ceilingCents/100} step={0.01} onChange={n=>modify('ceilingCents',Math.round(n*100))}/>
          </div>
          <div className="pricing-configure-actions"><Button variant="primary" title="Save rules and refresh the preview. Does not publish rates." disabled={busy||!preview||!dirty} onClick={()=>void saveRules()}>{!dirty?'Saved':'Save'}</Button><Button variant="secondary" onClick={openCustomizations}><PricingIcon name="sliders"/>Rules</Button></div>
        </fieldset>
        <div className="pricing-listing-metrics" aria-label="Listing occupancy"><div className="pricing-metrics-heading"><h3>Occupancy</h3><PricingOccupancyKey/></div>{listingMetrics.map(w=><div className="pricing-listing-metric" key={w.nights}><span>{w.nights} days</span><PricingOccupancy window={w}/></div>)}</div>
      </aside>
      <div className="pricing-calendar-workspace"><PricingCalendar key={review?.id??'draft'} snapshot={snapshot} preview={preview}/></div>
    </div>
    <PricingInsights view={section==='occupancy'?'occupancy':section==='data'?'data':section==='market'?'market':'hidden'} propertyId={propertyId} snapshot={snapshot} preview={preview} policy={policy} busy={busy}
      onUseLearned={base=>{setPolicy(p=>({...p,baseCents:Math.max(p.floorCents,Math.min(p.ceilingCents,base)),priceShape:'history'}));setReview(null);setSection('prices');openCustomizations();}}
      onSave={async data=>perform(async()=>{const r=await services.evidence({propertyId,data,version:evidenceVersion});if(!r.ok)throw Error(r.error);
        setSnapshot(r.value.snapshot);setEvidenceVersion(r.value.evidenceVersion);setReview(null);setMessage('Data updated. Prepare a new review before publishing.');})}/>
    <div className="pricing-panel" hidden={section!=='history'}><PricingHistory observations={observations} tracking={tracking} scheduledCaptureEnabled={collectorEnabled} busy={busy} canCapture={!dirty}
      onCapture={()=>void perform(async()=>{const requestId=captureRequest.current??crypto.randomUUID();captureRequest.current=requestId;
        const r=await services.observe({propertyId,requestId});if(!r.ok)throw Error(r.error);
        await refresh();captureRequest.current=null;setMessage('Snapshot saved.');})}
      onTracking={enabled=>void perform(async()=>{const r=await services.tracking({propertyId,enabled,version:tracking.version});if(!r.ok)throw Error(r.error);
        setTracking(r.value.tracking);setObservations(r.value.observations);setCollectorEnabled(r.value.scheduledCaptureEnabled);setMessage(enabled?'Daily history requested.':'Daily history stopped.');})}/></div>
    <dialog ref={customizations} className="pricing-customizations-dialog" aria-labelledby="pricing-customizations-title" onClick={e=>{if(e.target===e.currentTarget)customizations.current?.close();}}>
      <header><h2 id="pricing-customizations-title">Customizations</h2><Button variant="quiet" className="pricing-icon-button" aria-label="Close customizations" onClick={()=>customizations.current?.close()}><PricingIcon name="close"/></Button></header>
      <fieldset disabled={busy} className="pricing-panel space-y-4">
      <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm">Seasonal pricing<select className={inputClass} value={policy.priceShape} onChange={e=>modify('priceShape',e.target.value as PricingPolicy['priceShape'])}>
        <option value="manual">Manual monthly and weekday factors</option><option value="history">Historical booked rates</option><option value="market">Market asking prices, scaled to my base</option></select></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={policy.marketPacingEnabled} onChange={e=>modify('marketPacingEnabled',e.target.checked)}/>Adjust for market pace and seven-day pickup</label></div>
      <p className="mt-2 text-xs text-slate-500">Market pricing requires 180 priced dates updated within 36 hours.</p>
      <details className="mt-6 border-t pt-4"><summary className="cursor-pointer font-medium">Monthly and weekday factors</summary>
        <p className="my-3 text-sm text-slate-500">1.00 keeps the base price; 1.20 adds 20%. Used with manual seasonal pricing.</p>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">{months.map((label,i)=><NumberField key={label} label={label} step={0.05} value={policy.monthlyFactors[i]}
          onChange={n=>modify('monthlyFactors',policy.monthlyFactors.map((v,j)=>j===i?n:v))}/>)}</div>
        <div className="mt-4 grid grid-cols-4 gap-3 sm:grid-cols-7">{weekdays.map((label,i)=><NumberField key={label} label={label} step={0.05} value={policy.weekdayFactors[i]}
          onChange={n=>modify('weekdayFactors',policy.weekdayFactors.map((v,j)=>j===i?n:v))}/>)}</div>
      </details>
      <details className="mt-5 border-t pt-4"><summary className="cursor-pointer font-medium">Discounts and premiums</summary>
        <div className="my-4 grid gap-4 sm:grid-cols-3">
          <NumberField label="Same-day discount (%)" value={policy.lastMinuteDiscountPct} onChange={n=>modify('lastMinuteDiscountPct',n)}/>
          <NumberField label="Discount fades over (days)" value={policy.lastMinuteDays} onChange={n=>modify('lastMinuteDays',n)}/>
          <NumberField label="Combined discount limit (%)" value={policy.maxCombinedDiscountPct} onChange={n=>modify('maxCombinedDiscountPct',n)}/>
          <NumberField label="Far-out premium starts (days)" value={policy.farOutStart} onChange={n=>modify('farOutStart',n)}/>
          <NumberField label="Full premium at (days)" value={policy.farOutEnd} onChange={n=>modify('farOutEnd',n)}/>
          <NumberField label="Far-out premium (%)" value={policy.farOutPremiumPct} onChange={n=>modify('farOutPremiumPct',n)}/>
          <NumberField label="Maximum change for publishing (%)" value={policy.maxChangePct} onChange={n=>modify('maxChangePct',n)}/>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={policy.occupancyEnabled} onChange={e=>modify('occupancyEnabled',e.target.checked)}/>Adjust for booked occupancy versus my targets</label>
        <p className="my-2 text-sm text-slate-500">Uses booked occupancy, excluding blocks. Each point off target adjusts price by 0.5%, up to your limit.</p>
        <div className="my-4 grid gap-4 sm:grid-cols-4">{['Next 15 nights target (%)','Nights 16–30 target (%)','Nights 31–60 target (%)'].map((label,i)=><NumberField key={label} label={label} value={policy.occupancyTargets[i]}
          onChange={n=>modify('occupancyTargets',policy.occupancyTargets.map((v,j)=>j===i?n:v))}/>)}
          <NumberField label="Occupancy adjustment limit (%)" value={policy.occupancyMaxAdjustmentPct} onChange={n=>modify('occupancyMaxAdjustmentPct',n)}/></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={policy.recencyEnabled} onChange={e=>modify('recencyEnabled',e.target.checked)}/>Booking recency discount (only with a verified booking timestamp)</label>
      </details>
      <details className="mt-5 border-t pt-4"><summary className="cursor-pointer font-medium">Minimum stays and short gaps</summary>
        <div className="my-4 grid gap-4 sm:grid-cols-4">
          <NumberField label="Weekday minimum nights" value={policy.weekdayMinNights} onChange={n=>modify('weekdayMinNights',n)}/>
          <NumberField label="Fri/Sat minimum nights" value={policy.weekendMinNights} onChange={n=>modify('weekendMinNights',n)}/>
          <NumberField label="Fill gaps up to (nights; 0 disables)" value={policy.orphanMaxNights} onChange={n=>modify('orphanMaxNights',n)}/>
          <NumberField label="Gap discount (%)" value={policy.orphanDiscountPct} onChange={n=>modify('orphanDiscountPct',n)}/>
        </div>
        <div className="my-4 grid gap-4 sm:grid-cols-3">
          <NumberField label="Lowest permitted minimum nights" value={policy.lowestMinNights} onChange={n=>modify('lowestMinNights',n)}/>
          <NumberField label="Minimum booking value ($; 0 disables)" value={policy.minimumBookingCents/100} onChange={n=>modify('minimumBookingCents',Math.round(n*100))}/>
          <NumberField label="Minimum after booked/block night (0 disables)" value={policy.adjacentMinNights} onChange={n=>modify('adjacentMinNights',n)}/>
        </div>
        <p className="my-2 text-xs text-slate-500">Booking-value rules set a minimum stay, not a guaranteed booking total.</p>
        <label className="my-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={policy.orphanPreservesEvents} onChange={e=>modify('orphanPreservesEvents',e.target.checked)}/>Preserve event minimums even inside short gaps</label>
        {policy.lastMinStays.map((r,i)=><div key={i} className="my-3 grid grid-cols-4 gap-3"><NumberField label={`Last minute ${i+1}: within days`} value={r.withinDays} onChange={n=>modify('lastMinStays',policy.lastMinStays.map((v,j)=>j===i?{...v,withinDays:n}:v))}/><NumberField label={`Last minute ${i+1}: weekdays`} value={r.weekday} onChange={n=>modify('lastMinStays',policy.lastMinStays.map((v,j)=>j===i?{...v,weekday:n}:v))}/><NumberField label={`Last minute ${i+1}: Fri/Sat`} value={r.weekend} onChange={n=>modify('lastMinStays',policy.lastMinStays.map((v,j)=>j===i?{...v,weekend:n}:v))}/><Button onClick={()=>modify('lastMinStays',policy.lastMinStays.filter((_,j)=>i!==j))}>Remove</Button></div>)}
        <Button disabled={policy.lastMinStays.length>=3} onClick={()=>modify('lastMinStays',[...policy.lastMinStays,{withinDays:7+policy.lastMinStays.length*7,weekday:1,weekend:2}])}>Add last-minute stay rule</Button>
        <label className="my-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={policy.safetyFloorEnabled} onChange={e=>modify('safetyFloorEnabled',e.target.checked)}/>Safety floor at 110% of matched last-year accommodation ADR</label>
        <NumberField label="Safety floor beyond (days)" value={policy.safetyFloorAfterDays} onChange={n=>modify('safetyFloorAfterDays',n)}/>
        <p className="my-2 text-xs text-slate-500">Needs at least two booked samples matching the weekday around 52 weeks earlier. Explicit events are excluded; your maximum price still wins.</p>
        {policy.farMinStays.map((r,i)=><div key={i} className="my-3 grid grid-cols-3 gap-3">
          <NumberField label={`Rule ${i+1}: beyond days`} value={r.afterDays} onChange={n=>modify('farMinStays',policy.farMinStays.map((v,j)=>j===i?{...v,afterDays:n}:v))}/>
          <NumberField label={`Rule ${i+1}: weekdays`} value={r.weekday} onChange={n=>modify('farMinStays',policy.farMinStays.map((v,j)=>j===i?{...v,weekday:n}:v))}/>
          <NumberField label={`Rule ${i+1}: Fri/Sat`} value={r.weekend} onChange={n=>modify('farMinStays',policy.farMinStays.map((v,j)=>j===i?{...v,weekend:n}:v))}/>
        </div>)}
      </details>
      <details className="mt-5 border-t pt-4"><summary className="cursor-pointer font-medium">Holidays and events</summary>
        <p className="my-3 text-sm text-slate-500">Add dates, a price adjustment and an optional minimum stay.</p>
        {policy.events.map((e,i)=><div key={i} className="my-3 grid items-end gap-3 rounded-lg border p-3 sm:grid-cols-3">
          <label className="text-sm">Event name<input aria-label={`Event ${i+1} name`} className={inputClass} value={e.label} onChange={a=>modify('events',policy.events.map((v,j)=>j===i?{...v,label:a.target.value}:v))}/></label>
          {(['start','end'] as const).map(key=><label key={key} className="text-sm">{key==='start'?'First night':'Last night'}<input aria-label={`Event ${i+1} ${key}`} type="date" className={inputClass} value={e[key]} onChange={a=>modify('events',policy.events.map((v,j)=>j===i?{...v,[key]:a.target.value}:v))}/></label>)}
          <NumberField label={`Event ${i+1} adjustment (%)`} value={e.adjustmentPct} onChange={n=>modify('events',policy.events.map((v,j)=>j===i?{...v,adjustmentPct:n}:v))}/>
          <NumberField label={`Event ${i+1} minimum nights (0 uses policy)`} value={e.minNights??0} onChange={n=>modify('events',policy.events.map((v,j)=>j===i?{...v,minNights:n===0?null:n}:v))}/>
          <Button onClick={()=>modify('events',policy.events.filter((_,j)=>j!==i))}>Remove event</Button>
        </div>)}
        <Button disabled={policy.events.length>=40} onClick={()=>modify('events',[...policy.events,{start:snapshot.today,end:snapshot.today,label:'New event',adjustmentPct:0,minNights:null}])}>Add event</Button>
      </details>
      <div className="mt-6 border-t pt-4"><label className="text-sm font-medium">Pricing connection<select className={inputClass} value={mode} onChange={e=>{setMode(e.target.value as typeof mode);setReview(null);}}>
        <option value="shadow">Compare only</option><option value="helm_direct" disabled={authority!=='helm'}>Connect Helm direct rates</option></select></label>
        <p className="my-3 text-sm text-slate-500">{authority==='guesty'?'Guesty controls this calendar. Direct publishing is unavailable until cutover.':
          'Direct publishing requires a review and confirmation. Disconnecting leaves published rates in place; use Undo to restore them.'}</p>
      </div>
      </fieldset>
      {computed.errors.length>0&&<p role="alert" className="pricing-feedback">{computed.errors.join(' · ')}</p>}
      {error&&<p role="alert" className="pricing-feedback">{error}</p>}
      <footer><Button onClick={()=>customizations.current?.close()}>Done</Button><Button variant="primary" disabled={busy||!preview} onClick={async()=>{if(await saveRules())customizations.current?.close();}}>Save & refresh</Button></footer>
    </dialog>
    {section==='prices'&&profile?.mode==='helm_direct'&&<footer className="pricing-publish-bar" aria-label="Publish rates">
      <div><p className="text-sm font-medium">{review?`Review ready · ${eligible.length} nights`:`${eligible.length} nights ready for review`}</p>
        <p className="mt-1 text-xs text-slate-500">{dateRange} · {review?`Prepared ${etStamp(review.createdAt)} · expires after 5 minutes`:profile?.mode==='helm_direct'?'Direct bookings only. OTA rates unchanged.':'Compare only. Publishing is off.'}</p></div>
      <div className="flex flex-wrap gap-2">
        {!review?<Button variant="primary" disabled={busy||dirty||!eligible.length} onClick={()=>perform(async()=>{
            const r=await services.review(propertyId);if(!r.ok)throw Error(r.error);setSnapshot(r.value.snapshot);setProfile(r.value.profile);setPolicy(r.value.profile.policy);setMode(r.value.profile.mode);
            setReview({id:r.value.id,createdAt:r.value.createdAt});setSection('prices');setMessage('Review ready. Check the proposed rates before publishing.');
          })}>Review {eligible.length} nights</Button>:
          <><Button disabled={busy} variant="quiet" onClick={()=>setReview(null)}>Cancel review</Button><Button variant="primary" disabled={busy||dirty||!eligible.length} onClick={()=>perform(async()=>{
            if(!review||!await ask({title:`Publish ${eligible.length} nights for ${name}?`,body:`Applies across ${dateRange}, not just the displayed month. Updates direct-booking rates and minimum stays. Bookings and manual rates are protected. OTA rates are unchanged.`,confirmLabel:'Publish direct rates'}))return;
            const r=await services.publish(review.id);if(!r.ok)throw Error(r.error);await refresh();setMessage(`Published ${r.value} nights to Helm direct rates.`);
          })}>Publish {eligible.length} nights</Button></>}
      </div>
    </footer>}
    {runs.some(r=>r.status==='applied')&&<details className="border-t pt-4"><summary className="cursor-pointer text-sm font-medium">Published batches</summary>{runs.filter(r=>r.status==='applied').map(r=><div key={r.id} className="mt-3 flex items-center justify-between gap-3 text-sm">
      <span>{r.applied_at?etStamp(r.applied_at):'Published'}</span><Button size="sm" disabled={busy} onClick={()=>perform(async()=>{
        if(!await ask({title:'Restore the previous rates?',body:'Undo stops if any affected night has been edited since publication.',confirmLabel:'Undo batch'}))return;
        const result=await services.undo(r.id);if(!result.ok)throw Error(result.error);await refresh();setMessage(`Restored ${result.value} nights.`);
      })}>Undo batch</Button></div>)}</details>}
  </div>;
}
