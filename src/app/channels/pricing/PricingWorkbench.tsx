'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import { useUnsavedWorkGuard } from '@/lib/unsaved-work';
import { previewPricing, pricingPolicySchema, type PricingPolicy, type PricingSnapshot, type PricingPreview } from '@/lib/dynamic-pricing';
import type { PricingProfile, PricingRunSummary } from '@/lib/dynamic-pricing-store';
import PricingInsights from './PricingInsights';
import PricingHistory from './PricingHistory';
import PricingCalendar from './PricingCalendar';
import PricingIcon from './PricingIcon';
import PricingOccupancy from './PricingOccupancy';
import type {PricingCustomizations} from '@/lib/dynamic-pricing-customizations';
import PricingPolicyFields,{NumberField} from './PricingPolicyFields';
import PricingImportedSettings from './PricingImportedSettings';
import {importedPricingBound,IMPORT_PRICE_MIN,IMPORT_PRICE_MAX,type PricingImportSource} from '@/lib/dynamic-pricing-import-source';
import './pricing.css';
import {etStamp} from '@/lib/stable-time';
import {pricingOccupancyWindow} from '@/lib/dynamic-pricing-portfolio';
import type {PricingObservationRecord,PricingTracking} from '@/lib/dynamic-pricing-observations';
import type { capturePricingObservationAction,setPricingTrackingAction,savePricingEvidenceAction, publishPricingAction, refreshPricingAction, reviewPricingAction, savePricingAction, undoPricingAction } from './actions';

export type PricingServices={save:typeof savePricingAction;refresh:typeof refreshPricingAction;review:typeof reviewPricingAction;publish:typeof publishPricingAction;undo:typeof undoPricingAction;evidence:typeof savePricingEvidenceAction;observe:typeof capturePricingObservationAction;tracking:typeof setPricingTrackingAction};
const inputClass='mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
export default function PricingWorkbench({propertyId,name,authority,navigation,initialPolicy,initialSnapshot,initialProfile,initialRuns,initialEvidenceVersion=0,initialObservations=[],initialTracking={enabled:false,version:0},scheduledCaptureEnabled=false,services,draftOnly=false,calendarTools,previewTransform,onOverride,additionalTools,draftCustomizations,extraRuleActions,listingActivity,importSource,headerActions,dataSource}:{
  propertyId:string;name:string;authority:'helm'|'guesty';navigation?:ReactNode;initialPolicy:PricingPolicy;initialSnapshot:PricingSnapshot;
  initialProfile:PricingProfile|null;initialRuns:PricingRunSummary[];initialEvidenceVersion?:number;services:PricingServices;draftOnly?:boolean;calendarTools?:ReactNode;previewTransform?:(preview:PricingPreview,policy:PricingPolicy,snapshot:PricingSnapshot)=>PricingPreview;onOverride?:(date:string)=>void;additionalTools?:(snapshot:PricingSnapshot,preview:PricingPreview|null,policy:PricingPolicy,closeMenu:()=>void)=>ReactNode;
  headerActions?:ReactNode;dataSource?:ReactNode;importSource?:PricingImportSource;draftCustomizations?:PricingCustomizations;extraRuleActions?:(closeRules:()=>void)=>ReactNode;listingActivity?:ReactNode;
  initialObservations?:PricingObservationRecord[];initialTracking?:PricingTracking;scheduledCaptureEnabled?:boolean;
}) {
  const [policy,setPolicy]=useState(initialPolicy),[snapshot,setSnapshot]=useState(initialSnapshot),[profile,setProfile]=useState(initialProfile);
  const [runs,setRuns]=useState(initialRuns),[mode,setMode]=useState<'shadow'|'helm_direct'>(initialProfile?.mode??'shadow');
  const [review,setReview]=useState<{id:string;createdAt:string}|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const [evidenceVersion,setEvidenceVersion]=useState(initialEvidenceVersion);
  const [observations,setObservations]=useState(initialObservations),[tracking,setTracking]=useState(initialTracking),[collectorEnabled,setCollectorEnabled]=useState(scheduledCaptureEnabled);
  const captureRequest=useRef<string|null>(null);
  const [currentOnly,setCurrentOnly]=useState(draftOnly);
  const [section,setSection]=useState<'prices'|'market'|'occupancy'|'history'|'data'>('prices');const {ask}=useConfirm();
  const [ruleSection,setRuleSection]=useState<'strategy'|'adjustments'|'stays'|'events'|'connection'|'source'>('strategy');
  const customizations=useRef<HTMLDialogElement>(null),[menuOpen,setMenuOpen]=useState(false),[rulesOpen,setRulesOpen]=useState(false);
  useEffect(()=>{if(rulesOpen)customizations.current?.showModal();else customizations.current?.close();},[rulesOpen]);
  const openCustomizations=(next:typeof ruleSection='strategy')=>{setRuleSection(next);setRulesOpen(true);};
  function showSection(next:typeof section){setSection(next);setMenuOpen(false);}
  const listingMetrics=useMemo(()=>[30,60,90].map(n=>pricingOccupancyWindow(snapshot,snapshot.today,n as 30|60|90,new Date(snapshot.observedAt))),[snapshot]);
  const changed=JSON.stringify(policy)!==JSON.stringify(profile?.policy??initialPolicy)||mode!==(profile?.mode??'shadow');
  const dirty=!profile||changed;
  useUnsavedWorkGuard(changed);
  const computed=useMemo(()=>{const parsed=pricingPolicySchema.safeParse(policy);
    return parsed.success?{preview:previewPricing(parsed.data,snapshot,new Date(snapshot.observedAt),draftOnly?draftCustomizations:undefined),errors:[]}:
      {preview:null,errors:parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`)};
  },[policy,snapshot,draftOnly,draftCustomizations]);
  const preview=computed.preview?(previewTransform?.(computed.preview,policy,snapshot)??computed.preview):null,eligible=preview?.days.filter(d=>d.eligible)??[];
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
  return <div className="helm-pricing pricing-workbench-v2">
    <header className="pricing-workbench-header">
      <div className="pricing-title-block" title={`${authority==='helm'?'Helm':'Guesty'} · Updated ${etStamp(snapshot.observedAt)}`}>{navigation}<h2 className={navigation?'sr-only':'pricing-property-title'}>{name}</h2></div>
      <div className="pricing-header-actions">{draftOnly?<span className="pricing-connection" title="Draft settings are saved in this browser. No live rates sync.">Not syncing</span>:<Button variant="quiet" className="pricing-connection" data-connected={profile?.mode==='helm_direct'||undefined} onClick={()=>openCustomizations('connection')}>{profile?.mode==='helm_direct'?'Helm direct':'Compare only'}</Button>}
        {headerActions}{changed&&!busy&&<span className="pricing-unsaved">Unsaved</span>}{busy&&<span role="status">Updating…</span>}
      </div>
    </header>
    <div className="pricing-navigation"><div role="group" aria-label="Pricing views" className="pricing-tabs">{([
      ['prices','Calendar'],['market','Market'],['occupancy','Performance'],
    ] as const).map(([id,label])=><Button key={id} variant="quiet" className="pricing-tab" aria-pressed={section===id} onClick={()=>setSection(id)}>{label}</Button>)}</div>
      <details open={menuOpen} onToggle={e=>setMenuOpen(e.currentTarget.open)} className="pricing-menu pricing-more"><summary className="pricing-columns-toggle" aria-label="More pricing tools" title="More pricing tools"><PricingIcon name="more"/></summary><div className="pricing-menu-panel">
        {additionalTools?.(snapshot,preview,policy,()=>{setMenuOpen(false);})}<Button variant="quiet" onClick={()=>showSection('history')}>History</Button><Button variant="quiet" onClick={()=>showSection('data')}>Data & model</Button>
        <Button variant="quiet" disabled={busy} onClick={()=>void perform(async()=>{if(changed&&!await ask({title:'Discard unsaved rules?',body:'Reload the saved rules and current calendar.',confirmLabel:'Discard and refresh'}))return;await refresh();setMenuOpen(false);})}>Reload saved prices</Button>
      </div></details>
    </div>
    {error&&<p role="alert" className="pricing-feedback">{error}</p>}
    {message&&<p role="status" className="pricing-feedback text-slate-600">{message}</p>}

    {computed.errors.length>0&&<div role="alert" className="text-sm text-red-700"><p>{computed.errors.join(' · ')}</p><Button variant="quiet" size="sm" onClick={()=>openCustomizations()}>Fix rules</Button></div>}
    <div hidden={section!=='prices'} className="pricing-property-layout">
      <aside className="pricing-sidebar" aria-label="Configure prices">
        <fieldset disabled={busy} className="pricing-configure">
          <div className="pricing-base-fields">
            <div className="pricing-base-primary"><NumberField currency label="Base price" value={policy.baseCents/100} step={0.01} onChange={n=>modify('baseCents',Math.round(n*100))}/></div>
            <NumberField currency label="Min" placeholder={importSource?.minCents===null?"Not set":undefined} value={(importedPricingBound(policy,importSource,"min")??NaN)/100} step={0.01} onChange={n=>modify('floorCents',Number.isNaN(n)&&importSource?.minCents===null?IMPORT_PRICE_MIN:Math.round(n*100))}/>
            <NumberField currency label="Max" placeholder={importSource?.maxCents===null?"Not set":undefined} value={(importedPricingBound(policy,importSource,"max")??NaN)/100} step={0.01} onChange={n=>modify('ceilingCents',Number.isNaN(n)&&importSource?.maxCents===null?IMPORT_PRICE_MAX:Math.round(n*100))}/>
          </div>
          <div className="pricing-configure-actions"><Button variant={!dirty?'secondary':'primary'} title="Save rules and refresh the preview. Does not publish rates." disabled={busy||!preview||!dirty} onClick={()=>void saveRules()}>{!dirty?'Saved':draftOnly?'Save draft':'Save'}</Button><Button variant="secondary" onClick={()=>openCustomizations()}><PricingIcon name="sliders"/>Rules</Button></div>
        </fieldset>
        <button type="button" className="pricing-minimum-summary" aria-label="Edit minimum stays" onClick={()=>openCustomizations('stays')}>
          <span>Minimum stay</span><strong>{policy.weekdayMinNights===policy.weekendMinNights?`${policy.weekdayMinNights} nights`:`${policy.weekdayMinNights} weekday · ${policy.weekendMinNights} weekend`}</strong><PricingIcon name="next"/>
        </button>
        <div className="pricing-listing-metrics" aria-label="Listing occupancy"><div className="pricing-metrics-heading"><h3>Adjusted occupancy</h3></div>{listingMetrics.map(w=><div className="pricing-listing-metric" key={w.nights}><span>Next {w.nights} days</span><PricingOccupancy window={w} compact/></div>)}</div>
      </aside>
      <div className="pricing-calendar-workspace">{draftOnly&&<div className="pricing-draft-toolbar"><div className="pricing-view-switch" role="group" aria-label="Rates shown"><Button variant="quiet" aria-pressed={currentOnly} onClick={()=>setCurrentOnly(true)}>Current rates</Button><Button variant="quiet" aria-pressed={!currentOnly} onClick={()=>setCurrentOnly(false)}>Helm draft</Button></div>{calendarTools}</div>}<PricingCalendar key={review?.id??'draft'} snapshot={snapshot} preview={currentOnly?null:preview} currentOnly={currentOnly} onOverride={onOverride}/></div>
    </div>
    {section==='occupancy'&&listingActivity}{section==='data'&&dataSource}
    <PricingInsights draftOnly={draftOnly} onOpenData={()=>setSection('data')} view={section==='occupancy'?'occupancy':section==='data'?'data':section==='market'?'market':'hidden'} propertyId={propertyId} snapshot={snapshot} preview={preview} policy={policy} busy={busy}
      onUseLearned={base=>{setPolicy(p=>({...p,baseCents:Math.max(p.floorCents,Math.min(p.ceilingCents,base)),priceShape:'history'}));setReview(null);setSection('prices');openCustomizations();}}
      onSave={async data=>perform(async()=>{const r=await services.evidence({propertyId,data,version:evidenceVersion});if(!r.ok)throw Error(r.error);
        setSnapshot(r.value.snapshot);setEvidenceVersion(r.value.evidenceVersion);setReview(null);setMessage(draftOnly?'Imported data is available for this session.':'Data updated. Prepare a new review before publishing.');})}/>
    <div className="pricing-panel" hidden={section!=='history'}><PricingHistory sessionOnly={draftOnly} observations={observations} tracking={tracking} scheduledCaptureEnabled={collectorEnabled} busy={busy} canCapture={!dirty}
      onCapture={()=>void perform(async()=>{const requestId=captureRequest.current??crypto.randomUUID();captureRequest.current=requestId;
        const r=await services.observe({propertyId,requestId});if(!r.ok)throw Error(r.error);
        await refresh();captureRequest.current=null;setMessage(draftOnly?'Snapshot saved for this session.':'Snapshot saved.');})}
      onTracking={enabled=>void perform(async()=>{const r=await services.tracking({propertyId,enabled,version:tracking.version});if(!r.ok)throw Error(r.error);
        setTracking(r.value.tracking);setObservations(r.value.observations);setCollectorEnabled(r.value.scheduledCaptureEnabled);setMessage(enabled?'Daily history requested.':'Daily history stopped.');})}/></div>
    <dialog ref={customizations} className="pricing-customizations-dialog" aria-labelledby="pricing-customizations-title" onCancel={()=>setRulesOpen(false)} onClick={e=>{if(e.target===e.currentTarget)setRulesOpen(false);}}>
      <header><h2 id="pricing-customizations-title">Pricing rules</h2><Button variant="quiet" className="pricing-icon-button" aria-label="Close customizations" onClick={()=>setRulesOpen(false)}><PricingIcon name="close"/></Button></header>
      <div className="pricing-rules-layout"><nav className="pricing-rule-nav" aria-label="Rule categories">{([['strategy','Strategy'],['adjustments','Adjustments'],['stays','Minimum stays'],['events','Events'],['connection','Connection']] as const).filter(([id])=>!draftOnly||id!=='connection').map(([id,label])=><Button key={id} variant="quiet" aria-pressed={ruleSection===id} onClick={()=>setRuleSection(id)}>{label}<PricingIcon name="next"/></Button>)}{draftOnly&&extraRuleActions?.(()=>setRulesOpen(false))}{importSource&&<Button variant="quiet" aria-pressed={ruleSection==='source'} onClick={()=>setRuleSection('source')}>PriceLabs import<PricingIcon name="next"/></Button>}</nav>
      <fieldset disabled={busy} className="pricing-rules-content">
      {ruleSection==='stays'&&importSource&&<p className="pricing-profile-context">{importSource.minimumStayProfile&&<b>{importSource.minimumStayProfile} · </b>}Weekend: {(draftCustomizations?.weekendDays??[5,6]).map(n=>['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][n]).join(', ')}</p>}
      {ruleSection==='source'&&importSource&&<PricingImportedSettings source={importSource} policy={policy} weekendDays={draftCustomizations?.weekendDays??[5,6]} onMinimumStay={()=>openCustomizations('stays')}/>}
      <PricingPolicyFields policy={policy} modify={modify} ruleSection={ruleSection} today={snapshot.today}/>
      <section hidden={ruleSection!=='connection'}><h3>Connection</h3><label className="text-sm font-medium">Pricing connection<select className={inputClass} value={mode} onChange={e=>{setMode(e.target.value as typeof mode);setReview(null);}}>
        <option value="shadow">Compare only</option><option value="helm_direct" disabled={authority!=='helm'}>Connect Helm direct rates</option></select></label>
        <p className="my-3 text-sm text-slate-500">{authority==='guesty'?'Guesty controls this calendar. Direct publishing is unavailable until cutover.':
          'Direct publishing requires a review and confirmation. Disconnecting leaves published rates in place; use Undo to restore them.'}</p>
      </section>
      </fieldset></div>
      {computed.errors.length>0&&<p role="alert" className="pricing-feedback">{computed.errors.join(' · ')}</p>}
      {error&&<p role="alert" className="pricing-feedback">{error}</p>}
      <footer><Button variant="quiet" onClick={()=>setRulesOpen(false)}>Close</Button><Button variant="primary" disabled={busy||!preview} onClick={async()=>{if(await saveRules())setRulesOpen(false);}}>{draftOnly?'Save draft':'Save rules'}</Button></footer>
    </dialog>
    {!draftOnly&&section==='prices'&&profile?.mode==='helm_direct'&&<footer className="pricing-publish-bar" aria-label="Publish rates">
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
