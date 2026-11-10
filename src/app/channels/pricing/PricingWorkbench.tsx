'use client';
import { useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { defaultPricingPolicy, previewPricing, pricingPolicySchema, type PricingPolicy, type PricingSnapshot } from '@/lib/dynamic-pricing';
import type { PricingProfile, PricingRunSummary } from '@/lib/dynamic-pricing-store';
import PricingInsights from './PricingInsights';
import { savePricingEvidenceAction, publishPricingAction, refreshPricingAction, reviewPricingAction, savePricingAction, undoPricingAction } from './actions';

export const livePricingServices={save:savePricingAction,refresh:refreshPricingAction,review:reviewPricingAction,publish:publishPricingAction,undo:undoPricingAction,evidence:savePricingEvidenceAction};
export type PricingServices=typeof livePricingServices;
const money=(n:number|null)=>n===null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n/100);
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const weekdays=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const inputClass='mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
function NumberField({label,value,onChange,step=1}:{label:string;value:number;onChange:(n:number)=>void;step?:number}) {
  return <label className="block text-sm text-slate-700">{label}<input type="number" step={step} value={Number.isFinite(value)?value:''}
    onChange={e=>onChange(e.target.value===''?NaN:Number(e.target.value))} className={inputClass}/></label>;
}
export default function PricingWorkbench({propertyId,name,authority,initialPolicy,initialSnapshot,initialProfile,initialRuns,initialEvidenceVersion=0,services=livePricingServices}:{
  propertyId:string;name:string;authority:'helm'|'guesty';initialPolicy:PricingPolicy;initialSnapshot:PricingSnapshot;
  initialProfile:PricingProfile|null;initialRuns:PricingRunSummary[];initialEvidenceVersion?:number;services?:PricingServices;
}) {
  const [policy,setPolicy]=useState(initialPolicy),[snapshot,setSnapshot]=useState(initialSnapshot),[profile,setProfile]=useState(initialProfile);
  const [runs,setRuns]=useState(initialRuns),[mode,setMode]=useState<'shadow'|'helm_direct'>(initialProfile?.mode??'shadow');
  const [review,setReview]=useState<{id:string;createdAt:string}|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const [evidenceVersion,setEvidenceVersion]=useState(initialEvidenceVersion);
  const [view,setView]=useState('all');const {ask}=useConfirm();
  const dirty=!profile||JSON.stringify(policy)!==JSON.stringify(profile.policy)||mode!==profile.mode;
  useUnsavedWorkGuard(dirty);
  const computed=useMemo(()=>{const parsed=pricingPolicySchema.safeParse(policy);
    return parsed.success?{preview:previewPricing(parsed.data,snapshot,new Date(snapshot.observedAt)),errors:[]}:
      {preview:null,errors:parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`)};
  },[policy,snapshot]);
  const preview=computed.preview,eligible=preview?.days.filter(d=>d.eligible)??[];
  const modify=<K extends keyof PricingPolicy>(key:K,value:PricingPolicy[K])=>{setPolicy(p=>({...p,[key]:value}));setReview(null);};
  async function perform(work:()=>Promise<void>) {
    if(busy)return false;setBusy(true);setError('');setMessage('');
    let timer:ReturnType<typeof setTimeout>|undefined;
    try { await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('The response took too long. Refresh saved state before trying again; the request may have completed.')),30000);})]); return true; }
    catch(e){setError(e instanceof Error?e.message:'Request failed');setReview(null);return false;}
    finally{if(timer)clearTimeout(timer);setBusy(false);}
  }
  async function refresh() { const r=await services.refresh(propertyId);if(!r.ok)throw Error(r.error);
    setEvidenceVersion(r.value.evidenceVersion);setSnapshot(r.value.snapshot);setProfile(r.value.profile);setPolicy(r.value.policy);setMode(r.value.profile?.mode??'shadow');setRuns(r.value.runs);setReview(null);
  }
  const filtered=preview?.days.filter(d=>view==='all'||(view==='eligible'?d.eligible:!d.eligible))??[];
  return <div className="space-y-6">
    <section className="rounded-2xl border border-teal-200 bg-teal-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold text-teal-950">{name}</h2>
        <p className="mt-1 text-sm text-teal-900">{profile?.mode==='helm_direct'?'Connected to Helm direct rates · manual publishing':'Comparison mode · existing prices stay in control'}</p></div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-teal-800">Model v2 · prototype</span></div>
      <p className="mt-3 text-sm text-teal-900">Helm combines your calendar, reviewed evidence and explicit pricing rules. Market data can be imported for comparison; automatic market feeds and OTA publishing are not connected.</p>
    </section>
    {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {message&&<p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{message}</p>}
    <PricingInsights propertyId={propertyId} snapshot={snapshot} preview={preview} policy={policy} busy={busy}
      onUseLearned={base=>{setPolicy(p=>({...p,baseCents:Math.max(p.floorCents,Math.min(p.ceilingCents,base)),priceShape:'history'}));setReview(null);}}
      onSave={async data=>{return perform(async()=>{const r=await services.evidence({propertyId,data,version:evidenceVersion});if(!r.ok)throw Error(r.error);
        setSnapshot(r.value.snapshot);setEvidenceVersion(r.value.evidenceVersion);setReview(null);setMessage('Evidence saved. No live rates changed.');});}}/>
    <fieldset disabled={busy} className="rounded-2xl border bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">1. Set the policy</h2>
        <p className="mt-1 text-sm text-slate-500">Draft values need your review. All prices are per night before taxes, fees and length-of-stay discounts.</p></div>
        {propertyId==='65_calderwood'&&<Button size="sm" onClick={()=>{setPolicy(defaultPricingPolicy(44500,22500,120000));setReview(null);}}>Use Calderwood starting bounds</Button>}</div>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <NumberField label="Minimum nightly price ($)" value={policy.floorCents/100} step={0.01} onChange={n=>modify('floorCents',Math.round(n*100))}/>
        <NumberField label="Base nightly price ($)" value={policy.baseCents/100} step={0.01} onChange={n=>modify('baseCents',Math.round(n*100))}/>
        <NumberField label="Maximum nightly price ($)" value={policy.ceilingCents/100} step={0.01} onChange={n=>modify('ceilingCents',Math.round(n*100))}/>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm">Price shape<select className={inputClass} value={policy.priceShape} onChange={e=>modify('priceShape',e.target.value as PricingPolicy['priceShape'])}>
        <option value="manual">My monthly / weekday assumptions</option><option value="history">Learn from historical booked rates</option><option value="market">Normalize market asking prices to my base</option></select></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={policy.marketPacingEnabled} onChange={e=>modify('marketPacingEnabled',e.target.checked)}/>Adjust for market pace and seven-day pickup</label></div>
      <p className="mt-2 text-xs text-slate-500">Market shape needs at least 180 future priced dates and evidence no older than 36 hours. Shape options replace the manual seasonal factors; they do not stack them. Market pace is a bounded Helm heuristic.</p>
      <details className="mt-6 border-t pt-4" open><summary className="cursor-pointer font-medium">Seasonality and weekday assumptions</summary>
        <p className="my-3 text-sm text-slate-500">1.00 keeps the base price; 1.20 adds 20%. These are your assumptions. Neutral values do not capture Cape Ann’s summer demand.</p>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">{months.map((label,i)=><NumberField key={label} label={label} step={0.05} value={policy.monthlyFactors[i]}
          onChange={n=>modify('monthlyFactors',policy.monthlyFactors.map((v,j)=>j===i?n:v))}/>)}</div>
        <div className="mt-4 grid grid-cols-4 gap-3 sm:grid-cols-7">{weekdays.map((label,i)=><NumberField key={label} label={label} step={0.05} value={policy.weekdayFactors[i]}
          onChange={n=>modify('weekdayFactors',policy.weekdayFactors.map((v,j)=>j===i?n:v))}/>)}</div>
      </details>
      <details className="mt-5 border-t pt-4"><summary className="cursor-pointer font-medium">Lead time, occupancy and discount limits</summary>
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
        <p className="my-2 text-sm text-slate-500">Booked ÷ sellable nights. Owner blocks are excluded. This is on-the-books occupancy, not a forecast or a market comparison. Each percentage point off target changes price by 0.5%, up to the limit.</p>
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
        <p className="my-2 text-xs text-slate-500">Booking-value minimum divides the desired accommodation value by this night’s rate. It is a stay-length heuristic, not a quote guarantee. Event overrides, gap relaxation and the lowest permitted minimum then apply.</p>
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
        <p className="my-3 text-sm text-slate-500">Add known events explicitly. Helm does not discover events or estimate their demand yet.</p>
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
        <p className="my-3 text-sm text-slate-500">{authority==='guesty'?'This home is still run by Guesty. Compare here; finish calendar cutover before connecting direct rates.':
          'Connecting enables reviewed, manual publishing. Saving a policy does not change any rates. Switching back to comparison leaves previously published rates in place; use Undo to restore them.'}</p>
        {computed.errors.length>0&&<p role="alert" className="mb-3 text-sm text-red-700">{computed.errors.join(' · ')}</p>}
        <Button variant="primary" disabled={!dirty||!preview} onClick={()=>perform(async()=>{
          const r=await services.save({propertyId,policy,mode,version:profile?.version??0});if(!r.ok)throw Error(r.error);
          setProfile(r.value);setReview(null);setMessage('Policy saved. No nightly rates changed.');
        })}>Save policy{dirty?' · unsaved changes':''}</Button>
      </div>
    </fieldset>
    <section className="rounded-2xl border bg-white p-5 sm:p-6"><h2 className="text-lg font-semibold">2. Compare the next 180 nights</h2>
      <p className="mt-1 text-sm text-slate-500">Current rates: {authority==='helm'?'Helm direct calendar':'Guesty calendar mirror, not a direct PriceLabs feed'}. Snapshot: {snapshot.observedAt.replace('T',' ').slice(0,16)} UTC.</p>
      <div className="my-5 grid gap-3 sm:grid-cols-3">{preview?.occupancy.map((w,i)=><div key={w.start} className="rounded-xl bg-slate-50 p-4">
        <p className="text-xs text-slate-500">{['Next 15 nights','Nights 16–30','Nights 31–60'][i]} · booked occupancy</p>
        <p className="mt-1 text-2xl font-semibold">{w.pct===null?'Unknown':`${Math.round(w.pct)}%`}</p><p className="text-xs text-slate-500">{w.booked} booked / {w.sellable} sellable · {w.unknown} unknown</p></div>)}</div>
      <ul className="mb-5 list-disc space-y-1 pl-5 text-sm text-amber-800">{preview?.warnings.map(w=><li key={w}>{w}</li>)}</ul>
      <div className="flex flex-wrap items-center justify-between gap-3"><label className="text-sm">Show <select className="ml-2 rounded border p-2" value={view} onChange={e=>setView(e.target.value)}>
        <option value="all">All nights</option><option value="eligible">Eligible for publishing</option><option value="held">Kept or needs review</option></select></label>
        <Button disabled={busy} onClick={()=>perform(async()=>{if(dirty&&!await ask({title:'Reload saved policy?',body:'This replaces your unsaved edits.',confirmLabel:'Reload saved state'}))return;await refresh();setMessage('Saved policy and current calendar loaded.');})}>Refresh saved state</Button></div>
      <div className="mt-4 max-h-[580px] overflow-auto rounded-xl border"><table className="w-full min-w-[700px] text-left text-sm"><thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-600"><tr>
        {['Night','Current','Helm','Change','Min stay','Decision / explanation'].map(h=><th key={h} className="p-3 font-medium">{h}</th>)}</tr></thead>
        <tbody>{filtered.map(d=><tr key={d.date} className="border-t"><td className="whitespace-nowrap p-3">{d.date}</td><td className="p-3 tabular-nums">{money(d.currentCents)}</td>
          <td className="p-3 font-medium tabular-nums">{money(d.recommendedCents)}</td><td className="p-3 tabular-nums">{d.changePct===null?'—':`${d.changePct>0?'+':''}${d.changePct.toFixed(1)}%`}</td><td className="p-3">{d.minNights??'—'}</td>
          <td className="p-3"><details><summary className={`cursor-pointer ${d.eligible?'text-teal-700':'text-slate-500'}`}>{d.eligible?'Eligible':d.reasons.join('; ')}</summary>
            <ol className="mt-2 space-y-1 text-xs text-slate-500">{d.steps.map((s,i)=><li key={i}>{s.label}: {s.adjustmentPct?`${s.adjustmentPct.toFixed(1)}% → `:''}{money(s.resultCents)}</li>)}</ol></details></td></tr>)}</tbody></table></div>
    </section>
    <section className="rounded-2xl border bg-white p-5 sm:p-6"><h2 className="text-lg font-semibold">3. Review and publish direct rates</h2>
      <p className="my-3 text-sm text-slate-500">{eligible.length} eligible nights. Nights outside the change limit need policy review. A saved review expires after 5 minutes and is rejected if the calendar or policy changes.</p>
      <div className="flex flex-wrap gap-3"><Button disabled={busy||dirty||!profile} onClick={()=>perform(async()=>{
        const r=await services.review(propertyId);if(!r.ok)throw Error(r.error);setSnapshot(r.value.snapshot);setProfile(r.value.profile);setPolicy(r.value.profile.policy);setMode(r.value.profile.mode);
        setReview({id:r.value.id,createdAt:r.value.createdAt});setMessage('Review saved with a fresh calendar. Inspect the table before publishing.');
      })}>Prepare publishing review</Button>
      <Button variant="primary" disabled={busy||dirty||!review||!eligible.length||profile?.mode!=='helm_direct'} onClick={()=>perform(async()=>{
        if(!review||!await ask({title:`Publish ${eligible.length} nights for ${name}?`,body:'This changes direct-booking nightly rates and minimum stays. Booked nights and manual overrides stay protected. OTA rates are unaffected.',confirmLabel:'Publish direct rates'}))return;
        const r=await services.publish(review.id);if(!r.ok)throw Error(r.error);await refresh();setMessage(`Published ${r.value} nights to Helm direct rates.`);
      })}>Publish reviewed direct rates</Button></div>
      <p className="mt-4 text-sm text-slate-500">Channex / Airbnb / Vrbo: not connected to this engine yet. Scheduled recalculation is also not enabled. Keep PriceLabs syncing until a separately validated channel handoff is complete.</p>
      {runs.some(r=>r.status==='applied')&&<div className="mt-5 border-t pt-4"><h3 className="font-medium">Recent published batches</h3>{runs.filter(r=>r.status==='applied').map(r=><div key={r.id} className="mt-3 flex items-center justify-between gap-3 text-sm">
        <span>{r.applied_at?.replace('T',' ').slice(0,16)} UTC</span><Button disabled={busy} onClick={()=>perform(async()=>{
          if(!await ask({title:'Restore the rates before this batch?',body:'Undo is refused if a later edit changed any affected night.',confirmLabel:'Undo batch'}))return;
          const result=await services.undo(r.id);if(!result.ok)throw Error(result.error);await refresh();setMessage(`Restored ${result.value} nights.`);
        })}>Undo batch</Button></div>)}</div>}
    </section>
  </div>;
}
