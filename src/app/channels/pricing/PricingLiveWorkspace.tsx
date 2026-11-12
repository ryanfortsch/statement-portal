'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Button} from '@/components/Button';
import {useConfirm} from '@/components/ConfirmDialog';
import {hasUnsavedWork} from '@/lib/unsaved-work';
import {etStamp} from '@/lib/stable-time';
import {pricingLiveRow,type PricingLivePortfolio,type PricingLiveCalendar} from '@/lib/dynamic-pricing-live';
import {resolvePricingCustomizations,pricingSeasonConflicts,pricingDraftError,applyPricingDraftOverrides,revisePricingDraftGroups,emptyPricingDrafts,neutralPricingDraft,pricingDraftsSchema,PRICING_DRAFT_STORAGE,pricingGroupId,pricingGroupName,pricingInGroup,pricingInheritedOverrides,type PricingDrafts} from '@/lib/dynamic-pricing-drafts';
import {createPricingDraftServices} from '@/lib/dynamic-pricing-draft-services';
import PricingPortfolio from './PricingPortfolio';
import PricingCalendar from './PricingCalendar';
import PricingWorkbench from './PricingWorkbench';
import PricingDraftControls,{type PricingDraftControlsRef} from './PricingDraftControls';
import PricingIcon from './PricingIcon';
import PricingGroupManager from './PricingGroupManager';
import PricingCustomizationControls from './PricingCustomizationControls';
import PricingStayControls from './PricingStayControls';
import PricingBookingActivity from './PricingBookingActivity';
import PricingMultiCalendar from './PricingMultiCalendar';
import PricingSettingsImport from './PricingSettingsImport';
import {importedPricingBound} from '@/lib/dynamic-pricing-import-source';
import PricingSharedSettings from './PricingSharedSettings';
import {assertPricingBrowserUnchanged,replacePricingBrowserSettings,type PricingSharedServices} from '@/lib/dynamic-pricing-shared';
import type {PricingResearchSaveAction} from '@/lib/dynamic-pricing-research';
import './pricing.css';

type Result<T>={ok:true;value:T}|{ok:false;error:string};
type DraftServices=ReturnType<typeof createPricingDraftServices>;
export default function PricingLiveWorkspace({initialPortfolio,refreshAction,calendarAction,sharedServices,evidenceSave}:{
  evidenceSave?:PricingResearchSaveAction;
  sharedServices?:PricingSharedServices;initialPortfolio:PricingLivePortfolio;refreshAction:()=>Promise<Result<PricingLivePortfolio>>;calendarAction:(id:string)=>Promise<Result<PricingLiveCalendar>>;
}) {
  const [portfolio,setPortfolio]=useState(initialPortfolio),[selection,setSelection]=useState<{calendar:PricingLiveCalendar;services:DraftServices|null}|null>(null);
  const [drafts,setDrafts]=useState<PricingDrafts>(emptyPricingDrafts),[ready,setReady]=useState(false),[revision,setRevision]=useState(0),[filter,setFilter]=useState(''),[managing,setManaging]=useState(false),[importing,setImporting]=useState(false);
  const stored=useRef<PricingDrafts>(emptyPricingDrafts()),adapters=useRef(new Map<string,DraftServices>());
  const [busy,setBusy]=useState(false),[error,setError]=useState('');const {ask}=useConfirm();
  const [sharedTarget,setSharedTarget]=useState<HTMLElement|null>(null);
  const [portfolioView,setPortfolioView]=useState<'listings'|'calendar'>('listings');
  const readMultiCalendar=useCallback(async(id:string)=>{
    const result=await calendarAction(id);if(!result.ok)return result;
    const evidence=evidenceSave?undefined:adapters.current.get(id)?.inspect().snapshot.evidence;
    return {ok:true as const,value:evidence?{...result.value,snapshot:{...result.value.snapshot,evidence}}:result.value};
  },[calendarAction,evidenceSave]);
  useEffect(()=>{
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate browser-only draft settings after SSR before enabling interaction.
    try{const raw=localStorage.getItem(PRICING_DRAFT_STORAGE);if(raw){const parsed=pricingDraftsSchema.parse(JSON.parse(raw));stored.current=parsed;setDrafts(parsed);}}
    catch{setError('Saved drafts could not be loaded. They have not been replaced.');}
    setReady(true);
  },[]);
  function persist(next:PricingDrafts){assertPricingBrowserUnchanged(localStorage,stored.current);const parsed=pricingDraftsSchema.parse(revisePricingDraftGroups(stored.current,next));const conflicts=pricingSeasonConflicts(parsed);if(conflicts.length)throw Error(conflicts.map(c=>`${portfolio.rows.find(h=>h.id===c.id)?.name??"Listing"}: ${c.error}`).join(" · "));localStorage.setItem(PRICING_DRAFT_STORAGE,JSON.stringify(parsed));stored.current=parsed;setDrafts(parsed);return parsed;}
  function replaceShared(settings:PricingDrafts) {
    const parsed=replacePricingBrowserSettings(localStorage,stored.current,settings);
    stored.current=parsed;setDrafts(parsed);adapters.current.clear();setSelection(null);setRevision(v=>v+1);
  }
  function adapter(calendar:PricingLiveCalendar){const id=calendar.home.id;let service=adapters.current.get(id);if(!service){service=createPricingDraftServices(calendar,()=>stored.current,persist,calendarAction,evidenceSave?{save:evidenceSave,changed:updated=>setPortfolio(p=>({...p,rows:p.rows.map(row=>row.id===id?{...pricingLiveRow(updated.home,updated.snapshot,new Date(),updated.snapshot.today),activity:updated.activity,observedAt:updated.sourceObservedAt}:row)}))}:undefined);adapters.current.set(id,service);}return service;}
  async function leave(){return !hasUnsavedWork()||await ask({title:'Discard unsaved changes?',body:'Saved drafts remain on this device.',confirmLabel:'Discard'});}
  async function open(id:string) {
    if(!await leave())return;setBusy(true);setError('');
    try{const r=await calendarAction(id);if(!r.ok)throw Error(r.error);const services=stored.current.homes[id]?adapter(r.value):null;
      if(services){const refreshed=await services.refresh(id);if(!refreshed.ok)throw Error(refreshed.error);}
      setSelection({calendar:r.value,services});setRevision(v=>v+1);
    }catch{setError('Could not load this calendar. Try again.');}finally{setBusy(false);}
  }
  async function refresh() {
    if(!await leave())return;setBusy(true);setError('');
    try{const p=await refreshAction();if(!p.ok)throw Error(p.error);setPortfolio(p.value);
      if(selection){const c=await calendarAction(selection.calendar.home.id);if(!c.ok)throw Error(c.error);if(selection.services){const r=await selection.services.refresh(c.value.home.id);if(!r.ok)throw Error(r.error);}setSelection({...selection,calendar:c.value});setRevision(v=>v+1);}
    }catch{setError('Could not refresh all data. The previous snapshot remains visible.');}finally{setBusy(false);}
  }
  const calendar=selection?.calendar;
  const selectedPropertyId=calendar?.home.id;
  useEffect(()=>{if(selectedPropertyId)window.scrollTo({top:0});},[selectedPropertyId]);
  const navigation=calendar?<div className="pricing-listing-navigation"><Button variant="quiet" className="pricing-back-button" disabled={busy} aria-label="All listings" onClick={async()=>{if(await leave())setSelection(null);}}><PricingIcon name="previous"/></Button><label className="pricing-title-select"><span className="sr-only">Switch listing</span><select value={calendar.home.id} disabled={busy} onChange={e=>void open(e.target.value)}>{portfolio.rows.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label></div>:null;
  return <div className="helm-pricing pricing-live-workspace" aria-busy={busy}>
    {ready&&sharedServices&&<PricingSharedSettings target={sharedTarget} state={drafts} homes={portfolio.rows} services={sharedServices} replace={replaceShared}/>}
    {(portfolio.researchUnavailable||calendar?.researchStatus==='unavailable')&&<p role="status" className="pricing-feedback">Saved market data is unavailable. Refresh to try again.</p>}
    {error&&<p role="alert" className="pricing-feedback">{error}</p>}
    <div hidden={!!calendar} inert={busy||!ready}><div className="pricing-portfolio-tools"><div className="pricing-view-switch pricing-portfolio-views" role="group" aria-label="Portfolio view"><Button variant="quiet" aria-pressed={portfolioView==='listings'} onClick={()=>setPortfolioView('listings')}><PricingIcon name="table"/>Dashboard</Button><Button variant="quiet" aria-pressed={portfolioView==='calendar'} onClick={()=>setPortfolioView('calendar')}><PricingIcon name="calendar"/>Multi calendar</Button></div>{drafts.groups.length>0&&<label className="pricing-group-filter">Group<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">All listings</option>{drafts.groups.map(g=><option key={g.id} value={g.id}>{pricingGroupName(drafts,g.id)}</option>)}</select></label>}<Button variant="secondary" size="sm" onClick={()=>setManaging(true)}>Groups & rules</Button><Button variant="secondary" size="sm" onClick={()=>setImporting(true)}>Import PriceLabs</Button>{!calendar&&sharedServices&&<span className="pricing-shared-slot" ref={setSharedTarget}/>}<Button variant="quiet" className="pricing-icon-button" aria-label="Refresh portfolio" title={`Updated ${etStamp(portfolio.readAt)} · Refresh stored calendars`} disabled={busy||!ready} onClick={()=>void refresh()}><PricingIcon name="refresh"/></Button></div><div hidden={portfolioView!=='listings'}><PricingPortfolio rows={portfolio.rows.filter(r=>!filter||pricingInGroup(drafts,r.id,filter)).map(r=>{const h=drafts.homes[r.id];return h?{...r,configured:true,baseCents:h.policy.baseCents,floorCents:importedPricingBound(h.policy,h.importSource,"min"),ceilingCents:importedPricingBound(h.policy,h.importSource,"max")}:r;})} observed onOpen={id=>void open(id)}/></div><div hidden={portfolioView!=='calendar'}><PricingMultiCalendar homes={portfolio.rows} readAt={`${portfolio.readAt}/${revision}`} active={portfolioView==='calendar'&&!calendar&&ready} state={drafts} groupId={filter} readCalendar={readMultiCalendar} onOpen={id=>void open(id)} commit={persist}/></div></div>
    {importing&&<PricingSettingsImport state={drafts} homes={portfolio.rows} commit={next=>{const saved=persist(next);setRevision(v=>v+1);return saved;}} close={()=>setImporting(false)}/>}
    {managing&&<PricingGroupManager state={drafts} homes={portfolio.rows} today={portfolio.rows[0]?.windows[30]?.start??portfolio.readAt.slice(0,10)} commit={persist} close={()=>setManaging(false)}/>}
    {calendar&&selection&&<div inert={busy}>
      {selection.services?<DraftProperty key={`${calendar.home.id}-${revision}`} calendar={calendar} navigation={navigation} headerActions={<>{sharedServices&&<span className="pricing-shared-slot" ref={setSharedTarget}/>}<Button variant="quiet" className="pricing-icon-button" aria-label="Refresh calendar" title={`Updated ${etStamp(calendar.sourceObservedAt??portfolio.readAt)}`} disabled={busy||!ready} onClick={()=>void refresh()}><PricingIcon name="refresh"/></Button></>} services={selection.services} drafts={drafts} commit={persist} shared={!!sharedServices} sharedEvidence={!!evidenceSave}/>:<>
        <div className="pricing-workbench-header">{navigation}{sharedServices&&<span className="pricing-shared-slot" ref={setSharedTarget}/>}</div>
        <PricingDraftSetup calendar={calendar} inheritedFrom={pricingGroupId(drafts,calendar.home.id)?pricingGroupName(drafts,pricingGroupId(drafts,calendar.home.id)):drafts.account?'Account defaults':null} onCreate={(policy)=>{persist({...stored.current,homes:{...stored.current.homes,[calendar.home.id]:{policy,version:1,groupId:pricingGroupId(stored.current,calendar.home.id),inheritRules:true,ruleCategories:[],overrides:[]}}});setSelection({calendar,services:adapter(calendar)});}}/>
        <PricingCalendar snapshot={calendar.snapshot} preview={null} currentOnly/>
        <PricingBookingActivity activity={calendar.activity}/>
      </>}
      {!selection.services&&<p className="pricing-live-source">{calendar.source} · {calendar.sourceObservedAt?`Updated ${etStamp(calendar.sourceObservedAt)}`:'Update time unavailable'}</p>}
    </div>}
  </div>;
}
function DraftProperty({calendar,navigation,services,drafts,commit,headerActions,shared,sharedEvidence}:{sharedEvidence:boolean;shared:boolean;headerActions:React.ReactNode;calendar:PricingLiveCalendar;navigation:React.ReactNode;services:DraftServices;drafts:PricingDrafts;commit:(s:PricingDrafts)=>void}) {
  const [revision,setRevision]=useState(0),controls=useRef<PricingDraftControlsRef>(null),workspace=services.inspect(),home=drafts.homes[calendar.home.id],custom=resolvePricingCustomizations(drafts,{kind:"listing",id:calendar.home.id}).rules;
  return <><PricingWorkbench key={revision} propertyId={calendar.home.id} name={calendar.home.name} authority={calendar.home.authority} navigation={navigation} services={services} draftOnly sharedEvidence={sharedEvidence} importSource={home.importSource} headerActions={headerActions}
    dataSource={<p className="pricing-draft-note">{calendar.source} · {calendar.sourceObservedAt?etStamp(calendar.sourceObservedAt):"Update time unavailable"}. {shared?'Save to Helm shares settings across devices.':'Settings stay in this browser.'} {sharedEvidence?'Imported research is saved in Helm. Comparison history lasts for this session.':'Market evidence and history snapshots last for this session.'}</p>}
    listingActivity={<PricingBookingActivity activity={calendar.activity}/>}
    draftCustomizations={custom} extraRuleActions={closeRules=><PricingCustomizationControls state={drafts} propertyId={calendar.home.id} today={calendar.snapshot.today} closeRules={closeRules} commit={next=>{commit(next);setRevision(v=>v+1);}}/>}
    initialPolicy={workspace.policy} initialSnapshot={workspace.snapshot} initialProfile={workspace.profile} initialRuns={[]} initialEvidenceVersion={workspace.evidenceVersion} initialObservations={workspace.observations}
    previewTransform={(p,policy,snapshot)=>applyPricingDraftOverrides(p,policy,snapshot,home.overrides,pricingInheritedOverrides(drafts,calendar.home.id),custom)}
    additionalTools={(snapshot,preview,policy,closeMenu)=><PricingStayControls closeMenu={closeMenu} state={drafts} propertyId={calendar.home.id} snapshot={snapshot} preview={preview} policy={policy} commit={next=>{commit(next);setRevision(v=>v+1);}}/>}
    onOverride={date=>controls.current?.open(date)} calendarTools={<PricingDraftControls ref={controls} state={drafts} propertyId={calendar.home.id} today={calendar.snapshot.today} commit={next=>{commit(next);setRevision(v=>v+1);}}/>}/></>;
}
function PricingDraftSetup({calendar,onCreate,inheritedFrom}:{calendar:PricingLiveCalendar;inheritedFrom:string|null;onCreate:(policy:ReturnType<typeof neutralPricingDraft>)=>void}) {
  const [base,setBase]=useState(''),[min,setMin]=useState(''),[max,setMax]=useState(''),[error,setError]=useState('');
  const rates=calendar.snapshot.days.filter(d=>d.state==='open'&&!d.protected&&d.currentCents!==null).map(d=>d.currentCents!).sort((a,b)=>a-b);
  return <section className="pricing-draft-setup" aria-label="Create pricing draft"><div><h3>Configure prices</h3><p>Set a base, minimum and maximum to preview Helm rules. No prices will sync.</p></div><div className="pricing-setup-fields">
    <label className="pricing-field">Base ($)<input type="number" step="0.01" value={base} onChange={e=>setBase(e.target.value)}/></label><label className="pricing-field">Min ($)<input type="number" step="0.01" value={min} onChange={e=>setMin(e.target.value)}/></label><label className="pricing-field">Max ($)<input type="number" step="0.01" value={max} onChange={e=>setMax(e.target.value)}/></label>
    <Button variant="primary" disabled={!base||!min||!max} onClick={()=>{try{onCreate(neutralPricingDraft(Math.round(Number(base)*100),Math.round(Number(min)*100),Math.round(Number(max)*100)));}catch(e){setError(pricingDraftError(e));}}}>Create draft</Button>
  </div><div className="pricing-setup-foot"><Button variant="quiet" disabled={!rates.length} onClick={()=>{setBase(String(rates[Math.floor(rates.length/2)]/100));setMin(String(rates[0]/100));setMax(String(rates.at(-1)!/100));}}>Use current rate range</Button><span>Median / lowest / highest available rate. {inheritedFrom?`Rules inherit from ${inheritedFrom}.`:'Discounts off; minimum stay starts at 2 nights.'}</span></div>
    {error&&<p role="alert" className="pricing-feedback">{error}</p>}</section>;
}
