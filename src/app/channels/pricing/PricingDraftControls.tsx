'use client';
import {useImperativeHandle,useRef,useState,type Ref} from 'react';
import {Button} from '@/components/Button';
import {useConfirm,type AskOptions} from '@/components/ConfirmDialog';
import {hasUnsavedWork,useUnsavedWorkGuard} from '@/lib/unsaved-work';
import {pricingMoney} from '@/lib/dynamic-pricing-display';
import {pricingDraftError,pricingOverridesSchema,pricingOverrideSchema,resolvePricingDraft,type PricingDrafts,type PricingOverride} from '@/lib/dynamic-pricing-drafts';
import PricingIcon from './PricingIcon';
export type PricingDraftControlsRef={open:(date:string)=>void};
const blank=(date:string):PricingOverride=>({id:crypto.randomUUID(),label:'Date override',start:date,end:date,kind:'fixed',value:0,minNights:null,weekdays:[0,1,2,3,4,5,6]});
export default function PricingDraftControls({ref,state,propertyId,today,commit}:{ref?:Ref<PricingDraftControlsRef>;state:PricingDrafts;propertyId:string;today:string;commit:(s:PricingDrafts)=>void}) {
  const home=state.homes[propertyId],group=state.groups.find(g=>g.id===home.groupId),{ask}=useConfirm();
  const dates=useRef<HTMLDialogElement>(null),groups=useRef<HTMLDialogElement>(null);
  const [error,setError]=useState(''),[name,setName]=useState(''),[form,setForm]=useState<PricingOverride|null>(null),[scope,setScope]=useState<'listing'|'group'>('listing');
  useUnsavedWorkGuard(form!==null);
  async function open(date:string){if(!await ready())return;setError('');setScope('listing');setForm(blank(date));dates.current?.showModal();}
  useImperativeHandle(ref,()=>({open}));
  function change(next:PricingDrafts){try{commit(next);setError('');return true;}catch(e){setError(pricingDraftError(e));return false;}}
  async function ready(){return !hasUnsavedWork()||await ask({title:'Save your pricing rules first',body:'Close this message and save the rules before changing groups or date overrides.',confirmLabel:'Return to rules',cancelLabel:'Close'}).then(()=>false);}
  const rows=scope==='group'?(group?.overrides??[]):home.overrides;
  function replaceRows(next:PricingOverride[]){return change(scope==='group'?{...state,groups:state.groups.map(g=>g.id===group?.id?{...g,overrides:next}:g)}:{...state,homes:{...state.homes,[propertyId]:{...home,overrides:next,version:home.version+1}}});}
  function saveOverride(){try{const row=pricingOverrideSchema.parse(form),next=pricingOverridesSchema.parse([...rows.filter(r=>r.id!==row.id),row]);if(replaceRows(next))setForm(null);}catch(e){setError(pricingDraftError(e));}}
  async function confirmIn(dialog:typeof dates,options:AskOptions){dialog.current?.close();const yes=await ask(options);dialog.current?.showModal();return yes;}
  async function closeDates(){if(form&&!await confirmIn(dates,{title:'Discard this override?',body:'This date override has not been saved.',confirmLabel:'Discard'}))return;setForm(null);dates.current?.close();}
  const total=home.overrides.length+(group?.overrides.length??0);
  return <div className="pricing-draft-tools">
    <Button variant="secondary" size="sm" onClick={async()=>{if(!await ready())return;setError('');setForm(null);setScope('listing');dates.current?.showModal();}}>Date overrides{total?` (${total})`:''}</Button>
    <Button variant="secondary" size="sm" onClick={async()=>{if(!await ready())return;setError('');groups.current?.showModal();}}>{group?group.name:'Groups'}</Button>
    <dialog ref={dates} className="pricing-draft-dialog" aria-label="Date overrides" onCancel={e=>{e.preventDefault();void closeDates();}}>
      <header><div><h2>Date overrides</h2><p>Listing dates take priority over group dates.</p></div><Button variant="quiet" aria-label="Close date overrides" onClick={()=>void closeDates()}><PricingIcon name="close"/></Button></header>
      <div className="pricing-draft-dialog-body">
        {group&&<label className="pricing-field">Apply to<select value={scope} disabled={form!==null} onChange={e=>setScope(e.target.value as typeof scope)}><option value="listing">This listing</option><option value="group">Group: {group.name}</option></select></label>}
        {!form&&<><div className="pricing-override-list">{rows.map(r=><div key={r.id}><div><b>{r.label}</b><span>{r.start} to {r.end}</span><span>{r.kind==='fixed'?pricingMoney(r.value,true):r.kind==='percent'?`${r.value>0?'+':''}${r.value}%`:'Minimum stay'}{r.minNights?` · ${r.minNights} nights`:''} · {r.weekdays.length===7?'All days':r.weekdays.map(d=>['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ')}</span></div><Button variant="quiet" onClick={()=>setForm({...r})}>Edit</Button><Button variant="quiet" onClick={async()=>{if(await confirmIn(dates,{title:'Remove date override?',body:r.label,confirmLabel:'Remove'}))replaceRows(rows.filter(v=>v.id!==r.id));}}>Remove</Button></div>)}{!rows.length&&<p>No date overrides.</p>}</div><Button variant="primary" onClick={()=>setForm(blank(today))}>Add override</Button></>}
        {form&&<><div className="pricing-draft-fields">
          <label className="pricing-field">Name<input value={form.label} maxLength={80} onChange={e=>setForm({...form,label:e.target.value})}/></label>
          <label className="pricing-field">Price rule<select value={form.kind} onChange={e=>setForm({...form,kind:e.target.value as PricingOverride['kind'],value:0})}><option value="fixed">Fixed nightly price</option><option value="percent">Adjust Helm price (%)</option><option value="stay">Minimum stay only</option></select></label>
          <label className="pricing-field">First night<input type="date" value={form.start} onChange={e=>setForm({...form,start:e.target.value})}/></label><label className="pricing-field">Last night<input type="date" value={form.end} onChange={e=>setForm({...form,end:e.target.value})}/></label>
          {form.kind!=='stay'&&<label className="pricing-field">{form.kind==='fixed'?'Nightly price ($)':'Adjustment (%)'}<input type="number" step={form.kind==='fixed'?0.01:1} value={form.kind==='fixed'?form.value/100:form.value} onChange={e=>setForm({...form,value:form.kind==='fixed'?Math.round(Number(e.target.value)*100):Number(e.target.value)})}/></label>}
          <label className="pricing-field">Minimum nights<input type="number" min={1} max={30} placeholder="Use pricing rules" value={form.minNights??''} onChange={e=>setForm({...form,minNights:e.target.value===''?null:Number(e.target.value)})}/></label>
        </div><fieldset className="pricing-weekday-picker"><legend>Apply on</legend>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d,i)=><label key={d}><input type="checkbox" checked={form.weekdays.includes(i)} onChange={e=>setForm({...form,weekdays:e.target.checked?[...form.weekdays,i].sort():form.weekdays.filter(v=>v!==i)})}/>{d}</label>)}</fieldset>
        <p className="pricing-draft-note">Draft only. Your price floor and ceiling still apply. Booked, blocked and protected nights remain unchanged.</p>
        <div className="pricing-draft-dialog-actions"><Button variant="quiet" onClick={()=>{setForm(null);setError('');}}>Cancel edit</Button><Button variant="primary" onClick={saveOverride}>Save override</Button></div></>}
        {error&&<p role="alert" className="pricing-feedback">{error}</p>}
      </div>
    </dialog>
    <dialog ref={groups} className="pricing-draft-dialog" aria-label="Pricing groups">
      <header><div><h2>Pricing groups</h2><p>Share rules while keeping each home’s base, minimum and maximum.</p></div><Button variant="quiet" aria-label="Close groups" onClick={()=>groups.current?.close()}><PricingIcon name="close"/></Button></header>
      <div className="pricing-draft-dialog-body">
        <label className="pricing-field">Listing group<select value={home.groupId??''} onChange={e=>change({...state,homes:{...state.homes,[propertyId]:{...home,groupId:e.target.value||null,inheritRules:!!e.target.value,policy:resolvePricingDraft(state,propertyId),version:home.version+1}}})}><option value="">No group</option>{state.groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
        {group&&<><p className="pricing-draft-note">{Object.values(state.homes).filter(h=>h.groupId===group.id).length} listings · {home.inheritRules?'Using group rules':'Using listing rules'} · {group.overrides.length} shared date overrides</p>
          {!home.inheritRules&&<Button variant="secondary" onClick={()=>change({...state,homes:{...state.homes,[propertyId]:{...home,inheritRules:true,version:home.version+1}}})}>Use group rules</Button>}
          <Button variant="secondary" onClick={async()=>{if(await confirmIn(groups,{title:`Update ${group.name}?`,body:'Replace the shared rules with this listing’s saved rules. Other listings using this group inherit the change; their base, minimum and maximum prices stay unchanged.',confirmLabel:'Update group rules'}))change({...state,groups:state.groups.map(g=>g.id===group.id?{...g,policy:resolvePricingDraft(state,propertyId)}:g),homes:{...state.homes,[propertyId]:{...home,inheritRules:true,version:home.version+1}}});}}>Update group from this listing</Button></>}
        <div className="pricing-group-create"><label className="pricing-field">New group name<input value={name} maxLength={60} onChange={e=>setName(e.target.value)}/></label><Button variant="primary" disabled={!name.trim()} onClick={()=>{const id=crypto.randomUUID();if(change({...state,groups:[...state.groups,{id,name:name.trim(),policy:resolvePricingDraft(state,propertyId),overrides:[]}],homes:{...state.homes,[propertyId]:{...home,groupId:id,inheritRules:true,version:home.version+1}}}))setName('');}}>Create from saved rules</Button></div>
        <p className="pricing-draft-note">Editing a shared rule on one listing creates a listing-specific rule set. Group date overrides still apply unless a listing date override replaces them.</p>
        {error&&<p role="alert" className="pricing-feedback">{error}</p>}
      </div>
    </dialog>
  </div>;
}
