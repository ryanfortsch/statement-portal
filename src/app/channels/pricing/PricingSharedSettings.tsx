'use client';
import {createPortal} from 'react-dom';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Button} from '@/components/Button';
import {hasUnsavedWork} from '@/lib/unsaved-work';
import {etStamp} from '@/lib/stable-time';
import type {PricingDrafts} from '@/lib/dynamic-pricing-drafts';
import {PRICING_SHARED_BASE_STORAGE,PRICING_DRAFT_BACKUP_STORAGE,pricingRecoverySchema,pricingSettingChanges,type PricingRecovery,pricingSharedRecordSchema,pricingSharedChoice,samePricingSettings,pricingSettingsDiff,type PricingSharedRecord,type PricingSharedServices,type PricingSharedSave} from '@/lib/dynamic-pricing-shared';
import {importedPricingBound} from '@/lib/dynamic-pricing-import-source';
import PricingIcon from './PricingIcon';

/** Explicit shared checkpoint. Local edits survive failed or conflicting saves. */
export default function PricingSharedSettings({state,homes,services,replace,target}:{
  target?:HTMLElement|null;state:PricingDrafts;homes:{id:string;name:string}[];services:PricingSharedServices;replace:(settings:PricingDrafts)=>void;
}) {
  const [remote,setRemote]=useState<PricingSharedRecord|null>(null),[busy,setBusy]=useState(true),[conflict,setConflict]=useState(false),[error,setError]=useState(''),[open,setOpen]=useState(false),[operation,setOperation]=useState('Loading…'),[backups,setBackups]=useState<PricingRecovery>([]),[backup,setBackup]=useState(''),[retry,setRetry]=useState(false);
  const latest=useRef(state),dialog=useRef<HTMLDialogElement>(null),pending=useRef<PricingSharedSave|null>(null),alive=useRef(true),sequence=useRef(0),saving=useRef(false);
  useLayoutEffect(()=>{latest.current=state;},[state]);
  useEffect(()=>{if(open)dialog.current?.showModal();else dialog.current?.close();},[open]);
  useEffect(()=>{
    alive.current=true;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- This is a request generation counter, not a DOM ref.
    return ()=>{alive.current=false;sequence.current++;};
    // Load once after browser hydration. Prop changes must not discard local edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const dirty=!!remote&&!samePricingSettings(state,remote.settings);
  function showReview() {
    try {const raw=localStorage.getItem(PRICING_DRAFT_BACKUP_STORAGE);setBackups(raw?pricingRecoverySchema.parse(JSON.parse(raw)):[]);}
    catch {setError('Browser recovery copies could not be read.');}
    setBackup('');setOpen(true);
  }
  function remember(value:PricingSharedRecord) {
    try {localStorage.setItem(PRICING_SHARED_BASE_STORAGE,JSON.stringify(value));}
    catch {setError('Saved in Helm. This browser could not update its recovery marker.');}
  }
  async function reload(reviewOnly=false) {
    const before=latest.current,turn=++sequence.current;
    setBusy(true);setOperation('Loading…');setError('');
    try {
      const result=await services.read();if(!alive.current||turn!==sequence.current)return;
      if(!result.ok){setError(result.error);return;}
      const value=pricingSharedRecordSchema.parse(result.value);setRemote(value);
      let base:PricingSharedRecord|null=null;
      try {const raw=localStorage.getItem(PRICING_SHARED_BASE_STORAGE);if(raw)base=pricingSharedRecordSchema.parse(JSON.parse(raw));}catch {/* No valid base means divergent copies require review. */}
      const choice=pricingSharedChoice(latest.current,value,base);
      if(choice==='same'){remember(value);setConflict(false);pending.current=null;setRetry(false);}
      else if(!reviewOnly&&choice==='load'&&!hasUnsavedWork()&&samePricingSettings(before,latest.current)) {
        replace(value.settings);remember(value);setConflict(false);pending.current=null;setRetry(false);
      } else if(choice==='local'&&!reviewOnly) {setConflict(false);}
      else {setConflict(true);}
    } catch {if(alive.current&&turn===sequence.current)setError('Could not load shared settings. Your browser copy is unchanged.');}
    finally {if(alive.current&&turn===sequence.current)setBusy(false);}
  }
  async function save(reviewed=false) {
    if(!remote||busy||saving.current)return;
    if(hasUnsavedWork()){setError('Save the open property changes first.');setOpen(true);return;}
    if(conflict&&!reviewed){showReview();return;}
    const request=pending.current??{settings:state,expectedRevision:remote.revision,requestId:crypto.randomUUID()};
    const turn=++sequence.current;
    saving.current=true;pending.current=request;setBusy(true);setOperation('Saving…');setError('');
    try {
      const result=await services.save(request);if(!alive.current||turn!==sequence.current)return;
      if(!result.ok){
        showReview();setRetry(result.retryable!==false);if(result.retryable===false)pending.current=null;setError(result.error);
        if(result.conflict){pending.current=null;setRetry(false);setConflict(true);await reload(true);if(!alive.current)return;setError('Another save arrived. Review both copies before replacing Helm settings.');}
        return;
      }
      const saved=pricingSharedRecordSchema.parse(result.value);
      setRemote(saved);remember(saved);pending.current=null;setRetry(false);setConflict(false);setOpen(false);
    } catch {if(alive.current&&turn===sequence.current){showReview();setRetry(true);setError('Save not confirmed. Retry safely with the same request. Your browser copy is unchanged.');setOpen(true);}}
    finally {saving.current=false;if(alive.current&&turn===sequence.current)setBusy(false);}
  }
  function useShared() {
    if(!remote||busy)return;
    if(hasUnsavedWork()){setError('Save or discard the open property changes first.');return;}
    try {setError('');replace(remote.settings);remember(remote);pending.current=null;setRetry(false);setConflict(false);setOpen(false);}
    catch {setError('Could not back up the browser copy. No settings were replaced.');}
  }
  function restoreBackup() {
    if(busy||backup==='')return;
    if(hasUnsavedWork()){setError('Save or discard the open property changes first.');return;}
    try {replace(backups[Number(backup)].settings);pending.current=null;setRetry(false);setConflict(true);setError('Recovery copy loaded into this browser. Review before saving to Helm.');setBackup('');}
    catch {setError('The recovery copy could not be loaded. No settings were replaced.');}
  }
  const diff=remote?pricingSettingsDiff(state,remote.settings):null;
  const price=(settings:PricingDrafts,id:string)=>{
    const home=settings.homes[id];if(!home)return 'No draft';
    const money=(v:number|null)=>v===null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:2}).format(v/100);
    return `${money(home.policy.baseCents)} / ${money(importedPricingBound(home.policy,home.importSource,'min'))} / ${money(importedPricingBound(home.policy,home.importSource,'max'))}`;
  };
  const content=<div className="pricing-shared-settings">
    <Button variant={dirty&&!conflict?'primary':'secondary'} size="sm" disabled={busy} title={remote?.updated_at?`Helm settings saved ${etStamp(remote.updated_at)}`:'Shared pricing settings'}
      onClick={()=>{if(dirty&&!conflict&&!error)void save();else showReview();}}>{busy?operation:error?'Settings need attention':conflict?'Review settings':dirty?'Save to Helm':remote?.revision===0?'Shared settings':'Saved to Helm'}</Button>
    <dialog ref={dialog} className="pricing-draft-dialog pricing-shared-dialog" aria-label="Shared pricing settings" onCancel={()=>setOpen(false)}>
      <header><h2>Shared settings</h2><Button variant="quiet" aria-label="Close shared settings" onClick={()=>setOpen(false)}><PricingIcon name="close"/></Button></header>
      <div className="pricing-shared-body">
        {remote&&<p>{remote.updated_at?`Saved ${etStamp(remote.updated_at)} · revision ${remote.revision}`:'No shared settings saved yet.'}</p>}
        {diff&&(diff.homes.length>0||diff.groups.length>0||diff.account)&&<>
          <p>{diff.homes.length} listing drafts · {diff.groups.length} groups{diff.account?' · account defaults':''} differ.</p>
          <div className="pricing-import-table"><table><thead><tr><th>Listing</th><th>This browser<br/>Base / Min / Max</th><th>Helm<br/>Base / Min / Max</th></tr></thead><tbody>{diff.homes.map(id=><tr key={id}><th>{homes.find(h=>h.id===id)?.name??id}</th><td>{price(state,id)}</td><td>{price(remote!.settings,id)}</td></tr>)}</tbody></table></div>
          <details><summary>Review all changes</summary>{[
            ...diff.homes.map(id=>({name:homes.find(h=>h.id===id)?.name??id,browser:{...state.homes[id],assignment:state.assignments?.[id]},helm:{...remote!.settings.homes[id],assignment:remote!.settings.assignments?.[id]}})),
            ...diff.groups.map(id=>({name:`Group · ${state.groups.find(g=>g.id===id)?.name??remote!.settings.groups.find(g=>g.id===id)?.name??id}`,browser:state.groups.find(g=>g.id===id),helm:remote!.settings.groups.find(g=>g.id===id)})),
            ...(diff.account?[{name:'Account defaults',browser:state.account,helm:remote!.settings.account}]:[]),
          ].map(section=><section key={section.name}><h3>{section.name}</h3><div className="pricing-import-table"><table><thead><tr><th>Setting</th><th>This browser</th><th>Helm</th></tr></thead><tbody>{pricingSettingChanges(section.browser,section.helm).map(row=><tr key={row.field}><th>{row.field}</th><td>{row.browser}</td><td>{row.helm}</td></tr>)}</tbody></table></div></section>)}</details>
        </>}
        <p>Saving shares pricing settings with Helm owners. Rates remain unchanged. Loading Helm settings keeps a recovery copy in this browser.</p>
        {backups.length>0&&<details><summary>Recovery copies</summary><div className="pricing-recovery"><label>Browser copy<select value={backup} onChange={e=>setBackup(e.target.value)}><option value="">Choose a copy</option>{backups.map((b,i)=><option key={`${b.at}-${i}`} value={i}>{etStamp(b.at)} · {Object.keys(b.settings.homes).length} listings</option>)}</select></label><Button variant="secondary" size="sm" disabled={busy||backup===''} onClick={restoreBackup}>Load copy</Button></div></details>}
        {retry&&<p>The previous save needs confirmation. Retry it first; newer browser edits will stay local.</p>}
        {error&&<p role="alert" className="pricing-feedback">{error}</p>}
      </div>
      <footer><Button variant="quiet" disabled={busy} onClick={()=>void reload(true)}>Refresh</Button>{remote&&dirty&&<><Button variant="secondary" disabled={busy} onClick={useShared}>Use Helm settings</Button><Button variant="primary" disabled={busy} onClick={()=>void save(true)}>{conflict?'Replace Helm settings':retry?'Retry save':'Save to Helm'}</Button></>}{remote&&!dirty&&<Button onClick={()=>setOpen(false)}>Done</Button>}</footer>
    </dialog>
  </div>;
  return target===undefined?content:target?createPortal(content,target):null;
}
